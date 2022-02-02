import * as vscode from 'vscode';
import { TestInternalData } from './test-internal-data'
import { runExternalProcess } from './extprocess';

export class TestRunner {
  private internalJobCount : number = 0;
  private cancelRequested: boolean = false;

  constructor(
    private readonly testRunInstance: vscode.TestRun,
    private readonly testData: WeakMap<vscode.TestItem, TestInternalData>,
    private readonly log: vscode.OutputChannel,
    private readonly token: vscode.CancellationToken,
    private readonly translateNewlines: boolean,
  ) { }

  async runTest(tests: vscode.TestItem[]) {
    if(this.token.isCancellationRequested || this.cancelRequested)
      return;

    tests.forEach(test => this.doRunTest(test));
  }

  private async doRunTest(test:vscode.TestItem) {
    if(this.token.isCancellationRequested || this.cancelRequested)
      return;

    let data = this.testData.get(test);
    if(data == undefined) {
      this.log.appendLine(`Error: Could not find internal data for test ${test.label}.`);
      return;
    }

    if(data.command == "")
      return;

    this.internalJobCount++;

    let args = data.args.map(arg => `"${arg}"`).join(" ");
    this.testRunInstance.appendOutput(`Running test ${test.label}, command: ${data.command} ${args}`);

    test.busy = true;
    const start = Date.now();
    try {
      await runExternalProcess(data.command, data.args, data.testFolder, this.translateNewlines).then((result) => {
        if(result.stdOut.length > 0)
          this.testRunInstance.appendOutput(result.stdOut.join("\r\n"));

          let errMsg = "";
          if(result.stdErr.length > 0) {
            errMsg = result.stdErr.join("\r\n");
            this.testRunInstance.appendOutput(errMsg); // Work-around: At the moment it seems that the UI does not show message from testRunInstance.failed(...)
          }

        if(result.returnCode == 0) {
          this.testRunInstance.passed(test, Date.now() - start);

          if(result.stdErr.length > 0)
            this.testRunInstance.appendOutput(result.stdErr.join("\r\n"));

          let children: vscode.TestItem[] = [];
          test.children.forEach(test => children.push(test))
          this.runTest(children);
        }
        else {
          this.testRunInstance.failed(test, new vscode.TestMessage(errMsg), Date.now() - start);
        }
      });
    } catch(e) {
      this.testRunInstance.errored(test, new vscode.TestMessage(e.message), Date.now() - start);
      this.testRunInstance.appendOutput(e.message); // Work-around: At the moment it seems that the UI does not show message from testRunInstance.errored(...)
    }

    test.busy = false;
    this.internalJobCount--;

    if(this.internalJobCount == 0)
      this.testRunInstance.end();
  }

  public dispose(): void {
    this.cancelRequested = true;
  }
}
