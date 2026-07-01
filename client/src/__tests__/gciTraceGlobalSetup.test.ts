// Unit test for removeTraceLogs (defined in ./gci/gciTraceGlobalSetup.ts).
//
// Lives OUTSIDE __tests__/gci/ on purpose: those files are the on-demand `gci`
// project (needs a live stone, excluded from `npm test`). removeTraceLogs is
// pure filesystem logic, so it belongs in the default `unit` project where it
// runs on every `npm test` with no stone. It guards the trace-log cleanup
// against silently deleting the wrong files or leaving logs to accumulate.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTraceLogs } from './gci/gciTraceGlobalSetup';

describe('removeTraceLogs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-trace-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const touch = (name: string): void => writeFileSync(join(dir, name), '');

  it('removes trace logs named gci<pid>trace.log', () => {
    touch('gci123trace.log');
    touch('gci4567trace.log');

    removeTraceLogs(dir);

    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves files that do not match the trace-log pattern', () => {
    const kept = [
      '.gci-trace-keep',
      'gci12trace.log.bak',
      'gciTestConfig.ts',
      'gcitrace.log',
      'notes.log',
    ];
    kept.forEach(touch);
    touch('gci9trace.log');

    removeTraceLogs(dir);

    expect(readdirSync(dir).sort()).toEqual(kept);
  });

  it('does nothing when the directory has no trace logs', () => {
    touch('README.md');

    expect(() => removeTraceLogs(dir)).not.toThrow();

    expect(readdirSync(dir)).toEqual(['README.md']);
  });
});
