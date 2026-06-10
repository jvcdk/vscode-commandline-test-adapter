import * as vscode from 'vscode';
import { TestInternalData } from './test-internal-data'
import { runExternalProcess, ExtProcessHandle } from './extprocess';

export class TestRunner {
  private cancelRequested: boolean = false;
  private testsToRun: vscode.TestItem[] = [];
  private activeProcesses = new Set<ExtProcessHandle>();
  private tokenDisposable: vscode.Disposable;

  constructor(
    private readonly testRunInstance: vscode.TestRun,
    private readonly testData: WeakMap<vscode.TestItem, TestInternalData>,
    private readonly log: vscode.OutputChannel,
    private readonly token: vscode.CancellationToken,
    private readonly translateNewlines: boolean,
    private readonly cpuCount: number,
  )
  {
    this.tokenDisposable = token.onCancellationRequested(() => this.killAll());
  }

  private killAll() {
    for(const handle of this.activeProcesses)
      handle.kill();
  }

  async runTest(tests: vscode.TestItem[]) {
    tests.forEach(test => this.testsToRun.push(test));
    this.runQueue();
  }

  private async runQueue()
  {
    const jobsRunning: Promise<vscode.TestItem>[] = []; // Must be in sync
    const testsRunning: vscode.TestItem[] = [];         // Must be in sync

    while(this.testsToRun.length > 0 || jobsRunning.length > 0) {
      while(jobsRunning.length < this.cpuCount) {
        const test = this.testsToRun.shift();
        if(test == undefined)
          break;
        testsRunning.push(test);
        jobsRunning.push(this.doRunTest(test));
      }

      if(jobsRunning.length > 0) {
        const test = await Promise.race(jobsRunning);

        const index = testsRunning.indexOf(test);
        if (index < 0)
          this.log.appendLine("Unexpected error: Could not find test item in list of running jobs.");
        else {
          testsRunning.splice(index, 1);
          jobsRunning.splice(index, 1);
        }
      }
    }

    this.testRunInstance.end();
  }

  private async doRunTest(test:vscode.TestItem) : Promise<vscode.TestItem> {
    if(this.token.isCancellationRequested || this.cancelRequested) {
      this.testRunInstance.skipped(test);
      return test;
    }

    let data = this.testData.get(test);
    if(data == undefined) {
      this.log.appendLine(`Error: Could not find internal data for test ${test.label}.`);
      this.testRunInstance.failed(test, new vscode.TestMessage(`Error: Could not find internal data for test ${test.label}.`));
      return test;
    }

    if(data.command == "") {
      this.testRunInstance.skipped(test);
      test.children.forEach(test => this.testsToRun.push(test))
      return test;
    }

    let args = data.args.map(arg => `"${arg}"`).join(" ");
    this.testRunInstance.appendOutput(`Running test '${test.label}', command: ${data.command} ${args}\r\n`);

    test.busy = true;
    const start = Date.now();
    const handle = runExternalProcess(data.command, data.args, data.testFolder, this.translateNewlines, /* mergeStderrToStdout */ true);
    this.activeProcesses.add(handle);
    try {
      const result = await handle.result;

      if(result.stdOut.length > 0)
        this.testRunInstance.appendOutput(result.stdOut);

      if(result.returnCode == 0) {
        this.testRunInstance.passed(test, Date.now() - start);
        test.children.forEach(test => this.testsToRun.push(test))
      }
      else
        this.testRunInstance.failed(test, new vscode.TestMessage("Test failed. Please see test log."), Date.now() - start);
    } catch(e) {
      this.testRunInstance.errored(test, new vscode.TestMessage(e.message), Date.now() - start);
      this.testRunInstance.appendOutput(e.message); // Work-around: At the moment it seems that the UI does not show message from testRunInstance.errored(...)
      this.testRunInstance.appendOutput("\r\n");
    } finally {
      this.activeProcesses.delete(handle);
    }

    test.busy = false;
    return test;
  }

  public dispose(): void {
    this.cancelRequested = true;
    this.killAll();
    this.tokenDisposable.dispose();
  }
}
