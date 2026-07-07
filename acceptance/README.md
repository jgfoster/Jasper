# Acceptance tests

End-user acceptance tests that drive a real VS Code window — with the Jasper
extension loaded — using [Playwright](https://playwright.dev)'s Electron support.
Where the unit tests call the extension's API, these click the actual UI: the
GemStone activity-bar item, the tree views, the command palette.

They are slow and GUI-bound, so they are **not** part of `npm test`.

## Running headless (recommended)

macOS has no headless VS Code — a real window is created and focused during the
editor's own startup, before Playwright can intervene, so a *local* run always
flashes a window and steals focus. To run without anything appearing on your
desktop, run inside the Linux container, where VS Code renders to a virtual X
display (this is also how CI runs it):

```sh
npm run test:acceptance:docker              # builds the image and runs the suite
npm run test:acceptance:docker -- isolation # run a single spec
npm run test:acceptance:report              # flip through the per-step screenshots
```

The report and traces are written back to the host under `acceptance/`, so the
report command works the same whether the run was local or containerised.

## Running locally

Only do this when you've stepped away — every local run opens a VS Code window.

```sh
npm run compile            # the extension must be built first
npm run test:acceptance    # launches VS Code and runs the specs
npm run test:acceptance:report   # flip through the per-step screenshots
```

## Flipping through screenshots

`trace: 'on'` records every action with a before/after DOM snapshot. After a run,
`npm run test:acceptance:report` opens the Playwright HTML report; open a test and
click into its trace to scrub the timeline and see the screenshot at each step —
this is the "flip through screenshots" interface, no video required.

## How VS Code is launched

`helpers/vscode.ts` downloads a pinned VS Code build (via `@vscode/test-electron`),
resolves its Electron binary, and launches it with Playwright pointed at this repo
as the extension-development path. Because Jasper is a native (koffi/GCI) extension
it runs only in desktop VS Code, not the web build.

## Scope

The first specs cover the simplest workflow — open VS Code, find the GemStone view,
see its sections — and need no running stone. Stone-backed scenarios (connect, load
a Rowan project, Hello World) boot from a pre-provisioned snapshot extent and come
later.
