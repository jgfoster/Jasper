import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Open VSX runs a server-side secret scan (gitleaks) when publishing and rejects
// the whole upload if it finds one — with no CLI flag to allow a false positive.
// Its `hashicorp-tf-password` rule matches a `password`-suffixed key immediately
// followed by a quoted literal, in BOTH forms that reach the bundle:
//   assignment:       DEFAULT_SYSTEMUSER_PASSWORD = "swordfish"
//   object property:  gs_password: "swordfish"
// (case-insensitive; esbuild normalizes bundled literals to double quotes.)
// GemStone's *public* default password 'swordfish' tripped this twice — the `=`
// form in 1.7.6, then the `:` form in 1.8.3 (the scan had tightened to flag `:`
// too) — each silently failing only the ovsx publish step (vsce had already
// succeeded). Both times only the ovsx half of `npm run publish` was affected.
//
// This guard fails BEFORE a release if any non-test source reintroduces the
// pattern. The fix is to route the value through a constant that is NOT
// `password`-suffixed (e.g. `DEFAULT_GS_PW` / `DEFAULT_SYSTEMUSER_PW`), so the
// literal never sits next to a `password` key in the bundle.
describe('source is free of the password-literal pattern Open VSX rejects', () => {
  const clientSrc = path.resolve(__dirname, '..');

  const sourceFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        sourceFiles.push(full);
      }
    }
  };
  walk(clientSrc);

  const secretAssignment = /password\w*\s*[:=]\s*['"][A-Za-z0-9]{7,20}['"]/i;

  it('finds source files to scan (guards against a broken walk)', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it.each(sourceFiles.map((f) => [path.relative(clientSrc, f), f] as const))(
    'has no `password:` or `password =` quoted literal in %s',
    (_rel, file) => {
      const offenders = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => secretAssignment.test(line));

      expect(offenders).toEqual([]);
    },
  );
});
