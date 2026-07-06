import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Open VSX runs a server-side secret scan (gitleaks) when publishing and rejects
// the whole upload if it finds one — with no CLI flag to allow a false positive.
// Its `hashicorp-tf-password` rule matches an assignment of the form
// `password = "<7-20 chars>"` (case-insensitive, either quote style — esbuild
// normalizes bundled literals to double quotes). GemStone's *public* default
// password 'swordfish' assigned to a `...PASSWORD` constant tripped it in 1.7.6
// and silently failed only the ovsx publish step (vsce had already succeeded).
//
// This guard fails BEFORE a release if any non-test source reintroduces that
// pattern. The fix is to name the constant so "password" is not adjacent to the
// `=` (e.g. `DEFAULT_SYSTEMUSER_PW`); the value can stay whatever it needs to be.
describe('source is free of the assignment pattern Open VSX rejects', () => {
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

  const secretAssignment = /password\w*\s*=\s*['"][A-Za-z0-9]{7,20}['"]/i;

  it('finds source files to scan (guards against a broken walk)', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it.each(sourceFiles.map((f) => [path.relative(clientSrc, f), f] as const))(
    'has no `password = "<literal>"` assignment in %s',
    (_rel, file) => {
      const offenders = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => secretAssignment.test(line));

      expect(offenders).toEqual([]);
    },
  );
});
