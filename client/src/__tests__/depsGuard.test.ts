import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// The dependency-freshness guard (scripts/deps-guard.mjs, run via check-deps.mjs
// on `pretest` and write-install-stamp.mjs on `postinstall`) is exercised here as
// a subprocess against a throwaway fixture repo. DEPS_GUARD_ROOT points the guard
// at the fixture instead of the real repo. __dirname is client/src/__tests__, so
// the repo root (where scripts/ lives) is three levels up.
const scriptsDir = path.resolve(__dirname, '..', '..', '..', 'scripts');
const checkScript = path.join(scriptsDir, 'check-deps.mjs');
const stampScript = path.join(scriptsDir, 'write-install-stamp.mjs');

function run(script: string, root: string): { code: number; out: string } {
  const r = spawnSync('node', [script], {
    env: { ...process.env, DEPS_GUARD_ROOT: root },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('dependency-freshness guard', () => {
  const currentMajor = process.versions.node.split('.')[0];
  const tempRepos: string[] = [];

  function fixture(opts: { lock: string; nvmrc?: string }): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depsguard-'));
    tempRepos.push(dir);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), opts.lock);
    if (opts.nvmrc !== undefined) fs.writeFileSync(path.join(dir, '.nvmrc'), opts.nvmrc);
    return dir;
  }

  afterEach(() => {
    while (tempRepos.length) fs.rmSync(tempRepos.pop()!, { recursive: true, force: true });
  });

  it('passes once an install has stamped the current lockfile', () => {
    const root = fixture({ lock: '{"v":1}', nvmrc: `${currentMajor}.0.0` });
    run(stampScript, root);

    const { code } = run(checkScript, root);

    expect(code).toBe(0);
  });

  it('fails when the lockfile changed since the last install', () => {
    const root = fixture({ lock: '{"v":1}', nvmrc: `${currentMajor}.0.0` });
    run(stampScript, root);
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"v":2}');

    const { code, out } = run(checkScript, root);

    expect(code).toBe(1);
    expect(out).toMatch(/out of sync|npm install/i);
  });

  it('fails when nothing has been installed yet (no stamp)', () => {
    const root = fixture({ lock: '{"v":1}', nvmrc: `${currentMajor}.0.0` });

    const { code } = run(checkScript, root);

    expect(code).toBe(1);
  });

  it('warns without failing when Node is off the pinned major version', () => {
    const otherMajor = String(Number(currentMajor) + 1);
    const root = fixture({ lock: '{"v":1}', nvmrc: `${otherMajor}.0.0` });
    run(stampScript, root);

    const { code, out } = run(checkScript, root);

    expect(code).toBe(0);
    expect(out).toMatch(/nvm use|\.nvmrc/i);
  });

  it('stays quiet when Node matches the pinned major version', () => {
    const root = fixture({ lock: '{"v":1}', nvmrc: `${currentMajor}.99.99` });
    run(stampScript, root);

    const { code, out } = run(checkScript, root);

    expect(code).toBe(0);
    expect(out).not.toMatch(/nvm use/i);
  });
});
