import * as vscode from 'vscode';
import * as path from 'path';
import { runExternalProcess } from './extprocess';
import { TestInternalData } from './test-internal-data'
import { TestRunner } from './test-runner'
import { Constants } from './constants';

export class CommandLineTestAdapter {
  private testRunners = new Set<TestRunner>();
  private testInternalData = new WeakMap<vscode.TestItem, TestInternalData>();
  private idCounter : number = 0;
  private fileWatchers : Array<vscode.FileSystemWatcher> = [];
  private discoveryDebounceTimer? : ReturnType<typeof setTimeout> = undefined;
  private discoveryInFlight : boolean = false;
  private discoveryPending : boolean = false;
  private discoveryPromise : Promise<void> = Promise.resolve();

  constructor(
    private readonly testController: vscode.TestController,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly log: vscode.LogOutputChannel
  ) {
    this.log.info('Initializing.');
  }

  setupFileWatchers() {
    this.clearFileWatchers();

    const [fileWatcherPatterns] = this.getConfigArrays(['watch']);
    if(Array.isArray(fileWatcherPatterns) && fileWatcherPatterns.length > 0) {
      for(const pattern of fileWatcherPatterns) {
        const relPattern = new vscode.RelativePattern(this.workspaceFolder, pattern);
        const watcher = vscode.workspace.createFileSystemWatcher(relPattern);
        watcher.onDidCreate(() => this.scheduleDiscovery());
        watcher.onDidChange(() => this.scheduleDiscovery());
        watcher.onDidDelete(() => this.scheduleDiscovery());
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

  discoverTests(): Promise<void> {
    // Never run two discovery processes at once; they only fight over shared
    // resources (e.g. a build lock). If a request arrives while one is running,
    // run exactly one more pass afterwards to pick up the latest changes.
    if(this.discoveryInFlight) {
      this.discoveryPending = true;
      return this.discoveryPromise;
    }
    this.discoveryInFlight = true;
    this.discoveryPromise = this.doDiscoverTests();
    return this.discoveryPromise;
  }

  private async doDiscoverTests() {
    try {
      const [discoveryCommand] = this.getConfigStrings(['discoveryCommand']);
      let [testFolder] = this.getConfigStrings(['testFolder']);
      const [discoveryArgs] = this.getConfigArrays(['discoveryArgs']);
      const [translateNewlines] = this.getConfigBooleans(['translateNewlines']);

      if(testFolder == undefined || testFolder == "")
        testFolder = this.workspaceFolder.uri.fsPath;

      if(discoveryCommand == "")
        throw new Error(`Missing discovery command. Please set in settings: ${Constants.SettingsKey}.discoveryCommand`);

      if(typeof discoveryCommand !== "string")
        throw new Error(`Setting ${Constants.SettingsKey}.discoveryCommand should be a string.`);

      await runExternalProcess(discoveryCommand, discoveryArgs, testFolder, translateNewlines, /* mergeStderrToStdout */ false).result.then((result) => {
        if(result.stdErr.length > 0)
          this.log.warn(result.stdErr);
        if(result.returnCode == 0)
          this.parseDiscoveryString(testFolder, result.stdOut);
        else {
          this.log.error(`Discovery of tests returned err code ${result.returnCode}.`);
          if(result.stdOut.length > 0) {
            this.log.error(`Stdout:`);
            this.log.error(result.stdOut);
          }
          this.showDiscoveryError(`Discovery command exited with code ${result.returnCode}.`);
        }
      }).catch((reason) => {
        this.log.error(String(reason));
        this.showDiscoveryError(`Discovery command failed: ${reason}`);
      });
    }
    catch(e) {
      this.log.error(String(e));
      this.showDiscoveryError(String(e));
    }
    finally {
      this.discoveryInFlight = false;
      if(this.discoveryPending) {
        this.discoveryPending = false;
        await this.discoverTests();
      }
    }
  }

  async runTest(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const testRun = this.testController.createTestRun(request);

    const [translateNewlines] = this.getConfigBooleans(['translateNewlines']);
    const runner = new TestRunner(testRun, this.testInternalData, this.log, token, translateNewlines, await this.getCpuCount());
    this.testRunners.add(runner);

    const tests: vscode.TestItem[] = this.getTestsFromRequest(request);
    runner.runTest(tests).finally(() => this.testRunners.delete(runner));
  }

  async debugTest(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const [defaultDebugConfigName] = this.getConfigStrings(['debugConfig']);
    const tests: vscode.TestItem[] = this.getTestsFromRequest(request);
    for(const test of tests) {
      if(token.isCancellationRequested)
        return;

      const data = this.testInternalData.get(test);
      const configName = data?.debugConfig || defaultDebugConfigName;
      if(isEmpty(configName)) {
        this.log.error(`Could not start debugging of '${test.label}'.`);
        this.log.error(`Discovery command did not specify a debug configuration explicitly, and ${Constants.SettingsKey}.debugConfig is not set.`);
        vscode.window.showErrorMessage(`Could not launch debug task for ${test.label}. Please see Command Line Test Adapter log window`);
        continue;
      }

      const launchConfig = vscode.workspace.getConfiguration('launch', this.workspaceFolder.uri);
      const configurations: vscode.DebugConfiguration[] = launchConfig.get('configurations') || [];
      const baseConfig = configurations.find(c => c.name === configName);
      if(baseConfig == undefined) {
        this.log.error(`Debug configuration '${configName}' not found in launch.json.`);
        vscode.window.showErrorMessage(`Debug configuration '${configName}' not found in launch.json.`);
        continue;
      }

      const debugConfig = { ...baseConfig };

      if(data == undefined) {
        this.log.error(`Could not find internal data for test ${test.label}.`);
        continue;
      }

      if(!isEmpty(debugConfig["program"]))
        this.log.warn(`'program' field of '${debugConfig.name}' was not empty - it will be overwritten.`);
      debugConfig["program"] = data.command;
      debugConfig["args"] = [...(debugConfig["args"] ?? []), ...data.args];

      const args = debugConfig["args"].map((arg: string) => `"${arg}"`).join(" ");
      this.log.info(`Launching debug session '${test.label}', command: ${debugConfig["program"]} ${args}`);

      await vscode.debug.startDebugging(this.workspaceFolder, debugConfig)
        .then(
          () => {},
          reason => {
            this.log.error(`Could not start debugging of '${test.label}'.`);
            this.log.error(String(reason));
          }
        );
    }
  }

  private getTestsFromRequest(request: vscode.TestRunRequest) : vscode.TestItem[] {
    const excluded = new Set(request.exclude ?? []);
    const tests: vscode.TestItem[] = [];
    if (request.include == undefined) {
      this.testController.items.forEach(test => {
        if (!excluded.has(test))
          tests.push(test);
      });
    }
    else {
      request.include
        .filter(test => !excluded.has(test))
        .forEach(test => tests.push(test));
    }
    return tests;
  }

  async getCpuCount(): Promise<number> {
    const [cpuCountStr, testFolder] = this.getConfigStrings(['cpuCount', 'testFolder']);
    let cpuCount = +cpuCountStr;
    if(!isNaN(cpuCount))
      return Math.max(1, Math.floor(cpuCount));

    cpuCount = 1;
    await runExternalProcess(cpuCountStr, [], testFolder, /* translateNewlines */ true, /* mergeStderrToStdout */ false).result.then((result) => {
      if(result.stdErr.length > 0)
        this.log.warn(result.stdErr);
      if(result.returnCode == 0) {
        if(result.stdOut.length == 0)
          this.log.warn(`Detecting number of CPUs via ${cpuCountStr} returned no output.`);
        else {
          cpuCount = +result.stdOut;
          if(isNaN(cpuCount)) {
            this.log.warn(`Detecting number of CPUs via ${cpuCountStr}: Not an int: ${result.stdOut}`);
            cpuCount = 1;
          }
        }
      }
      else {
        this.log.error(`Detecting number of CPUs via ${cpuCountStr} returned err code ${result.returnCode}.`);
        if(result.stdOut.length > 0) {
          this.log.error(`Stdout:`);
          this.log.error(result.stdOut);
        }
      }
    }).catch((reason) => this.log.error(String(reason)));
    return Math.max(1, Math.floor(cpuCount));
  }

  private parseDiscoveryString(testFolder : string, text: string) {
    try {
      const data = JSON.parse(text);
      if(Array.isArray(data)) {
        const newTestData = new WeakMap<vscode.TestItem, TestInternalData>();
        this.parseDiscoveryData(testFolder, data, this.testController.items, newTestData);
        this.testInternalData = newTestData;
      }
      else {
        this.log.error("Got unexpected json data from discover command.");
        this.log.error("Please see documentation for supported data structure.");
        this.log.error("Received data:");
        this.log.error(text);
        this.showDiscoveryError("Discovery command returned unexpected data format.");
      }
    }
    catch(e) {
      this.log.error("Error parsing json data from discover command.");
      this.log.error("Err message:");
      this.log.error(String(e));
      this.log.error("Received data:");
      this.log.error(text);
      this.showDiscoveryError("Failed to parse discovery output as JSON.");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseDiscoveryData(testFolder: string, tests: any[], collection: vscode.TestItemCollection, testData: WeakMap<vscode.TestItem, TestInternalData>) {
    const existingTests: string[] = [];
    collection.forEach(existing => existingTests.push(existing.id));

    tests.forEach(testCase => {
      if(isEmpty(testCase.label)) {
        this.log.warn("Empty label. Ignoring test case.");
        return;
      }

      const test = this.processTestCase(testFolder, testCase, collection, testData);
      const idx = existingTests.indexOf(test.id);
      if(idx >= 0)
        existingTests.splice(idx, 1);

      if (Array.isArray(testCase.children))
        this.parseDiscoveryData(testFolder, testCase.children, test.children, testData);
    });

    existingTests.forEach(removedTest => {
      const instance = collection.get(removedTest);
      if(instance == undefined)
        return;
      collection.delete(removedTest);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processTestCase(testFolder: string, testCase: any, collection: vscode.TestItemCollection, testData: WeakMap<vscode.TestItem, TestInternalData>) : vscode.TestItem {
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

    const [test, internalData] = this.getOrCreateTestCase(collection, testCase.label, uri, testData);

    internalData.testFolder = instanceTestFolder;

    if (!isEmpty(testCase.line)) {
      const lineNo = +testCase.line;
      test.range = new vscode.Range(new vscode.Position(lineNo - 1, 0), new vscode.Position(lineNo - 1, 0));
    }

    if (!isEmpty(testCase.command)) {
      const args: string[] = [];
      if (Array.isArray(testCase.args))
        testCase.args.forEach((arg: string) => args.push(arg));
      else if (typeof testCase.args === 'string')
        args.push(testCase.args);

      internalData.command = this.substituteString(testCase.command);
      internalData.args = this.substituteStrArray(args);
    }

    if(!isEmpty(testCase.debugConfig)) {
      if(typeof testCase.debugConfig === 'string')
        internalData.debugConfig = testCase.debugConfig;
      else
        this.log.warn(`Unsupported type '${typeof testCase.debugConfig}' for property 'debugConfig' on test case '${test.label}'.`);
    }

    return test;
  }

  private getOrCreateTestCase(collection: vscode.TestItemCollection, label: string, uri: vscode.Uri | undefined, testData: WeakMap<vscode.TestItem, TestInternalData>): [vscode.TestItem, TestInternalData] {
    let test: vscode.TestItem | undefined = undefined;
    collection.forEach((entry: vscode.TestItem) => {
      if(entry.label == label && entry.uri?.path == uri?.path)
        test = entry;
    });

    if(test == undefined) {
      test = this.testController.createTestItem(this.getNewId(), label, uri);
      collection.add(test);
    }

    let internalData = testData.get(test);
    if(internalData == undefined) {
      internalData = new TestInternalData();
      testData.set(test, internalData);
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
    return strs.map(str => substituteString(str, varMap));
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
      const configArr = config.get<Array<string>>(key) || [];
      return this.substituteStrArray(configArr);
    }

  private showDiscoveryError(message: string) {
    vscode.window.showErrorMessage(message, 'Open Log').then(action => {
      if(action === 'Open Log')
        this.log.show();
    });
  }

  dispose(): void {
    if(this.discoveryDebounceTimer != undefined)
      clearTimeout(this.discoveryDebounceTimer);
    for(const runner of this.testRunners)
      runner.dispose();
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
    str = str.split(key).join(value);
  });
  return str;
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === "";
}
