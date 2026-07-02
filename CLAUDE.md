# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Jasper is a VS Code extension (`gemstone-ide`) that provides a full GemStone/S 64 Bit Smalltalk development environment. It is a monorepo with three npm workspaces:

- **`client/`** — the VS Code extension itself (UI, views, GCI bindings, debugger, MCP integration). Entry point: `client/src/extension.ts`.
- **`server/`** — a Language Server Protocol (LSP) server for Smalltalk (parsing, completion, hover, diagnostics, formatting, semantic tokens) under `server/src/`.
- **`mcp-server/`** — a standalone Model Context Protocol (MCP) server exposing GemStone operations as AI-callable tools under `mcp-server/src/`.

Node version is pinned in `.nvmrc` (`nvm use` before anything else).

## Commands

```sh
nvm use                  # activate pinned Node version
npm install              # install all workspace dependencies
npm run compile          # TypeScript compile (all workspaces)
npm run watch            # incremental watch build (client + server)
npm test                 # run all tests (server → client → mcp-server); needs a running test stone (see done-gate below)
npm run test:server      # server workspace tests only
npm run test:client      # client workspace tests only
npm run test:mcp         # mcp-server workspace tests only
npm run test:server:start  # install GemStone (if needed), start a fresh test stone, write .env.test
npm run test:server:stop   # stop the test stone's Stone and NetLDI processes
npm run test:server:list   # list running GemStone processes for the test stone
npm run test:gci           # deep GCI binding tests (requires a running stone)
npm run package          # produce .vsix package
```

Run a single test file: `cd client && npx vitest run src/__tests__/extension.test.ts`.

Before considering something done: `npm run compile && npm test` must pass. `npm test` bundles an automatic integration test that logs into a live stone, so run `npm run test:server:start` once first — without a running test stone `npm test` **hard-fails** (it does not skip).

## Conventions (non-standard — read before editing these areas)

- **Queries** (`client/src/queries/`) are pure functions `(execute: QueryExecutor, ...args) => string` that build a Smalltalk snippet and call `execute(label, code)`. `QueryExecutor` is `(label: string, code: string) => string`, supplied by the caller, so the same query runs in the extension (executor wraps `gciLibrary`) and in the MCP server (its own session). Shared helpers live in `util.ts` (`escapeString`, `classLookupExpr`, …).
- **Webview scripts** (`debuggerView.js`, `listFilter.js`, `methodListView.js`, `enhancedInspectorColumns.js`) are plain JS that runs in the webview DOM, **not** compiled into the extension bundle. They are read at runtime via `fs.readFileSync` and injected as `<script>` tags, and live in separate files so they can be unit-tested in jsdom. Follow this pattern for new webview behavior.

## Architecture

`client/src/extension.ts` registers all commands, tree views, and language features, starts the LSP client and MCP socket server, and manages sessions. Major client subsystems: GCI bridge (`gciLibrary.ts`), views (`systemBrowser.ts`, `globalsBrowser.ts`, `enhancedInspector.ts`, `debuggerPanel.ts`, `classBrowser.ts`), class sync (`sync/`), sessions (`sessionManager.ts`, `codeExecutor.ts`), Transcript sink (`transcriptSink.ts` — server-side Transcript with live streaming), infrastructure (`versionManager.ts`, `databaseManager.ts`, `processManager.ts`, `sysadminStorage.ts`), virtual FS (`gemstoneFileSystemProvider.ts`), debugger (`gemstoneDebugSession.ts`, `debugQueries.ts`), WSL support (`wslBridge.ts`, `wslFs.ts`). The `server/` LSP parses Topaz (`.gs`/`.tpz`), Tonel (`.st`), and GemStone Smalltalk (`.gst`) into an AST with per-feature services under `server/src/services/`.

<!-- Maintainer note (stripped from agent context): this map is intentionally lean. Deeper per-subsystem detail lives in .claude/rules/ (GCI, class sync, MCP) and in client/src/__tests__/CLAUDE.md; all auto-load by path when relevant files are opened. Don't re-expand the map above. -->
