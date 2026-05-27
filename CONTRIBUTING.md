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

1. Update the version in `package.json` (and `package-lock.json` — both the top-level `version` and `packages."".version`) and promote the `[Unreleased]` section in `CHANGELOG.md` to a new dated `[X.Y.Z]` heading. Sweep `main` since the last release for merged PRs that didn't add their own changelog entries.
2. `npm run compile && npm test`
3. Commit the version + changelog changes (e.g. `Release X.Y.Z: <one-line summary>`).
4. `git tag -a vX.Y.Z -m "Release X.Y.Z"` — annotated tag, on the release commit.
5. `npx @vscode/vsce package` — produces `gemstone-ide-X.Y.Z.vsix` in the repo root. The previous version's `.vsix` is gitignored but stays on disk; delete it to keep the root tidy.
6. `npm run publish` — runs `vsce publish` then `ovsx publish` for the VS Code Marketplace and Open VSX. If `vsce publish` times out on the Azure DevOps Gallery API (it happens), re-run `npx @vscode/vsce publish` directly — don't re-run `npm run publish`, since the ovsx step will then double-publish and fail with "already exists."
7. `git push origin main && git push origin vX.Y.Z` — push the commit and the tag (the tag does not piggyback on the branch push).

You must be logged in with Personal Access Tokens for both publishers. To set up credentials:

```sh
npx @vscode/vsce login gemtalksystems   # VS Code Marketplace
npx ovsx create-namespace gemtalksystems -p <token>   # Open VSX (one-time)
```

`ovsx publish` reads `OVSX_PAT` from the environment (or a stored token).
