import * as vscode from 'vscode';
import * as path from 'path';
import { runExternalProcess } from './extprocess';
import { TestInternalData } from './test-internal-data'
import { TestRunner } from './test-runner'

export class CommandLineTestAdapter {
  private testRunner: TestRunner | undefined = undefined;
  private testInternalData = new WeakMap<vscode.TestItem, TestInternalData>();
  private idCounter : number = 0;

  constructor(
    private readonly testController: vscode.TestController,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly log: vscode.OutputChannel
  ) {
    this.log.appendLine('Initializing.');
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

      await runExternalProcess(discoveryCommand, discoveryArgs, testFolder, translateNewlines).then((result) => {
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
    await runExternalProcess(cpuCountStr, [], "", true).then((result) => {
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
        var tests = this.parseDiscoveryData(testFolder, data);
        this.testController.items.replace(tests);
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

  private parseDiscoveryData(testFolder: string, tests: any[]) : vscode.TestItem[] {
    return tests.map<any>(testCase => {
      if(isEmpty(testCase.label)) {
        this.log.appendLine("Empty label. Ignoring testcase.");
        return;
      }

      let uri = undefined;
      if(!isEmpty(testCase.file)) {
        let file = String(testCase.file);
        if(!path.isAbsolute(file))
          file = path.join(testFolder, file)
        uri = vscode.Uri.file(file);
      }

      let test = this.testController.createTestItem(this.getNewId(), testCase.label, uri);
      let internalData = new TestInternalData();
      internalData.testFolder = testFolder;
      this.testInternalData.set(test, internalData);

      if(!isEmpty(testCase.line)) {
        const lineNo = +testCase.line;
        test.range = new vscode.Range(new vscode.Position(lineNo-1, 0), new vscode.Position(lineNo-1, 0));
      }

      if(!isEmpty(testCase.command)) {
        let args: string[] = [];
        if(Object.prototype.toString.call(testCase.args) === '[object Array]')
          testCase.args.forEach((arg: string) => args.push(arg));
        else if(Object.prototype.toString.call(testCase.args) === '[object String]')
          args.push(testCase.args);

          internalData.command = testCase.command;
          internalData.args = args;
      }

      if(Object.prototype.toString.call(testCase.children) === '[object Array]')
        test.children.replace(this.parseDiscoveryData(testFolder, testCase.children));

      return test;
    });
  }

  private getNewId() : string {
    return `cmdline-test-${this.idCounter++}`;
  }

  private getConfigStrings(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    const varMap = this.getVariableSubstitutionMap();
    return names.map((name) => this.configGetStr(config, varMap, name));
  }

  private getConfigBooleans(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    return names.map((name) => config.get<boolean>(name) || false);
  }

  private getConfigArrays(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    const varMap = this.getVariableSubstitutionMap();
    return names.map((name) => this.configGetArray(config, varMap, name));
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
    varMap: Map<string, string>,
    key: string
  ) {
    const configStr = config.get<string>(key) || '';
    return substituteString(configStr, varMap);
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
      varMap: Map<string, string>,
      key: string
    ) {
      let configArr = config.get<Array<string>>(key) || [];
      for(var idx = 0; idx < configArr.length; idx++)
        configArr[idx] = substituteString(configArr[idx], varMap);
      return configArr;
    }

  dispose(): void {
    this.testRunner?.dispose();
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
