# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.1.1
Minor bugfix in handling launch of debug sessions.

## 1.1.0
Implemented support for launching debug sessions via setting `commandLineTestAdapter.debugConfig` or test property `debugConfig`.

## 1.0.0
Nothing new (except 3rd party vulnerability update) but I wanted to indicate that I see this plugin as mature and usable.

## 0.4.3
Bugfix in output handling from test commands.

## 0.4.2
 * When running tests, stderr is now merged to stdout (during run) to preserve order of output.
 * Implement override option of setting testFolder for each test case.
 * Implement variable substitution in test parameters: Command, args, and testFolder.
 * When tests are re-discovered, pre-existing tests are preserved in Test Explorer UI.

## 0.4.1
Bugfix.

## 0.4.0
 * Implemented file watcher feature.
 * Implemented on-settings-changed hook (updating the extension).
 * Added demo example.
 * Minor bug fixes.
 * Added icon.
 * Removed non-needed files. Both from repo and from package.

## 0.3.3
Bugfix.

## 0.3.2
 * Bugfix in console output.
 * Added refresh-test command.

## 0.3.1
Updated dependencies to fix vulnerabilities.

## 0.3.0
* Implemented the parallel option.
* Renamed option parallelJobs to cpuCount. Defaults to use `nproc` to detect number of CPUs.

## 0.2.2
Yet another try. Learning here.

## 0.2.1
Yet another try. Learning here.

## 0.1.1
Added missing files to package.

## 0.1.0
Initial release.
