import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Some webview DOM scripts live as standalone client/src/*.js files and are read
// at runtime via `fs.readFileSync(path.join(__dirname, '..', 'src', '<name>.js'))`
// to be injected into a <script> tag. Because they are read from disk (not compiled
// into the esbuild bundle), they must be explicitly whitelisted in .vscodeignore —
// otherwise the broad `client/src/**` ignore rule drops them from the packaged .vsix.
//
// When such a file is read at module load (e.g. debuggerPanel.ts) and the module is
// imported eagerly by extension.ts, a missing file throws while loading the bundled
// extension.js, so activate() never runs and EVERY command becomes "not found" —
// exactly the v1.7.0 regression where the Marketplace build failed with
// "command 'gemstone.refreshDatabases' not found" while the dev host worked.
//
// __dirname here is client/src/__tests__, so client/src is one level up and the repo
// root (where .vscodeignore lives) is three levels up.
describe('runtime-injected webview assets are shipped in the .vsix', () => {
  const clientSrc = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const vscodeignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
  const whitelist = new Set(
    vscodeignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('!')),
  );

  // Discover every sibling .js asset referenced by the runtime-read pattern across
  // all client/src modules (so a future webview that adds one is covered automatically).
  const pattern =
    /readFileSync\(\s*path\.join\(\s*__dirname\s*,\s*['"]\.\.['"]\s*,\s*['"]src['"]\s*,\s*['"]([^'"]+\.js)['"]/g;
  const referenced = new Set<string>();
  for (const entry of fs.readdirSync(clientSrc)) {
    if (!entry.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(clientSrc, entry), 'utf8');
    for (const match of source.matchAll(pattern)) {
      referenced.add(match[1]);
    }
  }

  it('finds the known runtime-injected assets (guards against a broken scan)', () => {
    expect(referenced).toContain('listFilter.js');
    expect(referenced).toContain('methodListView.js');
    expect(referenced).toContain('debuggerView.js');
  });

  it.each([...referenced])('ships %s (exists on disk and is whitelisted in .vscodeignore)', (file) => {
    expect(fs.existsSync(path.join(clientSrc, file))).toBe(true);
    expect(whitelist.has(`!client/src/${file}`)).toBe(true);
  });
});

// The integration-test setup (npm run test:setup) downloads a full ~1GB GemStone install
// into client/tmp/. It is gitignored, so it never shows up in a clean checkout — but after
// running integration tests locally it sits on disk, and vsce packages from the working
// tree, not from git. Without an explicit ignore, `vsce package` pulls the whole tree into
// the .vsix (bloating it by ~1GB and tripping the secret scan on the product's example
// private keys). It must be excluded so packaging is safe regardless of local test state.
describe('integration-test artifacts are excluded from the .vsix', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const ignores = fs
    .readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));

  it('excludes the integration-test download directory', () => {
    expect(ignores).toContain('client/tmp/**');
  });
});

// The acceptance/ Playwright harness, the scripts/ dev helpers, .dockerignore, and the
// per-directory CLAUDE.md guides are contributor tooling — none of it is read at runtime,
// so it should never ship in the .vsix. New top-level tooling directories are not covered
// by the existing client/src, server/src, docs/** rules, so each needs its own ignore line;
// without it vsce silently bundles the whole tree (that is how acceptance/ + scripts/ first
// leaked into the 1.8.0 package).
describe('contributor tooling is excluded from the .vsix', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const ignores = fs
    .readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));

  it.each(['.github/**', 'acceptance/**', 'scripts/**', '.dockerignore', 'CLAUDE.md', '**/CLAUDE.md'])(
    'excludes %s',
    (pattern) => {
      expect(ignores).toContain(pattern);
    },
  );
});
