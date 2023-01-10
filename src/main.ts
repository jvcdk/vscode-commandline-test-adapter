/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { CommandLineTestAdapter } from './commandline-test-adapter';
import { Constants } from './constants';

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

  const log = vscode.window.createOutputChannel(Constants.Name);
  context.subscriptions.push(log);

  const controller = vscode.tests.createTestController(Constants.Id, Constants.Name);
  context.subscriptions.push(controller);

  const adapter = new CommandLineTestAdapter(controller, workspaceFolder, log);
  context.subscriptions.push(adapter);

  controller.resolveHandler = () => adapter.discoverTests();
  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => adapter.runTest(request, token));
  controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => adapter.debugTest(request, token));

  const command = Constants.Id + '.rediscoverTests';
  context.subscriptions.push(vscode.commands.registerCommand(command, () => adapter.discoverTests()));
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("*", adapter));

  adapter.setupFileWatchers();

  vscode.workspace.onDidChangeConfiguration((ev) => {
    if(ev.affectsConfiguration(Constants.SettingsKey + ".discoveryCommand") || ev.affectsConfiguration(Constants.SettingsKey + ".discoveryArgs"))
      adapter.discoverTests();

    if(ev.affectsConfiguration(Constants.SettingsKey + ".watch"))
      adapter.setupFileWatchers();
  });
}

export function deactivate() {}
