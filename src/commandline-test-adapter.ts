import * as vscode from 'vscode';
import * as path from 'path';
import { runExternalProcess } from './extprocess';
import { TestInternalData } from './test-internal-data'
import { TestRunner } from './test-runner'

export class CommandLineTestAdapter {
  private testRunner: TestRunner | undefined = undefined;
  private testInternalData = new WeakMap<vscode.TestItem, TestInternalData>();
  private idCounter : number = 0;
  private fileWatchers : Array<vscode.FileSystemWatcher> = [];

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
        watcher.onDidCreate(uri => this.discoverTests());
        watcher.onDidChange(uri => this.discoverTests());
        watcher.onDidDelete(uri => this.discoverTests());
        this.fileWatchers.push(watcher);
      }
    }
  }

  private clearFileWatchers() {
    for(const watcher of this.fileWatchers)
      watcher.dispose();
    this.fileWatchers.length = 0;
  }

  async discoverTests() {
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
        throw new Error("Missing discovery command. Please set in settings: commandLineTestAdapter.discoveryCommand");

      if(Object.prototype.toString.call(discoveryCommand) != "[object String]")
        throw new Error("Setting commandLineTestAdapter.discoveryCommand should be a string.");

      await runExternalProcess(discoveryCommand, discoveryArgs, testFolder, translateNewlines, /* mergeStderrToStdout */ false).then((result) => {
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
  }

  async runTest(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    let [translateNewlines] = this.getConfigBooleans(['translateNewlines']);
    const tests: vscode.TestItem[] = [];
    if(request.include == undefined) {
      this.testController.items.forEach(test => {
        if(request.exclude?.indexOf(test) != -1) return;
        tests.push(test);
      });
    }
    else {
      request.include
        .filter(test => request.exclude?.indexOf(test) == -1)
        .forEach(test => tests.push(test));
    }
  
    const testRun = this.testController.createTestRun(request);
    this.testRunner = new TestRunner(testRun, this.testInternalData, this.log, token, translateNewlines, await this.getCpuCount());
    this.testRunner.runTest(tests);
  }

  async getCpuCount(): Promise<number> {
    let [cpuCountStr] = this.getConfigStrings(['cpuCount']);
    let cpuCount = +cpuCountStr;
    if(!isNaN(cpuCount))
      return cpuCount;

    cpuCount = 1;
    await runExternalProcess(cpuCountStr, [], "", /* translateNewlines */ true, /* mergeStderrToStdout */ false).then((result) => {
      if(result.stdErr.length > 0)
        this.log.appendLine(result.stdErr);
      if(result.returnCode == 0) {
        if(result.stdOut.length == 0)
          this.log.appendLine(`Detecting number of CPUs via ${cpuCountStr} returned no output.`);
        else {
          cpuCount = +result.stdOut;
          if(isNaN(cpuCount))
            this.log.appendLine(`Detecting number of CPUs via ${cpuCountStr}: Not an int: ${result.stdOut}`);
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
    return cpuCount;
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
      if (Object.prototype.toString.call(testCase.args) === '[object Array]')
        testCase.args.forEach((arg: string) => args.push(arg));
      else if (Object.prototype.toString.call(testCase.args) === '[object String]')
        args.push(testCase.args);

      internalData.command = this.substituteString(testCase.command);
      internalData.args = this.substituteStrArray(args);
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
    return vscode.workspace.getConfiguration(
      'commandLineTestAdapter',
      this.workspaceFolder.uri
    );
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
