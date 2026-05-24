# Contributing to Jasper

## Setting up NVM and Node.js

This project uses Node Version Manager (NVM) so contributors run a consistent Node.js version. The project includes a `.nvmrc` file that pins the expected version.

1. Install NVM if you don't have it: https://github.com/nvm-sh/nvm
2. Run `nvm use` in the project root to activate the pinned version.

## Build and test

- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm test`
- Test GCI: `GCI_LIBRARY_PATH=/path/to/libgcits npm run test:gci`
- Package: `npm run package`

Before pushing changes, ensure `npm run compile && npm test` passes locally.

## Continuous integration

GitLab CI (`.gitlab-ci.yml`) runs `npm run compile` and `npm test` on every push. The pipeline runs on Node 24.15.0 (matching `.nvmrc`) and uploads the built `client/out/`, `server/out/`, and `mcp-server/out/` directories as artifacts.

## Publishing a release

1. Update the version in `package.json` and add a changelog entry.
2. `npm run compile && npm test`
3. `npx @vscode/vsce package`
4. `npx @vscode/vsce publish`

You must be logged in with a Personal Access Token for the `gemtalksystems` publisher. To set up credentials:

```sh
npx @vscode/vsce login gemtalksystems
```
