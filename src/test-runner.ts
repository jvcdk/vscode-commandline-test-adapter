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
    private readonly log: vscode.LogOutputChannel,
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

  runTest(tests: vscode.TestItem[]) {
    tests.forEach(test => {
      this.testsToRun.push(test);
      this.testRunInstance.enqueued(test);
    });
    return this.runQueue();
  }

  private async runQueue()
  {
    let nextJobId = 0;
    const jobsRunning = new Map<number, Promise<number>>();

    try {
      while(this.testsToRun.length > 0 || jobsRunning.size > 0) {
        while(jobsRunning.size < this.cpuCount) {
          const test = this.testsToRun.shift();
          if(test == undefined)
            break;
          const id = nextJobId++;
          jobsRunning.set(id, this.doRunTest(test).then(() => id));
        }

        if(jobsRunning.size > 0) {
          const id = await Promise.race(jobsRunning.values());
          jobsRunning.delete(id);
        }
      }
    } finally {
      this.testRunInstance.end();
    }
  }

  private async doRunTest(test:vscode.TestItem) : Promise<void> {
    if(this.token.isCancellationRequested || this.cancelRequested) {
      this.testRunInstance.skipped(test);
      return;
    }

    const data = this.testData.get(test);
    if(data == undefined) {
      this.log.error(`Could not find internal data for test ${test.label}.`);
      this.testRunInstance.failed(test, new vscode.TestMessage(`Error: Could not find internal data for test ${test.label}.`));
      return;
    }

    if(data.command == "") {
      this.testRunInstance.skipped(test);
      test.children.forEach(test => this.testsToRun.push(test))
      return;
    }

    this.testRunInstance.started(test);

    const args = data.args.map(arg => `"${arg}"`).join(" ");
    this.testRunInstance.appendOutput(`Running test '${test.label}', command: ${data.command} ${args}\r\n`);
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
      else {
        const msg = this.makeTestMessage(test, tailLines(result.stdOut, 20) || "Test failed. Please see test log.");
        this.testRunInstance.failed(test, msg, Date.now() - start);
        this.skipChildren(test);
      }
    } catch(e) {
      const text = e instanceof Error ? e.message : String(e);
      const msg = this.makeTestMessage(test, text);
      this.testRunInstance.errored(test, msg, Date.now() - start);
      this.testRunInstance.appendOutput(text);
      this.testRunInstance.appendOutput("\r\n");
      this.skipChildren(test);
    } finally {
      this.activeProcesses.delete(handle);
    }
  }

  private makeTestMessage(test: vscode.TestItem, text: string): vscode.TestMessage {
    const msg = new vscode.TestMessage(text);
    if(test.uri && test.range)
      msg.location = new vscode.Location(test.uri, test.range);
    return msg;
  }

  private skipChildren(test: vscode.TestItem) {
    test.children.forEach(child => {
      this.testRunInstance.skipped(child);
      this.skipChildren(child);
    });
  }

  public dispose(): void {
    this.cancelRequested = true;
    this.killAll();
    this.tokenDisposable.dispose();
  }
}

function tailLines(text: string, count: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-count).join('\n').trim();
}
