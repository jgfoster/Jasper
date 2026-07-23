import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Regression guard for the transitive dependency vulnerabilities Dependabot flagged
// on the default branch (see https://github.com/GemTalk/Jasper/security/dependabot).
//
// These are not direct dependencies — they are pulled in transitively (fast-uri via
// @modelcontextprotocol/sdk -> ajv, js-yaml via @vscode/vsce's secretlint), so the only way
// to pin them to a patched version is the root package.json `overrides` block. A plain
// `npm install` will happily resolve a fresh, still-vulnerable minor if an override is ever
// removed, and nothing else in the suite would notice — hence this test.
//
// It asserts two things:
//   1. root package.json still declares the overrides (a clear failure if one is deleted), and
//   2. every copy of each package the lockfile resolves sits at or above the patched floor
//      (so `npm ci` — what CI installs — can never regress to a flagged version).
//
// Notes on the specific advisories, so future maintainers know what these floors buy:
//   - fast-uri >= 3.1.4  GHSA-4c8g-83qw-93j6 + GHSA-v2hh-gcrm-f6hx (host confusion, high). The
//       patched 3.1.4 stays within ajv's `^3.0.0`, so the override is clean.
//   - js-yaml >= 4.3.0   GHSA-52cp-r559-cp3m (quadratic CPU via merge keys, high). Dev-only
//       (packaging tool), never shipped, but kept patched so the dashboard stays clean.
//
// @hono/node-server (GHSA-frvp-7c67-39w9, serve-static path traversal on Windows, moderate) is
// deliberately NOT pinned here. Its only patched line is 2.x, but the MCP SDK declares
// `^1.19.9`, so overriding to 2.x marks it "invalid" — which makes `npm list --production`
// exit non-zero and breaks `vsce package`/`publish` (the dependency walk that ships koffi's
// native binary). @hono/node-server is not bundled into the .vsix, and the vulnerable
// serve-static path is unreachable regardless (our MCP server uses SSEServerTransport, not the
// hono-based Streamable-HTTP transport), so we leave it at the SDK's version and dismiss the
// alert as not-affected rather than break packaging. If you re-add a hono override, expect
// packaging to fail. See CHANGELOG 1.8.9.
//
// __dirname here is client/src/__tests__, so the repo root is three levels up.
describe('transitive dependency vulnerability floors', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));

  // Patched floor for each pinned package. Keep in sync with the overrides in package.json.
  // (@hono/node-server is intentionally absent — see the note above.)
  const FLOORS: Record<string, string> = {
    'fast-uri': '3.1.4',
    'js-yaml': '4.3.0',
  };

  // Numeric-tuple >= compare, prerelease stripped. Our floors are plain releases, so this is
  // sufficient and avoids depending on an undeclared transitive `semver`.
  function gte(version: string, floor: string): boolean {
    const parse = (v: string) =>
      v
        .split('-')[0]
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const a = parse(version);
    const b = parse(floor);
    for (let i = 0; i < 3; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av !== bv) return av > bv;
    }
    return true;
  }

  // Every resolved copy of `name` in the lockfile. The installed package name is the path
  // segment after the final "node_modules/" in each lockfile key (handles nesting/dedupe).
  function resolvedVersions(name: string): string[] {
    const marker = 'node_modules/';
    const out: string[] = [];
    for (const [key, entry] of Object.entries<{ version?: string }>(lock.packages)) {
      if (!entry || typeof entry.version !== 'string') continue;
      const idx = key.lastIndexOf(marker);
      if (idx === -1) continue;
      if (key.slice(idx + marker.length) === name) out.push(entry.version);
    }
    return out;
  }

  it.each(Object.entries(FLOORS))(
    'declares an override pinning %s to at least %s',
    (name, floor) => {
      const override = pkg.overrides?.[name];
      expect(override, `package.json overrides.${name} is missing`).toBeDefined();
      // Override is a range like "^2.0.5"; strip the leading range operator for the floor check.
      const overrideFloor = String(override).replace(/^[\^~>=]*/, '');
      expect(gte(overrideFloor, floor)).toBe(true);
    },
  );

  it.each(Object.entries(FLOORS))(
    'resolves every copy of %s at or above the patched floor %s',
    (name, floor) => {
      const versions = resolvedVersions(name);
      expect(versions.length, `${name} not found in package-lock.json`).toBeGreaterThan(0);
      for (const v of versions) {
        expect(gte(v, floor), `${name}@${v} is below the patched floor ${floor}`).toBe(true);
      }
    },
  );
});
