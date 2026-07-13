import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import * as vscode from 'vscode';
import { QueryExecutor } from '../queries/types';
import { runOnlineExtentBackup, ExtentBackupDeps } from '../extentBackupManager';

// A fake GCI executor that answers each bracketing call by matching the emitted
// Smalltalk. Override any response to drive a failure path.
function makeExecutor(over: Partial<Record<'fullLogging' | 'extents' | 'suspend' | 'resume', string>> = {}) {
  const r = { fullLogging: 'true', extents: '/db/data/extent0.dbf\n', suspend: 'OK', resume: 'OK', ...over };
  return vi.fn<QueryExecutor>((_label, code) => {
    if (code.includes('FULL_LOGGING')) return r.fullLogging;
    if (code.includes('SystemRepository fileNames')) return r.extents;
    if (code.includes('suspendCheckpointsForMinutes')) return r.suspend;
    if (code.includes('resumeCheckpoints')) return r.resume;
    return '';
  });
}

function makeDeps(execute: QueryExecutor, over: Partial<ExtentBackupDeps> = {}): ExtentBackupDeps {
  return {
    execute,
    stoneName: 'gs64stone',
    dbPath: '/db',
    dataDir: '/db/data',
    listDataFiles: vi.fn(() => ['extent0.dbf']),
    ensureDir: vi.fn(),
    copyFile: vi.fn(),
    fileExists: vi.fn(() => true),
    ...over,
  };
}

// The order index of the execute() call whose Smalltalk contains `needle`.
function callOrder(execute: QueryExecutor, needle: string): number {
  const spy = execute as unknown as { mock: { calls: [string, string][]; invocationCallOrder: number[] } };
  const i = spy.mock.calls.findIndex(([, code]) => code.includes(needle));
  return i === -1 ? -1 : spy.mock.invocationCallOrder[i];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: '/chosen' } as vscode.Uri]);
});

describe('runOnlineExtentBackup', () => {
  it('suspends, copies each extent, then resumes — in that order', async () => {
    const execute = makeExecutor();
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(true);
    expect(deps.copyFile).toHaveBeenCalledWith(
      '/db/data/extent0.dbf',
      expect.stringMatching(/\/chosen\/gs64stone_extents_[\d-]+_[\d-]+\/extent0\.dbf$/),
    );
    const copyOrder = (deps.copyFile as unknown as { mock: { invocationCallOrder: number[] } })
      .mock.invocationCallOrder[0];
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBeLessThan(copyOrder);
    expect(copyOrder).toBeLessThan(callOrder(execute, 'resumeCheckpoints'));
  });

  it('tells the user where the snapshot went and that restore needs the tranlogs', async () => {
    const deps = makeDeps(makeExecutor());

    await runOnlineExtentBackup(deps);

    const message = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0] as string;
    expect(message).toContain('written to');
    expect(message).toContain('transaction logs');
  });

  it('refuses to run in partial-logging mode without touching checkpoints', async () => {
    const execute = makeExecutor({ fullLogging: 'false' });
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).not.toHaveBeenCalled();
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBe(-1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('takes no backup when checkpoints cannot be suspended', async () => {
    const execute = makeExecutor({ suspend: 'FAILED' });
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).not.toHaveBeenCalled();
    expect(callOrder(execute, 'resumeCheckpoints')).toBe(-1);
  });

  it('resumes checkpoints even when copying an extent fails', async () => {
    const execute = makeExecutor();
    const deps = makeDeps(execute, {
      copyFile: vi.fn(() => { throw new Error('disk full'); }),
    });

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(callOrder(execute, 'resumeCheckpoints')).toBeGreaterThan(-1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('flags the copy as unusable when checkpoints resumed too early', async () => {
    const deps = makeDeps(makeExecutor({ resume: 'FAILED' }));

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).toHaveBeenCalled();
    const error = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0] as string;
    expect(error).toContain('NOT usable');
  });

  it('does nothing when the user cancels the folder picker', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
    const execute = makeExecutor();
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBe(-1);
    expect(deps.copyFile).not.toHaveBeenCalled();
  });

  it('scans the data directory for extents when the stone lists none, skipping tranlogs', async () => {
    const execute = makeExecutor({ extents: '' });
    const deps = makeDeps(execute, {
      listDataFiles: vi.fn(() => ['extent0.dbf', 'tranlog0.dbf', 'extent1.dbf']),
    });

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(true);
    expect(deps.copyFile).toHaveBeenCalledTimes(2);
    const copied = (deps.copyFile as unknown as { mock: { calls: [string, string][] } })
      .mock.calls.map(([src]) => src);
    expect(copied).toEqual(['/db/data/extent0.dbf', '/db/data/extent1.dbf']);
  });
});
