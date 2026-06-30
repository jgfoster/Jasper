# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Jasper is a VS Code extension (`gemstone-ide`) that provides a full GemStone/S 64 Bit Smalltalk development environment. It is a monorepo with three npm workspaces:

- **`client/`** — the VS Code extension itself (all UI, views, GCI bindings, debugger, MCP server integration)
- **`server/`** — a Language Server Protocol (LSP) server implementing Smalltalk language features (parsing, completion, hover, diagnostics, formatting, semantic tokens)
- **`mcp-server/`** — a standalone Model Context Protocol (MCP) server that exposes GemStone operations as AI-callable tools

Node version is pinned in `.nvmrc` (`nvm use` before anything else).

## Commands

```sh
nvm use                  # activate pinned Node version
npm install              # install all workspace dependencies
npm run compile          # TypeScript compile (all workspaces)
npm run watch            # incremental watch build (client + server)
npm test                 # run all tests (server → client → mcp-server)
npm run test:server      # server workspace tests only
npm run test:client      # client workspace tests only (npm test --workspace client)
npm run test:mcp         # mcp-server workspace tests only
npm run test:setup       # provision local GemStone + write .env.test (required for useIntegrationTest tests)
npm run test:gci         # separate GCI integration tests (unrelated to test:setup)
npm run package          # produce .vsix package
```

Run a single test file: `cd client && npx vitest run src/__tests__/extension.test.ts` (or use the equivalent path for the workspace you're in).

Before considering something done: `npm run compile && npm test` must pass.

## Architecture

### client workspace (`client/src/`)

The extension entry point is `extension.ts` — it registers all commands, tree views, and language features, starts the LSP client and MCP socket server, and manages the active sessions.

Key subsystems:
- **GCI bridge** (`gciLibrary.ts`) — FFI bindings to the native `libgcits` shared library via [koffi](https://github.com/Koromix/koffi). All GemStone VM calls go through here.
- **Queries** (`queries/`) — pure functions with the signature `(execute: QueryExecutor, ...args) => string`. Each builds a Smalltalk snippet and calls `execute(label, code)`. `QueryExecutor` is `(label: string, code: string) => string` — the caller supplies it, so the same query works in the extension (where the executor wraps `gciLibrary`) and in the MCP server (its own session). Helpers in `util.ts` (`escapeString`, `classLookupExpr`, etc.) are shared across queries.
- **Views** — each major UI surface is its own module: `systemBrowser.ts`, `globalsBrowser.ts`, `gtInspector.ts`, `debuggerPanel.ts`, `classBrowser.ts`. They run in the extension host and communicate with their webview counterparts via `webview.postMessage()` / `window.addEventListener('message', ...)`.
- **Webview scripts** (`debuggerView.js`, `listFilter.js`, `methodListView.js`) — plain JavaScript that runs in the webview (browser-like DOM), **not** compiled into the extension bundle. Each is read at runtime via `fs.readFileSync` and injected as a `<script>` tag. They expose globals (`DebuggerView`, `ListFilter`, etc.) consumed by the webview HTML. They live in separate files so they can be unit-tested in jsdom. New webview-side behavior should follow this pattern.
- **Class sync** (`sync/`) — the incremental class-export engine used by `exportManager.ts`. `syncProtocol.ts` generates Smalltalk expressions that build a manifest and class-source payloads on the GemStone side; `syncTransport.ts` handles chunked streaming for payloads that exceed a single GCI response; `manifestDiff.ts` diffs the remote manifest against the local mirror to compute the minimal fetch/delete set; `syncFraming.ts` parses the manifest wire format.
- **Session management** (`sessionManager.ts`) — tracks open GemStone login sessions; `codeExecutor.ts` is the central dispatcher for executing Smalltalk code in a session.
- **Infrastructure** (`versionManager.ts`, `databaseManager.ts`, `processManager.ts`, `sysadminStorage.ts`) — download/extract GemStone releases, manage stone/NetLDI processes, configure OS shared memory.
- **MCP integration** (`mcpSocketServer.ts`, `mcpHttpServer.ts`, `mcpTools.ts`) — exposes GemStone operations via MCP so AI tools (Claude Desktop, Claude Code) can interact with a running GemStone session.
- **Virtual file system** (`gemstoneFileSystemProvider.ts`) — implements `gemstone://` URIs so method source can be opened, edited, and compiled in-place.
- **Debugger** (`gemstoneDebugSession.ts`, `debuggerPanel.ts`, `debugQueries.ts`) — DAP (Debug Adapter Protocol) implementation backed by GCI step/continue/inspect calls.
- **WSL support** (`wslBridge.ts`, `wslFs.ts`) — transparent Windows ↔ WSL bridging for paths and process management.

### server workspace (`server/src/`)

A standard LSP server that parses Smalltalk source files (Topaz `.gs`/`.tpz`, Tonel `.st`, GemStone Smalltalk `.gst`) and provides:
- **Lexer/Parser** (`lexer/`, `parser/`) — produces an AST for each document
- **Services** (`services/`) — completion, hover, definition, diagnostics, folding, formatting, semantic tokens, document symbols — each is a standalone module operating on the AST
- **Utilities** (`utils/`) — `DocumentManager` (LSP text-document lifecycle), `WorkspaceIndex` (cross-file symbol index), `ScopeAnalyzer`, `AstUtils`
- Format-specific parsers: `tonel/tonelParser.ts` and `topaz/topazParser.ts`

### mcp-server workspace (`mcp-server/src/`)

A standalone Node.js process that can run as stdio, SSE, or proxy transport. `tools.ts` registers MCP tools; `mcpSession.ts` wraps a GCI session for AI tool calls. Used when Claude Code or Claude Desktop connects directly (as opposed to the in-extension MCP server).

## Tests

`client/__tests__/CLAUDE.md` contains the authoritative test authoring rules — read it before writing or editing tests.

### VS Code API mocking (client workspace)

The VS Code API is not available in tests. Vitest picks up `src/__mocks__/vscode.ts` automatically — it is a comprehensive manual mock of the `vscode` module. Any test that imports extension code which touches the VS Code API gets this mock for free; no explicit import or `vi.mock()` call is needed.

The mock exposes two test helpers:
- `__resetConfig()` — clears all stored configuration values; call this in `beforeEach` if your test uses `workspace.getConfiguration`.
- `__setConfig(section, key, value)` — pre-seeds a config value before the test runs.

The two vitest setup files (`vitest.windowSetup.cjs`, `vitest.uriSetup.ts`) run before every suite. The first polyfills `CSS.escape` for jsdom environments; the second registers a custom URI equality tester so `expect(uri).toEqual(otherUri)` compares by string value rather than object identity.

Query functions in `queries/` take a `QueryExecutor` argument — in tests, pass a `vi.fn()` that returns a canned string. This avoids any GCI dependency for unit tests of query-dependent code.

### Integration tests

Tests using `useIntegrationTest` require a live GemStone instance. Run `npm run test:setup` once to provision one; it writes connection details to `.env.test`. Override with `.env.test.local` for a custom instance. CI runs these as a matrix over `client/.gemstone-integration-releases.json`.

`npm run test:gci` is a separate set of GCI integration tests — not related to `test:setup` or `useIntegrationTest`.

## GCI / native library

The GCI library (`libgcits`) is a platform-native `.so`/`.dylib`/`.dll` bundled with each GemStone distribution. `gciLibrary.ts` loads it at runtime via koffi. When adding new GCI calls, follow the struct and pointer patterns already in that file.

## GemStone documentation

`docs/3.7/` contains the GCI header files (`gcits.hf`, `gci.ht`, `gcicmn.ht`, `gcits.ht`) — the authoritative reference for GCI function signatures, struct layouts, and constants. Consult these when working with `gciLibrary.ts` or any GCI call.

