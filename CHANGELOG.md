# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.3.0

### Security
 * Declare `untrustedWorkspaces` and `virtualWorkspaces` capabilities so the extension is disabled in Restricted Mode.
 * Run `cpuCount` command in `testFolder` instead of an empty cwd; clarify that the setting can execute a command.
 * Document environment-variable exposure via `${env:...}` substitution.

### Bug fixes
 * Fix `cpuCount` < 1 (e.g. `"0"` or `""`) causing an infinite synchronous loop that freezes the extension host.
 * Add `'error'` handler to spawned processes and resolve on `'close'` instead of `'exit'` to prevent hangs and truncated output.
 * Kill child processes on cancellation and extension disposal instead of letting them run indefinitely.
 * Replace the global `"*"` debug configuration provider with direct config injection to avoid hijacking unrelated debug sessions.
 * Fix `request.exclude` filter inversion that silently ran zero tests when `exclude` was `undefined`.
 * Dispose the `onDidChangeConfiguration` listener on deactivation to prevent leaks.
 * Guarantee `testRun.end()` via `try/finally` and track all active runners to make them cancellable.
 * Fix `Promise.race` bookkeeping when the same TestItem is enqueued more than once.
 * Swap test data map only after a full discovery parse succeeds, preventing a half-updated tree.
 * Chain the discovery promise so concurrent callers get truthful completion.
 * Fix `isEmpty` strict-equality checks, `substituteString` infinite-loop on self-referencing env vars, and use `Array.isArray` throughout.
 * Mark children as skipped when a parent test fails or errors.
 * Handle folderless start by deferring initialization until a workspace folder is added.
 * Prevent overlapping test discovery runs.

### Improvements
 * Surface discovery failures to the user via error message notifications.
 * Report `enqueued()` / `started()` lifecycle states during test runs.
 * Add `refreshHandler` for the native Testing view refresh button.
 * Improve `TestMessage`: show output tail and attach source location instead of generic "see log" text.
 * Switch to `LogOutputChannel` with info/warn/error severity levels and user-adjustable verbosity.
 * Use command `category` field instead of baking "CommandLine Tests:" prefix into the title.
 * Improve configuration schema: add item types, defaults, and fix escaped control characters in descriptions.
 * Set marketplace category to "Testing".

### Internal
 * Upgrade toolchain: TypeScript 5, drop `tslib`, migrate from deprecated `vsce` to `@vscode/vsce`, switch to bun.
 * Add ESLint with `@typescript-eslint` flat config and a CI workflow.
 * Add `vscode:prepublish` script to ensure a fresh build before packaging.
 * Fix `.vscodeignore` to exclude top-level files from the VSIX package.
 * Remove dead runtime dependencies `split-cmd`, `split2`, and `@types/split2`.
 * Update `tsconfig`: target `es2022`, include all of `src/`, set `rootDir`.
 * Fix LICENSE copyright holder.

## 1.2.0
* When launching debug sessions: The debug configuration property `program` is changed to an absolute path (is not absolute, and `cwd` is set).

## 1.1.4
 * Update log output wording.
 * Bugfix: Could not start 'normal' debugging sessions.

## 1.1.3
No changes (erroneous publish).

## 1.1.2
Minor behavioural change: Command arguments in debug configurations are now prepended when launching 
debug session (as opposed to just overwritten).

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
