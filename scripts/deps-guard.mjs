// Dependency-freshness guard.
//
// The recurring "Cannot find package '<x>'" failures came from node_modules
// drifting out of sync with package-lock.json: a merge/pull/branch-switch
// changed the lockfile (adding a dependency) but `npm install` wasn't re-run, so
// the new package was never installed. This guard turns that cryptic failure
// into a clear "run npm install".
//
//   - writeStamp()  (postinstall) records a hash of package-lock.json.
//   - runCheck()    (pretest) re-hashes the lockfile and compares; a mismatch or
//                   missing stamp means node_modules is stale → exit 1.
//
// It also warns (never fails) when Node doesn't match the pinned .nvmrc version,
// as a nudge to `nvm use`. It can't hard-fail on Node: the project's engines
// range is broader than the pinned dev version, and CI also tests the supported
// floor, so a strict "must be .nvmrc" gate would break those runs.
//
// The repo root defaults to this file's parent; DEPS_GUARD_ROOT overrides it so
// the guard can be exercised against a fixture directory in tests.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = process.env.DEPS_GUARD_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(repoRoot, 'package-lock.json');
const stampPath = join(repoRoot, 'node_modules', '.install-stamp');
const nvmrcPath = join(repoRoot, '.nvmrc');

function lockfileHash() {
  return createHash('sha256').update(readFileSync(lockPath)).digest('hex');
}

/** Record the current lockfile hash so a later runCheck() can detect drift. */
export function writeStamp() {
  const nodeModules = join(repoRoot, 'node_modules');
  if (!existsSync(nodeModules)) mkdirSync(nodeModules, { recursive: true });
  writeFileSync(stampPath, lockfileHash());
}

/** Fail (exit 1) if node_modules is out of sync with the lockfile; warn if Node
 *  doesn't match the pinned .nvmrc version. */
export function runCheck() {
  const expected = lockfileHash();
  const actual = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';
  if (actual !== expected) {
    console.error(
      '\n✖ Dependencies are out of sync with package-lock.json.\n' +
        '  The lockfile changed (e.g. after a merge, pull, or branch switch) but\n' +
        '  node_modules was not reinstalled. Run:  npm install\n',
    );
    process.exit(1);
  }

  if (existsSync(nvmrcPath)) {
    const pinned = readFileSync(nvmrcPath, 'utf8').trim();
    const pinnedMajor = pinned.split('.')[0];
    const currentMajor = process.versions.node.split('.')[0];
    if (pinnedMajor && currentMajor !== pinnedMajor) {
      console.warn(
        `\n⚠ Node ${process.versions.node} does not match the pinned ${pinned} (.nvmrc).\n` +
          '  Run  nvm use  to switch to the version this project is developed against.\n',
      );
    }
  }
}
