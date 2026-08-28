/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { CommandLineTestAdapter } from './commandline-test-adapter';
import { Constants } from './constants';

interface WorkspaceAdapterInstance {
  readonly folder: vscode.WorkspaceFolder;
  readonly controller: vscode.TestController;
  readonly adapter: CommandLineTestAdapter;
}

export async function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel(Constants.Name, { log: true });
  context.subscriptions.push(log);

  const instances = new Map<string, WorkspaceAdapterInstance>();

  const hasDiscoveryCommand = (workspaceFolder: vscode.WorkspaceFolder) => {
    const command = vscode.workspace
      .getConfiguration(Constants.SettingsKey, workspaceFolder.uri)
      .get<unknown>('discoveryCommand');
    return typeof command === 'string' && command.trim().length > 0;
  };

  const addWorkspaceFolder = (workspaceFolder: vscode.WorkspaceFolder) => {
    const key = workspaceFolder.uri.toString();
    if(instances.has(key))
      return;

    if(!hasDiscoveryCommand(workspaceFolder)) {
      log.info(`[${workspaceFolder.name}] Not a test workspace folder: ${Constants.SettingsKey}.discoveryCommand is not set.`);
      return;
    }

    // Derive the controller id from the folder uri so it stays stable across
    // sessions. VS Code keys persisted test state by controller id; a running
    // counter would reassign identities whenever roots are reordered, added or
    // unconfigured.
    const controller = vscode.tests.createTestController(
      `${Constants.Id}-${key}`,
      `${Constants.Name}: ${workspaceFolder.name}`
    );
    const adapter = new CommandLineTestAdapter(controller, workspaceFolder, log);

    controller.resolveHandler = () => adapter.discoverTests();
    controller.refreshHandler = () => adapter.discoverTests();
    controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => adapter.runTest(request, token));
    controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => adapter.debugTest(request, token));

    adapter.setupFileWatchers();
    instances.set(key, { folder: workspaceFolder, controller, adapter });
  };

  const removeWorkspaceFolder = (workspaceFolder: vscode.WorkspaceFolder) => {
    const key = workspaceFolder.uri.toString();
    const instance = instances.get(key);
    if(instance == undefined)
      return;

    instance.adapter.dispose();
    instance.controller.dispose();
    instances.delete(key);
  };

  for(const workspaceFolder of vscode.workspace.workspaceFolders ?? [])
    addWorkspaceFolder(workspaceFolder);

  const command = Constants.Id + '.rediscoverTests';
  context.subscriptions.push(vscode.commands.registerCommand(command, () =>
    Promise.all(Array.from(instances.values(), instance => instance.adapter.discoverTests()))
  ));

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    for(const workspaceFolder of event.removed)
      removeWorkspaceFolder(workspaceFolder);
    for(const workspaceFolder of event.added)
      addWorkspaceFolder(workspaceFolder);
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((ev) => {
    for(const folder of vscode.workspace.workspaceFolders ?? []) {
      const resource = folder.uri;
      const discoveryCommandChanged = ev.affectsConfiguration(
        Constants.SettingsKey + ".discoveryCommand",
        resource
      );

      if(discoveryCommandChanged) {
        if(hasDiscoveryCommand(folder))
          addWorkspaceFolder(folder);
        else
          removeWorkspaceFolder(folder);
      }

      const instance = instances.get(folder.uri.toString());
      if(instance == undefined)
        continue;

      if(discoveryCommandChanged ||
         ev.affectsConfiguration(Constants.SettingsKey + ".discoveryArgs", resource) ||
         ev.affectsConfiguration(Constants.SettingsKey + ".testFolder", resource))
        instance.adapter.discoverTests();

      if(ev.affectsConfiguration(Constants.SettingsKey + ".watch", resource))
        instance.adapter.setupFileWatchers();
    }
  }));

  context.subscriptions.push({
    dispose: () => {
      for(const instance of instances.values()) {
        instance.adapter.dispose();
        instance.controller.dispose();
      }
      instances.clear();
    }
  });
}

export function deactivate() {}
