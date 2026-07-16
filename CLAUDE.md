# Jasper Monorepo

<!-- Maintainer note (stripped from agent context): This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. -->

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
npm run lint             # ESLint over all workspaces 
npm run lint:fix         # ESLint with --fix
npm run compile          # TypeScript compile (all workspaces)
npm run watch            # incremental watch build (client + server)
npm test                 # run all tests (server → client → mcp-server); needs a live stone — usually already running
npm run test:server      # server workspace tests only
npm run test:client      # client workspace tests only
npm run test:mcp         # mcp-server workspace tests only
npm run test:server:start  # install GemStone (if needed), start a fresh test stone, write .env.test
npm run test:server:stop   # stop the test stone's Stone and NetLDI processes
npm run test:server:list   # list running GemStone processes for the test stone
npm run test:gci           # deep GCI binding tests (requires a running stone)
npm run package          # produce .vsix package

# Dev helpers
npm run dev:fresh        # launch the extension in a throwaway editor window

# End-user acceptance tests (Playwright drives a real editor window; see acceptance/)
npm run test:acceptance         # run the specs locally (opens a window — macOS can't headless it)
npm run test:acceptance:docker  # run them headless in a Linux container (no window)
npm run test:acceptance:rowan   # the Rowan add-from-git → load e2e (in-container stone)
npm run test:acceptance:seaside # the Seaside Hello World e2e (install → serve → integrated browser)
npm run test:acceptance:report  # open the HTML report / flip through per-step screenshots
```

Before considering something done, run `npm run lint && npm run compile && npm test` — **attempt them directly; a test stone is usually already running.** `npm test` includes an integration test that logs into a live stone; if none is reachable it **fails with a connection error rather than skipping** — that failure is the signal (not a reason to avoid running). Only then start one with `npm run test:server:start` and re-run. `npm run test:server:list` confirms whether a stone is already up.

<!-- Maintainer note (stripped from agent context): Be careful with the edits to this file, anything included here will be auto-loaded in the context for ALL conversations. Keep only the most relevant and non-obvious details that are needed on all conversations. And only details that agents won't typically auto-discover by browsing the code -->
