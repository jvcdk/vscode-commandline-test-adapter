/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { CommandLineTestAdapter } from './commandline-test-adapter';

/**
 * Main extension entry point
 *
 * Code is from the vscode-example-test-adapter extension template
 */
export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

  // If we have not a folder opened, then there is nothing to do
  if(workspaceFolder == undefined)
    return;

  const log = vscode.window.createOutputChannel("Command Line Test Adapter");
  context.subscriptions.push(log);

  const controller = vscode.tests.createTestController("vscode-commandline-test-adapter", "Command Line Test Adapter");
  context.subscriptions.push(controller);

  const adapter = new CommandLineTestAdapter(controller, workspaceFolder, log);
  context.subscriptions.push(adapter);

  controller.resolveHandler = () => adapter.discoverTests();
  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => adapter.runTest(request, token));

  const command = 'vscode-commandline-test-adapter.rediscoverTests';
  context.subscriptions.push(vscode.commands.registerCommand(command, () => adapter.discoverTests()));
}

export function deactivate() {}
