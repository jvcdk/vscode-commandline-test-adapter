/**
 * @file Global constants
 */

export class Constants {
    static readonly Name = "Command Line Test Adapter";
    static readonly Id = "vscode-commandline-test-adapter";
    static readonly SettingsKey = "commandLineTestAdapter";

    // Coalesce bursts of file-watcher events into a single discovery run.
    static readonly DiscoveryDebounceMs = 250;
}
