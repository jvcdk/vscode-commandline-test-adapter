import * as vscode from 'vscode';
import * as path from 'path';
import { runExternalProcess } from './extprocess';
import { TestInternalData } from './test-internal-data'
import { TestRunner } from './test-runner'
import { Constants } from './constants';

export class CommandLineTestAdapter {
  private testRunner: TestRunner | undefined = undefined;
  private testInternalData = new WeakMap<vscode.TestItem, TestInternalData>();
  private idCounter : number = 0;
  private fileWatchers : Array<vscode.FileSystemWatcher> = [];
  private discoveryDebounceTimer? : ReturnType<typeof setTimeout> = undefined;
  private discoveryInFlight : boolean = false;
  private discoveryPending : boolean = false;

  constructor(
    private readonly testController: vscode.TestController,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly log: vscode.OutputChannel
  ) {
    this.log.appendLine('Initializing.');
  }

  setupFileWatchers() {
    this.clearFileWatchers();

    let [fileWatcherPatterns] = this.getConfigArrays(['watch']);
    if(Object.prototype.toString.call(fileWatcherPatterns) == "[object Array]" && fileWatcherPatterns.length > 0) {
      for(const pattern of fileWatcherPatterns) {
        const relPattern = new vscode.RelativePattern(this.workspaceFolder, pattern);
        const watcher = vscode.workspace.createFileSystemWatcher(relPattern);
        watcher.onDidCreate(uri => this.scheduleDiscovery());
        watcher.onDidChange(uri => this.scheduleDiscovery());
        watcher.onDidDelete(uri => this.scheduleDiscovery());
        this.fileWatchers.push(watcher);
      }
    }
  }

  private clearFileWatchers() {
    for(const watcher of this.fileWatchers)
      watcher.dispose();
    this.fileWatchers.length = 0;
  }

  // Debounce discovery so a burst of file-watcher events triggers only one run.
  scheduleDiscovery() {
    if(this.discoveryDebounceTimer != undefined)
      clearTimeout(this.discoveryDebounceTimer);
    this.discoveryDebounceTimer = setTimeout(() => {
      this.discoveryDebounceTimer = undefined;
      this.discoverTests();
    }, Constants.DiscoveryDebounceMs);
  }

  async discoverTests() {
    // Never run two discovery processes at once; they only fight over shared
    // resources (e.g. a build lock). If a request arrives while one is running,
    // run exactly one more pass afterwards to pick up the latest changes.
    if(this.discoveryInFlight) {
      this.discoveryPending = true;
      return;
    }
    this.discoveryInFlight = true;
    try {
      let [
        testFolder,
        discoveryCommand,
      ] = this.getConfigStrings([
        'testFolder',
        'discoveryCommand',
      ]);
      let [discoveryArgs] = this.getConfigArrays(['discoveryArgs']);
      let [translateNewlines] = this.getConfigBooleans(['translateNewlines']);

      if(testFolder == undefined || testFolder == "")
        testFolder = this.workspaceFolder.uri.fsPath;

      if(discoveryCommand == "")
        throw new Error(`Missing discovery command. Please set in settings: ${Constants.SettingsKey}.discoveryCommand`);

      if(Object.prototype.toString.call(discoveryCommand) != "[object String]")
        throw new Error(`Setting ${Constants.SettingsKey}.discoveryCommand should be a string.`);

      await runExternalProcess(discoveryCommand, discoveryArgs, testFolder, translateNewlines, /* mergeStderrToStdout */ false).result.then((result) => {
        if(result.stdErr.length > 0)
          this.log.appendLine(result.stdErr);
        if(result.returnCode == 0)
          this.parseDiscoveryString(testFolder, result.stdOut);
        else {
          this.log.appendLine(`Discovery of tests returned err code ${result.returnCode}.`);
          if(result.stdOut.length > 0) {
            this.log.appendLine(`Stdout:`);
            this.log.appendLine(result.stdOut);
          }
        }
      }).catch((reason) => this.log.appendLine(reason));
    }
    catch(e) {
      this.log.appendLine(String(e));
    }
    finally {
      this.discoveryInFlight = false;
      if(this.discoveryPending) {
        this.discoveryPending = false;
        this.discoverTests();
      }
    }
  }

  async runTest(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const testRun = this.testController.createTestRun(request);

    let [translateNewlines] = this.getConfigBooleans(['translateNewlines']);
    this.testRunner = new TestRunner(testRun, this.testInternalData, this.log, token, translateNewlines, await this.getCpuCount());

    const tests: vscode.TestItem[] = this.getTestsFromRequest(request);
    this.testRunner.runTest(tests);
  }

  async debugTest(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    let [defaultDebugConfigName] = this.getConfigStrings(['debugConfig']);
    const tests: vscode.TestItem[] = this.getTestsFromRequest(request);
    for(let test of tests) {
      if(token.isCancellationRequested)
        return;

      let data = this.testInternalData.get(test);
      let configName = data?.debugConfig || defaultDebugConfigName;
      if(isEmpty(configName)) {
        this.log.appendLine(`Could not start debugging of '${test.label}'.`);
        this.log.appendLine(`Discovery command did not specify a debug configuration explicitly, and ${Constants.SettingsKey}.debugConfig is not set.`);
        vscode.window.showErrorMessage(`Could not launch debug task for ${test.label}. Please see Command Line Test Adapter log window`);
        continue;
      }

      const launchConfig = vscode.workspace.getConfiguration('launch', this.workspaceFolder.uri);
      const configurations: vscode.DebugConfiguration[] = launchConfig.get('configurations') || [];
      const baseConfig = configurations.find(c => c.name === configName);
      if(baseConfig == undefined) {
        this.log.appendLine(`Debug configuration '${configName}' not found in launch.json.`);
        vscode.window.showErrorMessage(`Debug configuration '${configName}' not found in launch.json.`);
        continue;
      }

      const debugConfig = { ...baseConfig };

      if(data == undefined) {
        this.log.appendLine(`Error: Could not find internal data for test ${test.label}.`);
        continue;
      }

      if(!isEmpty(debugConfig["program"]))
        this.log.appendLine(`Warning: 'program' field of '${debugConfig.name}' was not empty - it will be overwritten.`);
      debugConfig["program"] = data.command;
      debugConfig["args"] = [...(debugConfig["args"] ?? []), ...data.args];

      let args = debugConfig["args"].map((arg: string) => `"${arg}"`).join(" ");
      this.log.appendLine(`Launching debug session '${test.label}', command: ${debugConfig["program"]} ${args}`);

      await vscode.debug.startDebugging(this.workspaceFolder, debugConfig)
        .then(
          result => {},
          reason => {
            this.log.appendLine(`Could not start debugging of '${test.label}'.`);
            this.log.appendLine(reason);
          }
        );
    }
  }

  private getTestsFromRequest(request: vscode.TestRunRequest) : vscode.TestItem[] {
    const tests: vscode.TestItem[] = [];
    if (request.include == undefined) {
      this.testController.items.forEach(test => {
        if (request.exclude?.indexOf(test) != -1)
          return;
        tests.push(test);
      });
    }
    else {
      request.include
        .filter(test => request.exclude?.indexOf(test) == -1)
        .forEach(test => tests.push(test));
    }
    return tests;
  }

  async getCpuCount(): Promise<number> {
    let [cpuCountStr, testFolder] = this.getConfigStrings(['cpuCount', 'testFolder']);
    let cpuCount = +cpuCountStr;
    if(!isNaN(cpuCount))
      return Math.max(1, Math.floor(cpuCount));

    cpuCount = 1;
    await runExternalProcess(cpuCountStr, [], testFolder, /* translateNewlines */ true, /* mergeStderrToStdout */ false).result.then((result) => {
      if(result.stdErr.length > 0)
        this.log.appendLine(result.stdErr);
      if(result.returnCode == 0) {
        if(result.stdOut.length == 0)
          this.log.appendLine(`Detecting number of CPUs via ${cpuCountStr} returned no output.`);
        else {
          cpuCount = +result.stdOut;
          if(isNaN(cpuCount)) {
            this.log.appendLine(`Detecting number of CPUs via ${cpuCountStr}: Not an int: ${result.stdOut}`);
            cpuCount = 1;
          }
        }
      }
      else {
        this.log.appendLine(`Detecting number of CPUs via ${cpuCountStr} returned err code ${result.returnCode}.`);
        if(result.stdOut.length > 0) {
          this.log.appendLine(`Stdout:`);
          this.log.appendLine(result.stdOut);
        }
      }
    }).catch((reason) => this.log.appendLine(reason));
    return Math.max(1, Math.floor(cpuCount));
  }

  private parseDiscoveryString(testFolder : string, text: string) {
    try {
      const data = JSON.parse(text);
      if(Object.prototype.toString.call(data) === '[object Array]') {
        this.testInternalData = new WeakMap<vscode.TestItem, TestInternalData>();
        this.parseDiscoveryData(testFolder, data, this.testController.items);
      }

      else {
        this.log.appendLine("Got unexpected json data from discover command.");
        this.log.appendLine("Please see documentation for supported data structure.");
        this.log.appendLine("Received data:");
        this.log.appendLine(text);
      }
    }
    catch(e) {
      this.log.appendLine("Error parsing json data from discover command.");
      this.log.appendLine("Err message:");
      this.log.appendLine(String(e));
      this.log.appendLine("Received data:");
      this.log.appendLine(text);
    }
  }

  private parseDiscoveryData(testFolder: string, tests: any[], collection: vscode.TestItemCollection) {
    let existingTests: string[] = [];
    collection.forEach(existing => existingTests.push(existing.id));

    tests.forEach(testCase => {
      if(isEmpty(testCase.label)) {
        this.log.appendLine("Empty label. Ignoring test case.");
        return;
      }

      var test = this.processTestCase(testFolder, testCase, collection);
      let idx = existingTests.indexOf(test.id);
      if(idx >= 0)
        existingTests.splice(idx, 1);

      if (Object.prototype.toString.call(testCase.children) === '[object Array]')
        this.parseDiscoveryData(testFolder, testCase.children, test.children);
    });

    existingTests.forEach(removedTest => {
      let instance = collection.get(removedTest);
      if(instance == undefined)
        return;
      collection.delete(removedTest);
      this.testInternalData.delete(instance)
    });
  }

  private processTestCase(testFolder: string, testCase: any, collection: vscode.TestItemCollection) : vscode.TestItem {
    let instanceTestFolder = testFolder;
    if (!isEmpty(testCase.testFolder))
      instanceTestFolder = this.substituteString(testCase.testFolder);
    if (!path.isAbsolute(instanceTestFolder))
      instanceTestFolder = path.join(this.workspaceFolder.uri.fsPath, instanceTestFolder);

    let uri = undefined;
    if (!isEmpty(testCase.file)) {
      let file = this.substituteString(String(testCase.file));
      if (!path.isAbsolute(file))
        file = path.join(instanceTestFolder, file);
      uri = vscode.Uri.file(file);
    }

    let [test, internalData] = this.GetCreateVsCodeTestCase(collection, testCase.label, uri);

    internalData.testFolder = instanceTestFolder;

    if (!isEmpty(testCase.line)) {
      const lineNo = +testCase.line;
      test.range = new vscode.Range(new vscode.Position(lineNo - 1, 0), new vscode.Position(lineNo - 1, 0));
    }

    if (!isEmpty(testCase.command)) {
      let args: string[] = [];
      let argsType = Object.prototype.toString.call(testCase.args);
      if (argsType === '[object Array]')
        testCase.args.forEach((arg: string) => args.push(arg));
      else if (argsType === '[object String]')
        args.push(testCase.args);

      internalData.command = this.substituteString(testCase.command);
      internalData.args = this.substituteStrArray(args);
    }

    if(!isEmpty(testCase.debugConfig)) {
      let debugConfigType = Object.prototype.toString.call(testCase.debugConfig);
      if(debugConfigType === '[object String]')
        internalData.debugConfig = testCase.debugConfig;
      else
        this.log.appendLine(`Unsupported object type '${debugConfigType}' for property 'debugConfig' on test case '${test.label}'.`);
    }

    return test;
  }

  private GetCreateVsCodeTestCase(collection: vscode.TestItemCollection, label: string, uri: vscode.Uri | undefined): [vscode.TestItem, TestInternalData] {
    let test: vscode.TestItem | undefined = undefined;
    collection.forEach((entry: vscode.TestItem) => {
      if(entry.label == label && entry.uri?.path == uri?.path)
        test = entry;
    });

    if(test == undefined) {
      test = this.testController.createTestItem(this.getNewId(), label, uri);
      collection.add(test);
    }

    let internalData = this.testInternalData.get(test);
    if(internalData == undefined) {
      internalData = new TestInternalData();
      this.testInternalData.set(test, internalData);
    }

    return [test, internalData];
  }

  private getNewId() : string {
    return `cmdline-test-${this.idCounter++}`;
  }

  private getConfigStrings(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    return names.map((name) => this.configGetStr(config, name));
  }

  private getConfigBooleans(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    return names.map((name) => config.get<boolean>(name) || false);
  }

  private getConfigArrays(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    return names.map((name) => this.configGetArray(config, name));
  }

  /**
   * Get workspace configuration object
   */
  private getWorkspaceConfiguration() {
    return vscode.workspace.getConfiguration(Constants.SettingsKey, this.workspaceFolder.uri);
  }

  /**
   * Get variable to value substitution map for config strings
   *
   * @note on Windows environment variable names are converted to uppercase
   */
   private getVariableSubstitutionMap() {
    // Standard variables
    const substitutionMap = new Map<string, string>([
      ['${workspaceFolder}', this.workspaceFolder.uri.fsPath],
    ]);

    // Environment variables prefixed by 'env:'
    for (const [varname, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        substitutionMap.set(
          `\${env:${
            process.platform == 'win32' ? varname.toUpperCase() : varname
          }}`,
          value
        );
      }
    }

    return substitutionMap;
  }

  /**
   * Get & substitute config settings
   *
   * @param config VS Code workspace configuration
   * @param varMap Variable to value map
   * @param key Config name
   */
   private configGetStr(
    config: vscode.WorkspaceConfiguration,
    key: string
  ) {
    const configStr = config.get<string>(key) || '';
    return this.substituteString(configStr);
  }

  private substituteString(str: string)
  {
    const varMap = this.getVariableSubstitutionMap();
    return substituteString(str, varMap);
  }

  private substituteStrArray(strs: string[])
  {
    const varMap = this.getVariableSubstitutionMap();
    for(var idx = 0; idx < strs.length; idx++)
      strs[idx] = substituteString(strs[idx], varMap);
      return strs;
  }

  /**
   * Get config setting (array) & substitute on each element
   *
   * @param config VS Code workspace configuration
   * @param varMap Variable to value map
   * @param key Config name
   */
     private configGetArray(
      config: vscode.WorkspaceConfiguration,
      key: string
    ) {
      let configArr = config.get<Array<string>>(key) || [];
      return this.substituteStrArray(configArr);
    }

  dispose(): void {
    if(this.discoveryDebounceTimer != undefined)
      clearTimeout(this.discoveryDebounceTimer);
    this.testRunner?.dispose();
    this.clearFileWatchers();
  }
}

/**
 * Substitute variables in string
 *
 * @param str String to substitute
 * @param varMap Variable to value map
 *
 * @return Substituted string
 */
function substituteString(str: string, varMap: Map<string, string>) {
  varMap.forEach((value, key) => {
    while (str.indexOf(key) > -1) {
      str = str.replace(key, value);
    }
  });
  return str;
};

function isEmpty(value: any) {
  return value == undefined || value == null  || value == "";
}
