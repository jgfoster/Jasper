# Changelog

All notable changes to the **GemStone Smalltalk** extension will be documented in this file.

## [Unreleased]

## [1.5.6] - 2026-06-03

### Changed

- **Workspaces are now ordinary editable files.** A GemStone workspace opens as a plain untitled `gemstone-smalltalk` document instead of a virtual `gemstone://` buffer, so you can save it to disk and track it in git — saving as `.gst` gives automatic language recognition when you reopen it. The editor commands (Display It, Execute It, Inspect It, Senders, Implementors) and language features (hover, go-to-definition, completion) now work in any `gemstone-smalltalk` file, including saved workspaces. ([#85](https://github.com/jgfoster/Jasper/pull/85))
- **Editor commands now follow the file's language, not session state.** Display It / Execute It / Inspect It and friends appear whenever the active document is `gemstone-smalltalk`, so they survive logout (workspace tabs stay open) and no longer clutter unrelated `.ts` / `.json` files. Running one without a live session prompts you to log in first. ([#79](https://github.com/jgfoster/Jasper/pull/79))
- **Open tabs are preserved across session actions.** Committing, aborting, or logging out no longer closes your open GemStone editor tabs, so your workspace and tab selection survive a session action. ([#79](https://github.com/jgfoster/Jasper/pull/79))
- **Removed the redundant Dismiss button from debuggable-error dialogs** (closing the dialog already dismisses it), and consolidated the duplicated debug-dialog logic behind a single `handleDebuggableError`. ([#86](https://github.com/jgfoster/Jasper/pull/86))

### Fixed

- **Class Hierarchy view no longer comes up empty on GemStone 3.6.8.** An em dash embedded in a Smalltalk source comment tripped a compiler cursor bug (error 1001) on 3.6.8, blanking the hierarchy view; the source no longer relies on it. Verified across 3.6.1–3.7.5. ([#84](https://github.com/jgfoster/Jasper/pull/84), fixes [#78](https://github.com/jgfoster/Jasper/issues/78))
- **Navigating between classes no longer shows the previous class's methods.** A stale method list was being pushed to the System Browser view when a new class was selected. ([#81](https://github.com/jgfoster/Jasper/pull/81))

## [1.5.5] - 2026-06-03

### Changed

- **Class export is now an incremental sync, so the local `.gemstone` mirror stays fast on large or remote images.** The old exporter filed out one class per GCI round-trip, so the first export — and the re-export after *every* login, commit, and abort — scaled with class-count × network latency: a customer with ~5500 classes on a slow link waited minutes where a local 1200-class image took under a second. Jasper now builds a single server-side manifest of per-class md5 hashes, diffs it against a persisted state (`.manifest.json`), and re-fetches only the classes that actually changed, streaming them in a handful of round-trips through a chunked transport (one server-built payload, sliced on code-point boundaries; the small case is a single round-trip). The mirror is keyed by connection target (`{workspaceRoot}/.gemstone/{host}/{stone}/{user}/…`), shared across that target's sessions, and **kept across logout** so reconnecting re-syncs the difference instead of rebuilding from scratch. A new per-login **"Sync classes"** toggle (on by default) turns the mirror off for slow/remote connections, where server-side search still works. Sync runs in a cancellable foreground progress (a cancelled run leaves a consistent partial mirror that the next sync completes) and logs size / round-trip / timing to a **"GemStone Class Sync"** output channel. This also fixes a latent truncation bug where a class whose file-out exceeded 256 KB was silently cut off.
- **Every code mutation now updates the mirror immediately**, so Find in Files and Go to Definition reflect the change before the next commit/abort: saving a method, deleting/recategorizing a method, renaming a category, deleting/moving a class, and adding/removing/reordering a dictionary. A single-class update re-files-out just that class (its hash matches the manifest, so the next sync skips it); structural changes trigger a debounced re-sync. Replaces the previous ad-hoc `mkdir`/`rmdir` pokes that bypassed the persisted state.

### Fixed

- **Editor-cursor → System Browser sync** now fires. The handler parsed the dictionary directory with the wrong separator (it looked for a `.` where the on-disk layout uses `{index}-{dictName}`), so moving the cursor within a `.gs` file never drove the browser's selection.

## [1.5.4] - 2026-06-01

### Added

- **"Logins & Sessions" tree with single-session mode by default.** The Logins and Sessions panels are now a single tree: each configured login is a row, and the sessions started from it appear as children — so a login with children is visibly connected, with no separate panel to reconcile. Session rows carry **Logout**, **Abort**, **Commit**, **Ping**, and **Open Browser** inline (plus **Export** and **Make Active Session** in the context menu), and a login can no longer be edited or deleted while it has a live session (log out first), which also guarantees every active session keeps a matching login row to nest under. A new `gemstone.sessionMode` setting governs how many sessions a login may have at once: `single` (the **default**) keeps one session at a time for a simpler mental model — the active session, the System Browser, and any open workspace can never point at different sessions — while `multiple` (beta) re-enables concurrent sessions. Existing users who relied on multiple concurrent sessions can restore that behavior with `"gemstone.sessionMode": "multiple"`.
- **Ping a session** to confirm it is still active and responsive. Ping issues a low-level GCI round-trip (fetching the size of `nil`) that needs no Smalltalk compilation or execution, so it reports liveness without disturbing the session.

### Changed

  - Use a modal dialog when asking whether to debug an error raised during Display It, Inspect It, or Execute It. This prevents workspaces from becoming stuck in the executing state if the prompt is not answered.

### Fixed

- **Databases panel running/stopped indicators are now tied to the correct version.** With two versions installed (e.g. 3.6.2 and 3.7.5) that share a stone/NetLDI name, starting one stone lit up the Stone/NetLDI nodes under *both* versions — and trying to stop the wrong one failed with an incompatible-version error. `ProcessManager.isStoneRunning` / `isNetldiRunning` now match the gslist process version against the database's configured version (`versionsMatch`, prefix-tolerant so a gslist `3.7.4` still matches a `3.7.4.3` install), so each database reflects only its own running processes. The same version guard is applied to the delete / replace-extent safety checks.

## [1.5.3] - 2026-05-31

### Added

- **Bundled GCI client libraries for secure / air-gapped installs.** Some customers run in environments where Jasper cannot download the GemStone client from `downloads.gemtalksystems.com`. Native GCI libraries placed under `resources/gci/GemStone64BitClient<version>-x86.Windows_NT/bin/` now ship inside the extension and are detected automatically (`client/src/bundledGci.ts`): the login flow, Quick Setup, the new-login version dropdown, and the Versions view all recognize a bundled version, skip the download/file-picker step, and use it directly. This release bundles the **GemStone 3.6.2** Windows x64 client (`libgcits` + `libssl` + the `msvcr100` VC++ 2010 runtime, the only non-OS dependency).
- **ARM64 guidance for the bundled (x64) libraries.** A 64-bit process can only load DLLs of its own architecture, so the bundled x64 client cannot load in an ARM64 VS Code (Windows on ARM). Jasper now hides the bundled version on ARM64 and, on login, shows a clear message directing the user to the x64 build of VS Code (which runs under emulation) — instead of a cryptic native loader error.

### Changed

- **GemStone 3.6.2 compatibility.** Jasper now connects to and works against 3.6.2 servers:
  - GCI functions added after 3.6.2 (16 in total, found via a `gcits.hf` diff) are now bound optionally, so loading an older client no longer crashes at construction over a symbol that is never called. A build-time test (`gciVersionGated.test.ts`) gates any *new* use of a post-3.6.2 function behind an explicit allowlist, so requiring 3.7+ for a code path is always a conscious, reviewed decision.
  - Login uses `GciTsLogin` (folding the NetLDI into the NRS string) rather than the post-3.6.2 `GciTsLogin_`.
  - Debugger / Inspector variable display fetches named and indexed instance variables via absolute `GciTsFetchOops` (present in 3.6.2) instead of the post-3.6.2 `GciTsFetchNamedOops` / `GciTsFetchVaryingOops`.
  - Code execution (Execute It / Display It / Inspect It) polls for completion via `GciTsSocket` + a native socket poll (`WSAPoll` on Windows, `poll(2)` on macOS/Linux) when the post-3.6.2 `GciTsNbPoll` is unavailable — keeping execution interruptible and cancellable on 3.6.2.

### Fixed

- **Inspector welcome text now matches the actual Inspect It chord.** After the 1.5.1 chord-prefix migration the empty-Inspector hint still read `Cmd+I` / `Ctrl+I`; it now reads `Cmd+K I` / `Ctrl+K I`, with a test that keeps the welcome text in sync with the keybinding.

## [1.5.2] - 2026-05-28

### Added

- **Visual feedback when the Inspector is updated.** Inspect It now raises the Inspector panel and returns focus to the active editor, and shows an amber status-bar item plus an activity-bar badge for five seconds on each inspect. Closes the silent-update gap when the Inspector is occluded by other panels — previously the only signal that an inspect-it landed was the contents quietly changing wherever the panel happened to be.
- **`AlmostOutOfStack` guard on `execute_code`, `eval_python`, and `compile_python`.** User code is now wrapped with an inner `on: AlmostOutOfStack do:` (minimal fixed-literal handler — must run with ~30 frames of headroom) and an outer `on: AbstractException do:` (rich error string for the usual DNU / ZeroDivide / SyntaxError path). A runaway recursion (e.g. dataclass self-reference) now returns a clean `Error: AlmostOutOfStack — user code exhausted the call stack` instead of taking the gem down. Lives in `client/src/queries/executeCode.ts` and applies to both MCP transport surfaces (proxy mode via Jasper's extension host, and the standalone stdio/SSE mode). ([#74](https://github.com/jgfoster/Jasper/pull/74))

## [1.5.1] - 2026-05-26

### Changed

- **Keybinding chord prefix moved from `Cmd+;` / `Ctrl+;` to `Cmd+K` / `Ctrl+K`** for Display It, Execute It, Inspect It, Open Browser, Find Class, and Find Method. The `;` prefix didn't fire reliably on non-US keyboard layouts (German QWERTZ, French AZERTY, Spanish, Nordic), where the semicolon lives on a shifted key and VS Code's matcher on Linux/X11 couldn't agree with the OS about what the user actually pressed. Letter-key chord prefixes are layout-stable on every Latin keyboard. The one collision — `Ctrl+K M` ("change language mode") — is scoped to GemStone editors only via `when: "gemstone.hasActiveSession"`, and a GemStone editor's language is fixed anyway. ([#66](https://github.com/jgfoster/Jasper/issues/66), [#70](https://github.com/jgfoster/Jasper/pull/70))
- **Display It now auto-selects the inserted result** so a single Backspace removes it — the Smalltalk workspace convention from Pharo / Squeak / VAST / VisualWorks. Previously the result stayed unselected and required either Cmd+Z or manually selecting the text before deleting; users new to Smalltalk who had typed past the result lost their cursor position when backspacing through it. The selection covers the leading space + `printString`, so one keystroke restores the editor to its pre-execution state. Execute It is unchanged (no result is inserted).
- **CI migrated from GitHub Actions to GitLab.** `.github/workflows/health-check.yml` is replaced by `.gitlab-ci.yml`; the upstream repo now lives on GitLab and the pipeline runs there.

### Fixed

- **Extension folder (`~/.jasper`) is now created on activation** if it doesn't already exist. Previously, on a fresh install the folder was assumed to exist, so the first subsystem to write into it — the MCP Unix socket at `~/.jasper/mcp.sock`, the owner sidecar at `~/.jasper/mcp.owner.json`, or any other artifact resolved via `extensionPathFrom(...)` — would fail with `ENOENT`. Activation now calls `initializeExtensionFolder()` first, and a failure (e.g. permission denied) is surfaced as a VS Code error notification with a **Show Details** action that opens a dedicated "Jasper" output channel. Folder-path construction is also encapsulated behind `extensionPathFrom(...)` instead of being open-coded as `path.join(os.homedir(), '.jasper', ...)` in three places. ([#69](https://github.com/jgfoster/Jasper/pull/69))
- **VSIX packaging:** restored `vsce package` after 1.5.0's `.vscodeignore` rewrite excluded `docs/**` wholesale. That broke packaging because `docs/MCP_Server_Feedback.md` is a symlink into an external (Grail) repo. Switched to an allow-list — `docs/**` is ignored, then `docs/mcp-server.md`, `docs/windows-wsl.md`, and `docs/formatter.md` are unignored — so only the three user-facing docs the README links to ship in the VSIX.

### Documentation

- **README now advertises both marketplaces** (VS Code Marketplace and Open VSX) with direct links, matching the 1.4.5 dual-publish change.

## [1.5.0] - 2026-05-24

### Added

- **"MCP Server" view in the GemStone sidebar.** Tells you at a glance whether *this* Jasper window is the MCP owner, points at the owning workspace if a different window has the role, or marks the state as "no owner yet" when no window has logged in. When this window owns it, the view also surfaces the active GemStone session label (which can change as you switch sessions — that's the session MCP tools will act on), the socket path, and the HTTPS/SSE URL (click to copy). Backed by a `~/.jasper/mcp.owner.json` sidecar so other windows can answer "if not me, who?" without IPC.
- **Stale-process detection in the Processes view.** `gslist` rows with a non-OK status (`frozen`, `killed`, `exe deleted`, …) now render with a red icon and the status prefixed onto the description. A **Delete Stale Lock File** inline action is offered on stale rows; Jasper checks that the recorded PID is either gone or has been reused by some non-`stoned`/`netldid` process before removing the `*.LCK`. Required because on macOS GemStone's own `gslist -c` can't distinguish a recycled PID from a hung server.

### Changed

- **MCP ownership is now claimed on first GemStone login, not on extension activation.** Previously the first Jasper window to activate captured the socket regardless of whether it ever logged in — leaving Claude Code talking to a window with no GemStone session. Now the window the user actually works in is the one MCP talks to. Once a window owns the socket it keeps it bound for the lifetime of the VS Code run, including across logout/login cycles: tool calls during a logged-out gap return "no session selected" and resume working the moment the user logs back in. Claude Code's MCP connection stays alive throughout.
- **Configs (Claude Code + Desktop) are written on every activation regardless of ownership.** The entries point at the fixed well-known socket path, so they're correct no matter which Jasper window ends up owning the live socket. This decouples "is the gemstone server registered with Claude Code?" from "which window happens to be serving it?"

### Removed

- **`gemstone.userManagedDictionaries` setting.** It told the exporter to skip specific dictionary names (no write, no chmod, no stale-file cleanup) and dated from an earlier layout where exports lived alongside user code. Since exports now go to a hidden `.gemstone/` directory and exported `.gs` files are marked read-only on disk (editing is via the System Browser / `gemstone://` filesystem), there's no longer a reason to mix user-managed code into the export tree. **Breaking change for users with non-empty `gemstone.userManagedDictionaries`**: those dictionaries will be exported on the next run; if you have writable code in matching paths under a custom `gemstone.exportPath`, move it elsewhere first.

### Documentation

- **New `docs/mcp-server.md`** with the MCP architecture, ownership model, per-client registration paths (Claude Code, Claude Desktop on macOS/Linux/Windows, MCP Inspector, generic stdio clients), TLS, multi-window behavior, tool catalog, and limitations. The README MCP section now points at this doc instead of carrying the deep dive.
- **README split:** Windows/WSL detail moved to `docs/windows-wsl.md`, formatter reference to `docs/formatter.md`, contributor/release instructions to `CONTRIBUTING.md`. The README becomes a tighter pitch + sidebar tour + Documentation index. Out-of-date claims fixed along the way (exported `.gs` files are read-only, not edit-to-compile; CI runs on GitLab, not GitHub Actions).

## [1.4.5] - 2026-05-23

### Changed

- **Claude Code MCP registration switched from CLI shell-out to direct user-scope file write.** Earlier versions invoked `claude mcp add` in each workspace, which wrote a *per-project* `gemstone-<hash>` entry into `~/.claude.json`'s `projects.<cwd>.mcpServers` section and required the `claude` CLI on PATH. Jasper now writes a single user-scope `mcpServers.gemstone` entry at the top level of `~/.claude.json`, so the tools are visible in every Claude Code session regardless of working directory — same model as Anthropic's hosted Gmail / Drive / Calendar connectors. Any stale per-project `gemstone` entries from earlier versions are stripped on activation. The removed `claudeCodeMcpLifecycle.ts` / `claudeCodeMcpRegistration.ts` modules (and their tests) go away with the CLI dependency.

### Added

- **One-time "Reload Window" prompt when Jasper first registers with Claude Code in a window.** Claude Code snapshots its MCP server list at session start, so the session already running in the VS Code window where Jasper just wrote the entry won't see it via `/mcp` until it re-activates. Jasper now offers a one-click reload in that exact case. Subsequent VS Code launches are silent because the entry is already in place when Claude Code starts. Suppressible via "Don't show again"; re-fires only when the entry's contents actually change (e.g. extension upgrade changing the proxy script path).
- **Regression guards for the two thinnest spots in the MCP shared-query test suite**, prompted by external feedback from a downstream Grail (GemStone-Python) project that uses Jasper's MCP server as its primary edit-test surface:
  - Multi-line `eval_python` input now has a round-trip test in `structuredQueries.test.ts` that confirms a `def`/multi-line Python source embeds verbatim into the Smalltalk `src := '...'.` literal with its real LFs preserved, and asserts no `\n`-escape mutation appears. Guards against a future "improvement" to `escapeString` that would convert newlines into `\` + `n` and SyntaxError every multi-line eval.
  - `runFailingTests`'s `MAX_MSG = 1024` per-message cap now has a *mechanism* test in addition to the existing magic-number assertion: the full `s copyFrom: 1 to: (s size min: 1024)` slice form is pinned (a bare `min:` returns the integer size — no trim would happen), and the clip is positioned before the outer `ws contents encodeAsUTF8` so 1024 remains a character-count budget rather than a byte-count budget.
- **System Browser: Run SUnit Tests context menus.** Right-clicking in any of the following columns now offers a "Run SUnit Tests" action that scopes the test run to exactly what you clicked:
  - **Dictionary column** — runs every test class belonging to the selected dictionary.
  - **Class category column** — runs every test class belonging to the selected category.
  - **Method category column** — runs only the test methods grouped under the selected category within the currently selected class.
  - **Method column** — runs the single selected test method.

### Documentation

- **README "How the MCP server starts" section** documents the activation flow end-to-end: which window claims the socket, what gets written where, and why the first-launch reload exists.

## [1.4.4] - 2026-05-11

### Changed

- **Login passwords now use VS Code's `SecretStorage` API** instead of `keytar`. SecretStorage delegates to the same OS keychains keytar did (macOS Keychain, Windows Credential Manager, Linux libsecret) but ships with VS Code itself, so there is no native binary to bundle and no per-platform prebuild matrix to maintain. Side benefits: cross-platform credential storage that actually works in published builds (the keytar binding wasn't shipping at all in 1.4.x VSIXs — saved login passwords would have failed silently with `Cannot find module 'keytar'`), VSIX size dropped, and the `node_modules/keytar/**` re-include is gone from `.vscodeignore`. Storage key changed from keytar's `(service, account)` pair to a single namespaced key `jasper-gemstone-login:${user}@${host}/${stone}`; users with keychain-backed logins from prior installs will be re-prompted for their password once and the new entry will be written into SecretStorage.
- **Tightened `.vscodeignore`** so the published VSIX only contains the three esbuild bundles plus runtime assets (48 files, down from 904). Per-file `tsc` outputs in `*/out/`, `mcp-server/node_modules/**`, `.claude/`, `*.tsbuildinfo`, `TODO.md`, and koffi's vendor/source/doc trees are no longer shipped.
- **Multi-marketplace publishing.** `npm run publish` now publishes to both the Visual Studio Marketplace (`vsce publish`) and Open VSX (`ovsx publish`), so the extension is available to users of VSCodium, Gitpod, code-server, and other non-Microsoft VS Code distributions. Individual targets are also exposed as `npm run publish:vsce` and `npm run publish:ovsx`.

## [1.4.3] - 2026-04-29

### Added

- **Hidden-prefix class export directory** — exports default to `{workspaceRoot}/.gemstone/{session}/{index}-{dictName}` (was `{workspaceRoot}/gemstone/...`). The dot-prefix keeps it out of the way in file listings while remaining browseable in VS Code's Explorer, Quick Open, and Find in Files. Users with an existing `gemstone/` directory can either delete it or pin the prior layout via the `gemstone.exportPath` setting (e.g. `{workspaceRoot}/gemstone/{session}/{index}-{dictName}`).
- **GCI smoke-test harness** under `client/src/__tests__/gci/` (run via `npm run test:gci`, gated by `GCI_LIBRARY_PATH`). Runs each shared MCP query against a live stone, plus a curated selector probe that fails fast if any GemStone selector our queries hardcode goes missing. Skipped from the default `npm test` run; on the round it landed it caught the `sunitMatch:` / `match:` confusion the unit suite missed.

### Changed

- **`run_test_method` / `run_test_class` message column now carries the actual exception** (`MessageNotUnderstood: nil does not understand #foo`) instead of the SUnit debug recipe (`ClassTestCase debug: #testFoo`). Bypasses `TestCase>>run` and replicates `setUp` / `perform` / `tearDown` with our own `AbstractException` handler — same pattern `describe_test_failure` uses, now applied to the iterating runners.
- **`list_failing_tests` `classNamePattern` glob primitive** is now `CharacterCollection >> matchPattern:` (the public, base-class glob — works in any session) with a JS-side glob → Array parser. Agent-supplied globs like `Bytes*TestCase` are translated to the literal Array form `#('Bytes' $* 'TestCase')` server-side. Replaces an earlier `sunitMatch:` attempt that only existed when SUnit was loaded.
- **System Browser senders/implementors CodeLens split into two independent links.** The `N senders | M implementors` header row was a single `CodeLens` whose entire title was clickable but dispatched only to the senders view — half the displayed information was unreachable. Now emits a senders+implementors pair per method, matching the VS Code convention (TypeScript ships `X references | Y implementations` the same way). Each lens computes only its own count and dispatches to its own command (`gemstone.sendersOfSelector` / `gemstone.implementorsOfSelector`).
- **Single class-selection code path in the System Browser.** A hierarchy-view click and an external Implementors-of / Senders-of jump previously updated the column-list state inline without refreshing the Class Definition panel, leaving the right-hand definition stale relative to the column-list selection. Both paths now route through a shared `applyClassSelection` helper alongside the regular column click and the find-class quick-pick.

### Fixed

- **System Browser hierarchy view rendered superclasses in reverse.** `ClassOrganizer >> allSuperclassesOf:` returns root-first (`[Object, Collection, ...]`), but the query then sent `reverseDo:` to that collection — Object ended up at the deepest indent and the immediate parent appeared at indent 0. Replaced with `do:` so the order is root-first.
- **`list_failing_tests` no-args produced duplicate rows.** An SUnit abstract `TestCase`'s `suite` cascades into its concrete subclasses' suites, so when the discover-all walk also enumerated those leaves directly, every test under an abstract parent ran twice (45 duplicate `(className, selector)` pairs out of 99 unique on the probe stone). The discover-all walk now filters with `v isAbstract not`; explicit `classNames` / `classNamePattern` paths still let an agent target an abstract parent on purpose for the cascaded run.
- **`Utf8` was misidentified as an internal-storage class** in the 1.4.2 fix for the `eval_python` UTF-16 leak. `Utf8` is the *transfer protocol* — variable-byte, no character indexing, `at:put:` and `copyFrom:to:` undefined. `WriteStream on: Utf8 new` raised `rtErrShouldNotImplement` on buffer growth, breaking every error path on `eval_python` / `compile_python` and the entire output of `list_failing_tests`. The right model is to build internally in `Unicode7` (which transparently widens to `Unicode16` / `Unicode32` for non-ASCII codepoints), then call `encodeAsUTF8` once at the boundary to produce the transfer bytes — lossless, and consistent with GemStone's storage/transfer split.

## [1.4.2] - 2026-04-28

### Added

- **`list_failing_tests` `classNamePattern` parameter** — glob-filter discovered TestCase subclasses (`*` = any chars, `#` = one char) before running. E.g. `classNamePattern: "Bytes*TestCase"` runs every `Bytes*TestCase` in one round-trip. Composes with the existing `classNames` array (explicit names still win).
- **`list_failing_tests` message column now carries actual exception details** — `MessageNotUnderstood: nil does not understand #foo` instead of the SUnit debug recipe `ClassTestCase debug: #testFoo`. Each failing/erroring test is re-run with its own `AbstractException` handler to capture the live exception's `messageText`. Iteration stays in Smalltalk so it's still one GCI round-trip.

### Changed

- **`find_implementors` / `find_senders` / `find_references_to` auto-fall-back to env 1** when no `environmentId` is given and env 0 returns empty. Projects whose user code lives in env 1 (notably GemStone-Python) no longer get a misleading "no implementors found" when the method exists. Pass `environmentId` explicitly to limit to one environment.

### Fixed

- **UTF-16LE leak in `eval_python` / `compile_python` error returns.** Grail-side compile/runtime errors came back as `"E r r o r :   M e s s a g e N o t U n d e r s t o o d ..."` — `messageText` returns `Unicode16` for system errors, `, ` concatenation widened the result to Unicode16, and GCI's `Utf8`-class fetch forwarded the UTF-16LE bytes raw. The error string is now built through a `WriteStream on: Utf8 new`, which forces transcoding on write.
- **`list_failing_tests` with no arguments raised `CompileError 1001`.** The `DISCOVER_ALL_TEST_CLASSES` Smalltalk fragment had its own `| sl seen list |` temps, which can't appear inside `classes := <expr>`. The fragment is now wrapped as `[| sl seen list | ...] value` so it's a valid expression in any position.

## [1.4.1] - 2026-04-27

### Added

- **MCP `refresh` tool** — explicitly refresh the session's view of committed state (aborts only when no uncommitted changes are pending). Closes the silent-stale gap where the GCI pinned a session's read view to its transaction snapshot, so commits landed by another process (e.g. `install.sh`) were invisible until the session aborted or committed.
- **MCP `list_failing_tests` tool** — runs SUnit tests and returns only the failed/errored entries. Optional `classNames` filter for targeted subsets (otherwise discovers every TestCase subclass in the symbolList). Iteration runs in Smalltalk so an N-class invocation is one GCI round-trip.
- **MCP `list_test_classes` tool** — discovery primitive for filtering before `list_failing_tests`.
- **MCP `describe_test_failure` tool** — re-runs a single test with its own `AbstractException` handler (bypasses `TestCase>>run`, which would swallow the exception) and returns structured details: `exceptionClass`, GemStone `errorNumber`, clean `messageText`, `description`, plus `mnuReceiver` / `mnuSelector` for `MessageNotUnderstood`. Includes a multi-line `stackReport` when stack capture is supported (gem-level `GemExceptionSignalCapturesStack` is toggled around the run and restored via `ensure:`).
- **MCP `eval_python` and `compile_python` tools** — compile/transpile/execute Python source via Grail (GemStone-Python). Register unconditionally; gracefully report "Grail not detected" via runtime `objectNamed:` lookup when Grail isn't loaded. Grail-side compile and runtime errors are reported inline as `Error: <class> — <messageText>`.

### Changed

- **`status`, `run_test_class`, `run_test_method`, `list_failing_tests`, `describe_test_failure` auto-refresh-if-clean** before reading. Discards the stale-pinned view when (and only when) no uncommitted work is pending. `status` reports the new view state on a `View:` line.
- **`execute_code` accepts multi-statement bodies** — wrapped as `[<code>] value printString` so `| x | x := 42. x + 1` parses. Previously errored with "expected start of a statement" because the wrapper only accepted a single expression.
- **`find_implementors` / `find_senders` / `find_references_to` empty-result message hints at env 1** — projects whose user code lives in `environmentId: 1` (notably GemStone-Python) were getting a bare "No implementors found" that was easy to misread as "doesn't exist."
- **MCP tool validator errors name the offending parameter** — replaces zod's bare `"Invalid input: expected boolean, received undefined"` with `"Missing required parameter 'isMeta' (expected boolean)."` and `"Parameter 'isMeta' must be boolean, but received string."`. Implemented as a per-schema error map (a global one breaks the SDK's discriminated-union JSON-RPC parsing).

### Fixed

- **`runTestClass` / `runFailingTests` were sending `each testCase class name` to objects that don't respond to `#testCase`** — the items in `result failures` and `result errors` are TestCase instances themselves with only a `testSelector` ivar, not wrapper objects. On a real failure the queries would silently DNU; tests mocked the output so it wasn't caught. Now uses `each class name` / `each selector`, matching the `passed` branch.

## [1.4.0] - 2026-04-26

### Added

- **MCP HTTPS/SSE surface for URL-based connectors** — Jasper now serves the gemstone MCP server at `https://127.0.0.1:27101/sse` (port configurable via `gemstone.mcp.httpPort`) for clients whose connector UI takes a URL rather than a command to spawn (e.g. Claude Desktop's "Add custom connector" dialog). Uses the same `getSelectedSession()` routing as the stdio surface, so all 27 tools run against the user's currently active session. Binds 127.0.0.1 only — never exposed off-host.
- **Self-signed TLS certificate** — Generated on first activation and stored in the extension's global storage directory (shared across workspaces). Valid for `127.0.0.1` and `localhost`, 10-year validity, written with `0600` permissions. Required because Claude Desktop rejects plain-http URLs.
- **`GemStone: Install MCP TLS Certificate`** command — Palette action that surfaces the platform-specific trust-store install command (`security add-trusted-cert` on macOS, `certutil -user -addstore Root` on Windows, NSS db `certutil -A` on Linux) and offers to run it in a terminal, copy it to the clipboard, or copy the cert path.
- **`GemStone: Copy MCP Server URL`** command — One-click copy of the HTTPS URL for pasting into a connector dialog.
- **Claude Desktop auto-registration** — On activation, Jasper writes a per-workspace `gemstone-<hash>` entry into Claude Desktop's global `claude_desktop_config.json` and removes it on deactivation. Gated by `gemstone.mcp.registerWithClaudeDesktop` (default `true`).
- **Claude Code registration via `claude mcp add`** — Replaces the previous `.claude/settings.local.json` write with a `claude mcp add` invocation that targets `~/.claude.json`'s per-project scope (the location Claude Code actually reads). No-op when the `claude` CLI isn't on PATH.

### Changed

- **`Open MCP Inspector` is now a command-palette action** that points at the live HTTPS/SSE surface, replacing the per-database "MCP Server" tree row that previously spawned an isolated subprocess per stone with its own credentials. The Inspector terminal receives `NODE_EXTRA_CA_CERTS` so Node's TLS stack trusts Jasper's self-signed cert (the OS keychain trust does not extend to Node).

### Removed

- **Per-database "MCP Server" tree row** and the `gemstone.startMcpServer` / `gemstone.stopMcpServer` commands and their menu contributions. Superseded by the always-on HTTPS/SSE surface (net –846 lines).

### Fixed

- **Tonel method signature semantic tokens landing on the wrong column** — the selector column offset was not being threaded through `collectSemanticTokens`, causing semantic highlighting to land on the wrong column for the first line of Tonel method signatures. Thanks to @ericwinger (#52).

## [1.3.4] - 2026-04-22

### Added

- **WSL networking detection and configuration (Windows only)** — OS Configuration now surfaces a **WSL networking** row showing whether WSL is running in `networkingMode=mirrored` (where `localhost` on Windows reaches services inside WSL) or NAT mode. Detection reads `%USERPROFILE%\.wslconfig`, and `wsl --version` determines whether the installed WSL core is ≥ 2.0 (the minimum that supports mirrored mode).
- **Enable mirrored networking action** — when WSL core is ≥ 2.0 but NAT is active, a one-click action writes `networkingMode=mirrored` into `%USERPROFILE%\.wslconfig` (preserving existing sections, keys, comments, and line endings) and prompts to run `wsl --shutdown` so the change takes effect.
- **Update WSL core action** — when WSL core is < 2.0, a one-click action opens a terminal and runs `wsl --update`, then refreshes the OS Configuration state on terminal close.
- **Hosts-file fallback for Windows 10 / NAT** — under NAT networking, Jasper can write `<wsl-ip> wsl-linux` to `C:\Windows\System32\drivers\etc\hosts` so logins can use `wsl-linux` instead of a raw IP. The PowerShell script self-elevates via UAC and is idempotent — re-run it after each `wsl --shutdown` or Windows restart.
- **Services-file configuration** — detects whether `gs64ldi 50377/tcp` is present in `/etc/services` on Windows and inside WSL, and offers separate write actions for each side (PowerShell + UAC for Windows, `sudo` for WSL). With the entry in place, `startnetldi` binds to the conventional port 50377 and logins can name the port as `gs64ldi`.
- **NetLDI host tooltip and Copy Host action** — running NetLDI items on Windows+WSL now show a `Host:` line in their tooltip (`localhost` under mirrored networking, the current WSL IP otherwise) and expose a **Copy Host** inline/context action that writes the host to the clipboard for pasting into a login's Host field.

## [1.3.3] - 2026-04-19

### Fixed

- **WSL Support** — WSL support (Linux in Windows) now mostly works.
- **MCP Inspector launch on Windows** — the "Open MCP Inspector" button now invokes `npx.cmd` instead of `npx` on Windows, bypassing the `npx.ps1` PowerShell ExecutionPolicy block that prevented the inspector from starting.
- **`status` MCP tool on GemStone 3.7.x** — the Smalltalk query no longer calls `System stoneVersionReport` (which could return a SmallInteger, causing `does not understand #'do:'`) or `System modifiedObjects` (absent in some versions); it now reports user, stone, session, transaction state, and uncommitted-changes flag via reliable methods, with every streamed value coerced to a string.
- **Tree-view commands crashing from the Command Palette** — handlers for `gemstone.stopStone` and 8 other commands read `node.kind` without a guard, crashing with `Cannot read properties of undefined (reading 'kind')` when invoked from the palette (where `node` is `undefined`). All handlers now use optional chaining, and a source-scan regression test keeps them guarded.

## [1.3.2] - 2026-04-17

### Added

- **Windows client distribution support** — Jasper can now automatically download and extract the native Windows GCI client library (`libgcits-{version}-64.dll`) for connecting to remote GemStone servers from Windows without WSL. Available as a standalone **Download Windows Client** button in the Versions view and as an automatic prompt during login when the library is missing.
- **GCI auto-detection for Windows client** — the login flow checks extracted Windows client distributions (`GemStone64BitClient{version}-x86.Windows_NT/bin/`) before prompting the user to browse for a library.
- **Quick Setup downloads Windows client** — on Windows, Quick Setup now downloads and extracts both the WSL server distribution and the native Windows client distribution, then auto-registers the GCI library path.
- **Login editor shows Windows client versions** — the version dropdown in the login editor includes versions from extracted Windows client distributions on Windows.
- **Graceful handling of missing GCI functions** — the GCI library loader now tolerates functions absent from the Windows client DLL (`GciTsNbLogin`, `GciTsNbLogin_`, `GciTsNbLoginFinished`, `GciTsDebugConnectToGem`, `GciTsDebugStartDebugService`); calling them throws a descriptive error instead of failing at load time.

### Changed

- **README rewritten for Windows users** — Getting Started now leads with the simpler "connect to an existing server" path before the full local setup; new Windows Usage section explains client-only and WSL configurations; platform support table at the top.
- **`tar` instead of PowerShell for Windows extraction** — Windows client zip extraction uses `tar -xf` (built into Windows 10+) instead of `Expand-Archive`, avoiding PowerShell execution policy issues.
- **VS Code tasks use `cmd.exe` on Windows** — build tasks now specify `cmd.exe` as the shell on Windows to avoid `npm.ps1` execution policy errors.

## [1.3.1] - 2026-04-16

### Changed

- **MCP stdio now routes to the user's current session** — Jasper's extension host opens a local socket on activation and writes `.claude/settings.local.json` automatically; the MCP server runs as a thin proxy that forwards each tool call into the extension host, so Claude Code (and any other MCP client) sees exactly the session you are working in. No separate login, credentials, or keychain entries are required for the MCP flow. If no session is selected, tools return an error Claude can handle gracefully.
- **Removed "Configure Claude Code" setup** — no longer needed; the stdio MCP server is available as soon as a workspace is open.
- **Shared query layer (`client/src/queries/`)** — every GemStone query (read and write) now lives in a shared module parameterized by a `QueryExecutor` function. Both MCP surfaces (stdio proxy and SSE) and Jasper's own IDE code delegate through the same Smalltalk composition and result-parsing logic. Eliminates all duplicated inline Smalltalk between the client and MCP server.
- **`compileMethod` switched from GCI primitives to pure Smalltalk** — now uses `Behavior>>compileMethod:dictionaries:category:environmentId:` via the shared query layer instead of low-level GCI calls (`GciTsCompileMethod`, `GciTsPerform`, `GciTsNewString`, `GciTsNewSymbol`); returns a confirmation string instead of a method OOP (no caller used the OOP). Compile errors propagate through the GCI error path with line/position details as before.
- **`fileOutClass` uses global lookup by default** — resolves classes via `objectNamed:` across the symbolList instead of requiring a dictionary index. Optional `dict` parameter targets a specific dictionary when needed (e.g., export manager walking dicts to handle shadowed names correctly).
- **Class browser loads data in one round trip** — the class definition panel now fetches definition, comment, superclass dictionary name, and write-permission in a single GemStone query (`loadClassInfo`) instead of four separate calls.

### Added

- **Keychain-backed login passwords** — the login editor has a "Store password in OS keychain" checkbox. When enabled, the password is saved to the OS keychain (macOS Keychain, Windows Credential Vault, Linux libsecret) via `keytar`, keyed by `${user}@${host}/${stone}`; the settings file stores an empty password and a `password_in_keychain` flag. Editing the login reads the password back from the keychain; unchecking the box migrates the entry back to plaintext and deletes the keychain secret. Leaving the password blank still prompts on each login.
- **End-to-end MCP integration tests** — a real `McpSocketServer` is started in-process and driven by the MCP SDK's `Client` over a Unix socket (named pipe on Windows), verifying the full proxy path: tool discovery, tool dispatch to the current session, graceful "no active session" errors, and live session-switch behavior without stale caching.
- **27 MCP tools (up from 16)** — eleven new tools: `add_dictionary`, `compile_class_definition`, `delete_class`, `delete_method`, `describe_class`, `export_class_source`, `find_references_to`, `list_all_classes`, `list_dictionary_entries`, `remove_dictionary`, `set_class_comment`. Write tools flag "NOT committed automatically"; destructive tools start descriptions with "DESTRUCTIVE:".
- **`describe_class` combined tool** — returns class definition, comment, and own methods grouped by category (both sides) in one round trip; descriptions guide agents to prefer it over calling `get_class_definition` + `list_methods` separately.
- **`getClassNames` and `getDictionaryEntries` accept dictionary name or index** — MCP clients can pass a dictionary name string; Jasper's IDE callers continue using 1-based indices.
- **Shadow-safe class lookup (`classLookupExpr`)** — shared helper composes Smalltalk that resolves a class either globally (`objectNamed:`) or scoped to a specific dictionary, for correct behavior when class names are shadowed across dictionaries. Used by `describe_class`, `export_class_source`, `compile_method`, `delete_method`, `set_class_comment`, and `fileOutClass`.
- **Optional `dictionaryName` parameter on class-targeting tools** — `describe_class`, `export_class_source`, `compile_method`, `delete_method`, and `set_class_comment` accept an optional dictionary name to disambiguate shadowed class names.

## [1.3.0] - 2026-04-10

### Added

- **MCP Server for Claude Code integration** — an embedded MCP (Model Context Protocol) server that lets Claude Code interact with GemStone directly, without the Topaz CLI; the MCP server runs as a separate Node.js process with its own GCI session (isolated from the user's sessions), using SSE/HTTP transport on an auto-assigned port; lifecycle is managed via Start/Stop buttons in the Databases pane, with the port automatically written to `.claude/settings.local.json`
- **16 MCP tools** — `abort`, `commit`, `compile_method`, `execute_code`, `find_implementors`, `find_senders`, `get_class_definition`, `get_class_hierarchy`, `get_method_source`, `list_classes`, `list_dictionaries`, `list_methods`, `run_test_class`, `run_test_method`, `search_method_source`, and `status`; together these give Claude a full development workflow: browse, write, test, commit/abort, and inspect session state
- **Login selection for MCP server** — starting the MCP server prompts for a login matching the database's stone name (auto-selects if only one exists); the MCP server logs in with its own credentials, keeping full isolation from user sessions
- **Open MCP Inspector** — a button on a running MCP Server node opens the standard MCP Inspector (`@modelcontextprotocol/inspector`) in a VS Code terminal, pre-configured with the server's URL; the terminal is tracked and disposed on stop or re-open to prevent port conflicts
- **Auto-stop MCP server on stone shutdown** — stopping a stone automatically stops any running MCP server for that stone first, preventing orphaned sessions

## [1.2.3] - 2026-04-10

### Fixed

- **Parser support for `@envN:` on all message kinds** — the language server parser now correctly handles the optional `@envN:` environment specifier prefix on unary, binary, and keyword messages, including nested messages inside binary/keyword arguments and all three cascade message kinds; previously, expressions such as `Transcript @env0:show: 2 @env1:+ 3 @env2:squared` were silently dropped or had the env specifier consumed as the selector

## [1.2.2] - 2026-04-05

### Added

- **Quick Setup wizard** — one-click "Quick Setup" command that checks shared memory, downloads and extracts a GemStone version, creates a database, starts Stone and NetLDI, and creates a login — getting a new user from zero to a running environment in a single step; if shared memory is not configured, offers to run the setup script and resumes automatically when the terminal closes
- **Execution busy-state indicators** — executing code (Execute It, Display It, Inspect It) now provides layered visual feedback: the selected code dims to 40% opacity while running, a `$(sync~spin) GemStone: Executing…` spinner appears in the status bar, and the execute/display/inspect commands are disabled (greyed out in context menus, keybindings ignored) until the execution completes; all indicators clear automatically on completion or error
- **Workspace document on login** — logging in now automatically opens a "Workspace" scratch pad (`gemstone://{sessionId}/Workspace`) with a sample expression; edits are preserved in memory for the session; the document is not reopened if already open

### Changed

- **Keybindings moved to `Cmd+;` chord prefix** — all keybindings now use a two-key chord (`Cmd+; D`, `Cmd+; E`, `Cmd+; I`, `Cmd+; B`, `Cmd+; C`, `Cmd+; M`) to avoid conflicts with core VS Code shortcuts (`Cmd+D`, `Cmd+E`, `Cmd+I`) and Copilot (`Cmd+I`); `Shift` modifier removed from browser, class, and method bindings
- **Shared memory threshold lowered to 1 GB** — shared memory checks now apply settings immediately and use a 1 GB threshold instead of 4 GB
- **No breadcrumbs for Workspace documents** — Workspace (doIt) documents no longer show a misleading `_doIt` breadcrumb; document symbols are suppressed for code-only regions since they have no navigational structure

## [1.2.1] - 2026-03-26

### Added

- **Find Class command** (`Cmd+K C` / `Ctrl+K C`) — quick-pick search across all classes in all dictionaries; selecting a class navigates the System Browser to it (or opens the class definition if no browser is open)
- **Find Method command** (`Cmd+K M` / `Ctrl+K M`) — quick-pick search across all methods (instance and class side) of the currently selected class in the System Browser; if no class is selected, prompts for a class name; selecting a method navigates the browser and opens the method editor
- **FileSystem provider logging** — `gemstone://` file operations (`stat`, `readFile`, `writeFile`) now log to the GemStone output channel, making it easier to diagnose save/compile issues; entries show the URI, read-only status, and success/failure of each operation
- **Register local GemStone versions** — "Register Local Version…" button in the Versions view lets you point to an existing GemStone installation directory without downloading or extracting; registered versions appear alongside downloaded ones and can be used for databases and logins; "Unregister" removes the registration without deleting files
- **Login editor version picker** — the login editor now shows a dropdown of available GemStone versions (from extracted installations and configured GCI library paths) instead of a free-text field

### Changed

- **Selecting a class no longer opens the `.gs` file** — the class definition and method navigation are available from the browser; the file can still be opened from the file explorer if needed
- **Method category context menu simplified** — removed "New Method" from the method category context menu (it remains in the method list context menu where the new method will appear); the context menu now only shows "Rename Category" for real categories and no menu for virtual entries
- **Find Class/Method navigate only the active browser** — when multiple System Browser panels are open for the same session, Find Class, Find Method, and Implementors/Senders now navigate only the most recently focused browser instead of all of them
- **Pool Dictionaries dropdown expanded** — the Class Definition panel's Pool Dictionaries dropdown now shows all `SymbolDictionary` instances visible in the user's symbol list (not just the top-level dictionary names), so pool dictionaries stored inside other dictionaries are discoverable
- **Debugger opens methods in the bottom editor group** — clicking a stack frame in the debugger now opens the method source via a `gemstone://` URI (the same path the System Browser uses), so it appears in the bottom editor group alongside other method editors instead of the top half
- **Breadcrumbs no longer duplicate class and method names** — document symbols for `gemstone://` method editors now use just the selector as the symbol name instead of `ClassName >> selector`, since the class and method are already shown in the URI path breadcrumbs

### Fixed

- **Browser refresh preserves full selection state** — commit and abort now restore the selected class, instance/class side toggle, method category, and method list after refresh; previously only the dictionary and class category were restored
- **Method list refreshes after compile or delete** — saving a new or existing method now immediately updates the method categories and method list in the System Browser; previously the list was stale until a manual refresh or commit/abort
- **Method category defaults to "as yet unclassified"** — selecting a method or creating a new method when "** ALL METHODS **" (or no category) is selected now uses `as yet unclassified` as the category instead of the literal virtual-category name; previously saving in this state created a duplicate `** ALL METHODS **` category entry
- **New Method template opens in the bottom editor group** — "New Method" from the method list context menu now opens in the same bottom panel as other method editors instead of the top half

- **Single-quote handling in Execute It / Display It** — code containing Smalltalk string literals (e.g. `UserGlobals at: #'James' put: 'Foster'.`) no longer produces a syntax error; the wrapper had been incorrectly doubling single quotes as if embedding in a string literal, but the user code is placed directly in Smalltalk source
- **Inline diagnostics for syntax errors** — compilation and runtime errors from Execute It / Display It / Inspect It now appear as red squiggly underlines in the editor (visible in the Problems panel) instead of only as notification popups; when the GemStone compiler reports a character offset, the diagnostic highlights the specific error location; diagnostics clear automatically on the next successful execution or document edit

## [1.2.0] - 2026-03-16

### Added

- **Globals Browser** — selecting a dictionary in the System Browser opens a sortable "Globals" tab (below the browser) showing all non-class globals in that dictionary with Name, Class, and Value columns; double-clicking a row opens the global in the Inspector (or selects it if already present)
- **Class Browser** — selecting a dictionary or class in the System Browser opens a "Class Definition" tab for creating, viewing, and editing class definitions; identity row (superclass dictionary, superclass, subclass name, in dictionary, category) across the top; variable lists (instance, class, class instance, pool dictionaries) side-by-side below; options grid with hint tooltips explaining each GemStone class option; new classes default superclass to `Globals >> Object`
- **Windows support (WSL)** — system administration features (versions, databases, processes) now work on Windows by bridging commands through WSL2; auto-detects WSL availability and shows setup guidance when not installed
- **WSL bridge module** — path conversion between Windows UNC and WSL Linux paths, command spawning and synchronous execution routed through `wsl.exe`
- **Browser-driven method editing** — clicking a method in the System Browser opens it in a dedicated editor tab (via `gemstone://` URI scheme) showing only that method's source; saving the tab compiles the method in GemStone via GCI; compile errors appear as VS Code diagnostics (red squiggles) without a modal popup
- **Write-access check** — `gemstone://` editor tabs are marked read-only when the class cannot be written by the current user (`canBeWritten` is queried via GCI); new-class and new-method tabs are always writable
- **Implementors/Senders navigate the Browser** — selecting a result from "Implementors of" or "Senders of" now navigates the System Browser's five columns to the chosen method in addition to opening the method editor tab; the browser panel is revealed without stealing focus from the editor
- **Preview tabs for method editors** — method editor tabs open in VS Code preview mode (italic title) so navigating from method to method reuses the same tab; the tab becomes permanent once edited

### Changed

- **Editor layout set by System Browser** — the top/bottom split layout is now applied by the System Browser when selecting a dictionary, ensuring panels appear in the correct order; previously set by the Globals Browser
- **Removed `** GLOBALS **` category** — the System Browser's Class Categories column no longer shows a special `** GLOBALS **` entry; globals are now accessible via the dedicated Globals Browser tab
- **All exported `.gs` files are read-only** — exported files are for search and navigation only; all editing happens through the System Browser's method editor tabs; file permissions are set to 0o444 after export regardless of dictionary or user
- **`FileInManager` simplified** — removed save-interception machinery (`onWillSaveTextDocument`, content cache, differential compilation); file create/delete event handling is retained
- **Commit/abort closes method editor tabs** — open `gemstone://` method editor tabs are closed when a session commits or aborts (stale after re-export); `hasUnsavedChanges` now also checks for dirty `gemstone://` docs so commit/abort warns correctly
- Renamed extension to "Jasper: A GemStone Smalltalk IDE"
- **Auto-generated login labels** — login labels are now derived from `{user} on {stone} ({host})` instead of being manually entered; removed the label text field from the login editor
- **Simplified export paths** — removed per-login `exportPath` field; export path is now controlled solely by the global `gemstone.exportPath` setting with a new `{session}` variable; default changed from `{workspaceRoot}/gemstone/{host}/{stone}/{user}/...` to `{workspaceRoot}/gemstone/{session}/...`
- **Duplicate login** now opens the login editor (pre-filled) instead of silently creating a copy
- **Multi-session safety** — prevents multiple simultaneous logins when custom `exportPath` does not include `{session}`, avoiding file conflicts
- Reordered inline buttons: logins show delete/duplicate/login (left-to-right); sessions show logout/abort/commit
- Added icons to SysAdmin tree views (Configure OS, Versions, Databases, Processes)
- Updated repository URLs from `vscode-gemstone` to `Jasper`
- Renamed "GemStone Smalltalk Formatter" settings section to "Smalltalk Formatter"

## [1.1.1] - 2026-03-02

### Fixed

- **Linux support** — extension now runs on Linux in addition to macOS
- Pre-load `libnetldi` with `RTLD_GLOBAL` on Linux so the GCI library can resolve `HostCreateThread`
- Include the `koffi` native module in the packaged extension (`.vscodeignore` fix)
- Set `GEMSTONE` and `GEMSTONE_GLOBAL_DIR` environment variables at login so the in-process GCI library can locate the NetLDI lock file
- Reset the open-file limit (`ulimit -n 1024`) when spawning GemStone processes on Linux to prevent shared page cache sizing issues caused by Electron's high default limit
- Replace `curl`-based version download with native Node.js `https` (with redirect handling) for portability
- Use `spawnSync` instead of `execSync` for `unzip` with proper error handling

### Changed

- **Configure OS** view (formerly "Shared Memory") — now available on Linux in addition to macOS; detects shared memory via `sysctl kernel.shmmax`/`kernel.shmall` on Linux
- **RemoveIPC check** (Linux) — detects whether `RemoveIPC=no` is set in systemd logind configuration; provides a one-click setup script to prevent systemd from destroying GemStone shared memory on logout

## [1.1.0] - 2026-02-28

### Added

- **GemStone SysAdmin** — manage GemStone infrastructure directly from VS Code without needing a separate tool
- **Shared Memory view** (macOS) — detects whether macOS shared memory is configured for GemStone (requires 4 GB); when not configured, provides a one-click setup script that installs a LaunchDaemon plist
- **Version management** — browse available GemStone versions from the GemTalk downloads site; download, extract (automatic DMG mounting on macOS, unzip on Linux), and delete versions; supports both ARM and x86 on macOS and Linux
- **Database management** — create new databases via a multi-step wizard (select version, base extent, stone name, NetLDI name); automatically generates directory structure, configuration files, and copies the extent and key file; delete databases with safety checks
- **Start/Stop Stone** — start and stop GemStone stone processes with full environment configuration; inline tree view buttons with running/stopped status indicators
- **Start/Stop NetLDI** — start and stop NetLDI network listener processes; displays port number when running
- **Replace Extent** — replace a stopped stone's database extent with a fresh base extent; removes old extent and transaction logs
- **Process list** — view all running GemStone processes (stones and NetLDIs) parsed from `gslist -cvl` output with PID and port information
- **Database tree view** — hierarchical view showing each database with its stone status, NetLDI status, expandable log files, and expandable config files; click any file to open it in the editor
- **Open Terminal** — open a VS Code terminal pre-configured with all GemStone environment variables (`GEMSTONE`, `PATH`, `DYLD_LIBRARY_PATH`, etc.) and working directory set to the database path
- **Reveal in Finder** — open the database directory in the system file manager
- **Create Login from Database** — create an IDE login configuration pre-filled with the database's version, stone name, NetLDI, and auto-detected GCI library path
- **SysAdmin output channel** — all admin operations (create, delete, start, stop) are logged to the "GemStone Admin" output channel
- **Per-login export path template** — each login now has an optional `exportPath` field that accepts a template with variables `{workspaceRoot}`, `{host}`, `{stone}`, `{user}`, `{index}`, `{dictName}`; the per-login template takes precedence over the global `gemstone.exportPath` setting
- **User-managed dictionaries** — new `gemstone.userManagedDictionaries` setting lists dictionary names that the extension will never overwrite during export
- **Configurable export root** — `gemstone.exportPath` setting supports `{workspaceRoot}` variable substitution, absolute paths, and paths relative to the workspace root

### Changed

- Removed login reconciliation on connect (local/server conflict detection); replaced by user-managed dictionaries for controlling which dictionaries are owned by the developer
- Consolidated `language-configuration-tonel.json` into `language-configuration.json` (identical contents)

## [1.0.5] - 2026-02-26

### Added

- **File-based class browser** — export classes in Topaz format to the file system; open and edit classes with the standard VS Code file explorer; System Browser webview with five-column layout (dictionaries, class categories, classes, method categories, methods) with file editor below
- **Multiple browser windows** — each "Open Browser" creates a new panel; tab title updates to `Browser: ClassName` when a class is selected
- **Login export reconciliation** — on login, detects conflicts between local files and the GemStone image; offers Use Local, Use Server, Show Differences, or Skip options
- **New class template** — creating a `.gs` file in a dictionary directory auto-fills a class template and files it in to GemStone
- **Hierarchy view** — toggle between category and hierarchy views in the browser; shows superclass chain and subclasses
- **Context menus** — right-click dictionaries, classes, method categories, and methods for actions (add, delete, move, rename, run tests, inspect, senders, implementors, browse references)
- **Browse References** — right-click a dictionary or class to find all methods that reference that object via `ClassOrganizer >> referencesToObject:`
- **Drag-and-drop** — drag methods to recategorize; drag classes between dictionaries
- **Inspect non-class globals** — selecting a global in the `** GLOBALS **` category opens the object inspector
- **Multiple method environments** — `gemstone.maxEnvironment` setting controls how many method environments are displayed
- **Transcript channel** — GemStone Transcript output routed to a VS Code output channel
- **Semantic tokens** — language server provides semantic token highlighting for Smalltalk method source
- **Code lens** — inline code lens annotations in Smalltalk source files
- **Custom dictionary inspector** — inspector tree view supports drilling into SymbolDictionary entries
- **Large collection pagination** — inspector paginates large indexed collections instead of loading all elements at once

### Changed

- Dictionary directories renamed from `N. DictName` to `N-DictName` to avoid spaces in file paths (improves Topaz compatibility)
- Method reveal scrolls to top of editor pane instead of center when selecting a method in the browser

## [1.0.4] - 2026-02-19

### Added

- **SUnit Test Runner** — integrates with VS Code's native Test Explorer via the Test API; discovers all `TestCase` subclasses in the user's symbol list and their `test*` methods; run individual tests or entire test classes with pass/fail/error reporting and failure messages; test items link to method source via `gemstone://` URIs; right-click a class in the browser tree to run its SUnit tests; auto-discovers tests on session activation; refresh button in Test Explorer header
- **Line-based breakpoints** — click the gutter in a `gemstone://` method to set/clear breakpoints; maps editor lines to GemStone step points via `_sourceOffsets`; breakpoints are managed per-method and cleared on recompile
- **Selector breakpoints** — right-click a selector in a `gemstone://` method and choose "Toggle Selector Breakpoint" to set a breakpoint on that specific step point; breakpointed selectors are highlighted with a red border decoration; supports multi-keyword selectors (e.g., `assert:equals:` highlights all keyword parts); underscores recognized in selectors
- **Debug-enabled code execution** — Display It, Execute It, and Inspect It now pass `GCI_PERFORM_FLAG_ENABLE_DEBUG` so breakpoints fire during execution; errors offer a "Debug" button to open the VS Code debugger
- **Multi-environment method dictionaries** — new `gemstone.maxEnvironment` setting controls how many method environments are displayed (default 0 shows standard Smalltalk only; higher values show additional environments, e.g., Python)
- **Drag-and-drop in browser tree** — drag methods to a different category to recategorize them; drag classes to a different dictionary to move them; drag classes to a class category to reclassify them; validates same class/side/environment for method moves and rejects drops on synthetic categories
- **New Class Category command** — `+` button on dictionary nodes prompts for a category name, then opens a new-class template pre-filled with that category
- **Class categories in browser** — dictionaries now group classes by category with `** ALL CLASSES **` and `** OTHER GLOBALS **` synthetic categories; named categories show a `+` button for creating new classes in that category
- **`** ALL METHODS **` method category** — each side node includes a synthetic `** ALL METHODS **` category that lists every method alphabetically, making it easy to find methods without knowing their category
- **Index-based dictionary lookup** — all dictionary interactions (class lookup, delete, move, reclassify, reorder) now use the SymbolList index rather than name, avoiding ambiguity when two dictionaries share the same name
- **Bulk environment query** — single-round-trip `_unifiedCategorys:` query fetches all categories and selectors per environment, reducing GCI calls for remote databases
- **Object Inspector** — new sidebar tree view for inspecting GemStone objects with drill-down into named instance variables and indexed elements; pin objects via **Inspect It** (Cmd+I) or by clicking globals in the browser; reuses debugger's GCI introspection infrastructure
- **Senders Of / Implementors Of** — right-click a method in the browser tree or use the editor context menu to find senders or implementors across all dictionaries; results open in a QuickPick list and clicking an entry opens the method source
- **Token-aware selector detection** — Senders Of / Implementors Of in the editor use the language server to identify the selector at the cursor position, correctly composing multi-keyword selectors (e.g., `at:put:`)
- **Class Hierarchy** — right-click a class in the browser tree to view its superclass chain and subclasses in a QuickPick list; selecting an entry opens the class definition
- **Search Method Source** — toolbar button in the browser view to search method source code across all dictionaries using a GCI `includesString:` query
- **Workspace Symbol Provider** — Cmd+T / Ctrl+T now includes classes and methods from the active GemStone session alongside local file results
- **Browser tree sync** — the browser tree view automatically selects and reveals the node corresponding to the active `gemstone://` editor tab (methods, definitions, and comments); works with Senders Of, Class Hierarchy, back/forward navigation, and clicking tabs
- **LSP support for `gemstone-smalltalk`** — browser documents (`gemstone://` URIs) now get language server features: hover, completion, go-to-definition, find references, and diagnostics
- **Go to Definition** — Cmd+Click or F12 on a selector jumps to its implementor(s) via GCI; for class names, jumps to the class definition; uses the same LSP-based selector resolution as Senders/Implementors
- **Hover Documentation** — hovering over a selector shows its implementor count with class names and categories; hovering over a class name shows its dictionary and class comment (truncated to 500 chars)
- **Autocompletion** — GCI-backed `CompletionItemProvider` supplements LSP completions with class names from the image, instance variable names for the current class, and the full selector protocol (own + inherited); results are cached per session and class

## [1.0.3] - 2026-02-16

### Added

- **GCI library integration** — load the GemStone C Interface (`libgcits`) at runtime via [koffi](https://koffi.dev/) FFI; wrapper in `client/src/gciLibrary.ts` exposes 98 GCI functions covering login/logout, transactions, object creation/fetch/store, execution, compilation, traversal, debugging, and host utilities
- **Session management** — login button on saved logins now establishes a live GCI session; new **Sessions** tree view in the GemStone sidebar shows active connections with inline **Commit**, **Abort**, and **Logout** buttons; sessions are cleanly logged out on extension deactivation
- **GCI integration test suite** — separate vitest config (`vitest.gci.config.ts`) and `npm run test:gci` script for tests requiring the native library; 171 tests across 16 test files
- **GCI library file validation** — the login flow now validates the selected library filename against the expected `libgcits-<version>-64.<ext>` pattern
- **Login management UI** — sidebar tree view, editor panel for add/edit/duplicate/delete logins, stored in VS Code global settings
- **GCI documentation headers** — `docs/gcits.hf` and `docs/gcits.ht` for reference
- **Display It / Execute It** — execute Smalltalk code from the editor against a live GemStone session; Cmd+D inserts the `printString` result inline (with italic decoration), Cmd+E executes silently; non-blocking execution with exponential-backoff polling, progress notification after 2 seconds with soft/hard break support
- **Session selection** — selected session concept for keyboard-driven code execution; auto-selects when only one session exists, QuickPick prompt for multiple sessions; status bar item shows active session; tree view highlights selected session with distinct icon
- **Class/method browser** — sidebar tree view (Dict → Class → Definition/Comment/Instance/Class → Category → Method) with `gemstone://` virtual filesystem; click a method to open and edit in the standard editor, Cmd+S compiles; class definitions and comments are also editable documents
- **Browser operations** — new class (template), new method (template), delete method, move method to category, rename category, remove class, move class between dictionaries, add dictionary, reorder dictionaries; all accessible from tree context menus and inline buttons
- **GCI Output Channel** — all GCI queries, results, and errors are logged to a "GemStone" output channel for debugging; session login/logout events are also logged
- **Language ID reorganization** — `gemstone-topaz` for `.gs`/`.tpz` (Topaz files), `gemstone-smalltalk` for bare Smalltalk (browser documents, scratch files), `gemstone-tonel` for `.st` (Tonel files)
- **Tonel file format support** — `.st` files are now parsed as Tonel format (used by GemStone's Rowan package manager), while `.gs` and `.tpz` remain Topaz format
- New `gemstone-tonel` language ID with dedicated TextMate grammar and language configuration
- Tonel parser handles Class, Extension, and Package files with STON metadata headers
- Method bodies in Tonel files get full LSP support: hover, completion, go-to-definition, find references, document symbols, workspace symbols, diagnostics, and folding
- Tonel methods are included in the workspace index for cross-file implementor/sender lookup
- Bracket-aware method body extraction (correctly handles nested blocks, strings, and comments)
- **Debugger** — VS Code Debug Adapter Protocol (DAP) integration for debugging GemStone errors; when code execution hits an error, a "Debug" button offers to open the VS Code debugger with full stack trace, source viewing, variable inspection, stepping, continue, and expression evaluation
  - Stack trace with `ClassName>>#selector` frame names and source references
  - Click any frame to view its method source with GemStone (Smalltalk) syntax highlighting
  - "Executed Code" frame for doit expressions that triggered the error
  - Arguments & Temps scope and Receiver scope with drill-down into named/indexed instance variables
  - Step Over, Step Into, Step Out via blocking GCI calls (`gciStepOverFromLevel:` etc.)
  - Continue execution via `GciTsContinueWith` (resumes process; re-enters debug on subsequent errors)
  - Evaluate expressions in the Debug Console in the context of any stack frame
  - Restart Frame support via `trimStackToLevel:`
  - Disconnect clears the suspended GsProcess stack

## [1.0.2] - 2026-02-13

### Added

- **Workspace method index** — on startup, scans all `.gs`, `.st`, and `.tpz` files and builds an in-memory index of method selectors, class names, and message sends; incrementally updated on every edit and file-system change
- **Workspace Symbol search** (Ctrl+T / Cmd+T) — find methods across all files by selector or class name (e.g., `at:put:`, `Foo >> bar`)
- **Go to Implementors** — Cmd+click (or F12) on a message send jumps to its implementors across the workspace; correctly composes keyword selectors (`at:` vs `at:put:`)
- **Find Senders** (Find All References) — right-click a selector to find all methods that send it across the workspace
- **Configurable formatter** with settings under `gemstoneSmalltalk.formatter.*`:
  - `spacesInsideParens`, `spacesInsideBrackets`, `spacesInsideBraces`
  - `spacesAroundAssignment`, `spacesAroundBinarySelectors`, `spaceAfterCaret`
  - `blankLineAfterMethodPattern`
  - `maxLineLength` (line wrapping, 0 = off)
  - `continuationIndent` (for multi-line keyword messages)
  - `multiKeywordThreshold` (when to split keyword messages across lines)
  - `removeUnnecessaryParens` (based on Smalltalk message precedence)

### Fixed

- Hover tooltips now correctly identify instance/class variables as "variable" instead of "unary selector"

## [1.0.1] - 2026-02-10

### Fixed

- Fixed false positive "Expected ']' to close block" errors
- Fixed false positive "Expected ')' to close parenthesized expression" errors

## [1.0.0] - 2026-02-08

### Added

- GemStone Smalltalk syntax highlighting for `.gs`, `.st`, and `.tpz` files
- Topaz command language support with highlighting for 40+ commands (`run`, `doit`, `printit`, `commit`, `abort`, `login`, `logout`, `set`, `display`, `method`, `classmethod`, `category`, `fileout`, `filein`, and more)
- Topaz code block recognition for `run`, `doit`, `printit`, `method`, and `classmethod` blocks
- Smalltalk language constructs: strings, symbols, numbers, characters, arrays, byte arrays, booleans, `nil`, block syntax, pragmas, assignments, returns, and cascades
- Pseudo-variable highlighting for `self`, `super`, and `thisContext`
- Class and global variable recognition (capitalized identifiers)
- Double-quote comment syntax support
- Language configuration with bracket matching, auto-closing pairs, folding markers, and smart indentation
- Language Server Protocol (LSP) client/server architecture for advanced editor features
