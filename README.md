# Command Line Test Adapter for Visual Studio Code

This is a VS Code Test Adapter plugin that allows you to use "arbitrary" command line arguments for enumerating and running test.

The basic idea is that a discovery command is used to enumerate tests in your workspace (outputs json-formatted data, see below), and each enumerated test has another command associated to run the test. A given test command passes / fails based on the exit value of the command.

This plugin uses the native test explorer API from VS Code.


## Getting started

 - Install the extension
 - Write a discovery command tool (see below) and configure `commandLineTestAdapter.discoveryCommand` to use it.
 - Open the Test view
 - Run your test using the text explorer GUI.
   - All tests can be run via the `Run Tests` toolbar button.
   - Individual tests can be run via `Run Test` on each test.
   - Groups of tests can be run via `Run Test` on each group.
 - Inspect test output via the `Show Output` toolbar button in the GUI.
 - Jump to source code with the `Go to Test` button.


## Discovery command output specification

The discovery command should output json-formatted data of the following object:

```C
struct TestItem {
  string label;         // Test name shown in Test UI
  string command;       // Test command to run
  string args[];        // Array of arguments passed to test command
  string file;          // Source file for test
  uint line;            // Line number in source file for test
  TestItem children[];  // Children of this test
}

TestItem tests[]; // Root object. Serialize this in a json-format
```

Note that

* All fields except `label` are optional.
* The recursive references; a test can have children (of same object / format) which in turn can have children etc.


## Re-discovery of tests

If the list of tests has changed in your workspace, this is not automatically reflected in the Test Explorer.
The reason for this is that VS Code invites plugins to make use of `FileWatcher`s and react to any changes
in the workspace. 

However, it is difficult for this extension (where you can run arbitrarily discovery commands) to know which
file changes to watch for, and hence this would be an expensive solution.

Instead the following solutions are implemented:

#### Refresh command
TODO

#### File Watcher specification
TODO

## Configuration

The plugin supports the following settings properties:

| Property                                   | Description                                                                                                                        | Default value
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------
| `commandLineTestAdapter.discoveryArgs`     | Array of arguments to discovery command.                                                                                           | `[]`
| `commandLineTestAdapter.discoveryCommand`  | Command to enumerate tests. Please see documentation on how output should be formatted.                                            |
| `commandLineTestAdapter.testFolder`        | Working dir for running tests and discovery command.                                                                               | `${workspaceFolder}`
| `commandLineTestAdapter.translateNewlines` | Translate newlines from '\n' to '\r\n' needed for terminal output.                                                                 | True
| `commandLineTestAdapter.cpuCount`          | Maximum number of parallel test jobs to run. Number > 1: explicit count. Number <= 1: 1 job. String: Command to run to count CPUs. | `nproc`

### Variable substitution

Some configuration properties support the replacement of special values in their string value by using a `${variable}` syntax.

The following built-in variables are expanded:

| Variable             | Expansion                                      |
| -------------------- | ---------------------------------------------- |
| `${workspaceFolder}` | The full path to the workspace root directory. |

Environments variables are prefixed with `env:`. For example `${env:HOME}` will be substituted with the home path on Unix systems.

| Variable           | Expansion                                                         |
| ------------------ | ----------------------------------------------------------------- |
| `${env:<VARNAME>}` | The value of the environment variable `VARNAME` at session start. |

Note, Windows: Variable names are case insensitive but must be uppercase for `env:` substitition to work properly.


## TODO
 - Implement refresh command.
 - Implement max parallel run of tests.
 - Implement file watcher.
 - Set up demo example (this workspace) to show how it works.
 - Add icon to project.
