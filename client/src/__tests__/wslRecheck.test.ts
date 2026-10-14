import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../wslInstall', () => ({
  isWslInstalled: vi.fn(),
  isWslInstalledAsync: vi.fn(),
  forgetWslInstalled: vi.fn(),
}));
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import * as vscode from 'vscode';
import { exec, type ChildProcess } from 'child_process';
import { forgetWslInstalled, isWslInstalledAsync } from '../wslInstall';
import { getWslInfoAsync, invalidateWslCache } from '../wslBridge';
import { recheckWsl } from '../wslRecheck';

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** WSL as the install check and the distro's shell report it. */
function wsl(installed: boolean) {
  vi.mocked(isWslInstalledAsync).mockResolvedValue(installed);
  vi.mocked(exec).mockImplementation(((
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    cb(null, { stdout: '/home/u\n', stderr: '' });
    return {} as ChildProcess;
  }) as unknown as typeof exec);
}

const contextSet = () =>
  vi
    .mocked(vscode.commands.executeCommand)
    .mock.calls.filter((c) => c[0] === 'setContext' && c[1] === 'gemstone.wslAvailable')
    .map((c) => c[2]);

describe('recheckWsl', () => {
  const realPlatform = process.platform;
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('win32');
    invalidateWslCache();
  });
  afterEach(() => {
    setPlatform(realPlatform);
    invalidateWslCache();
  });

  it('sees WSL installed after Jasper started, and lifts the "requires WSL2" message', async () => {
    wsl(false);
    expect((await getWslInfoAsync()).available).toBe(false);

    wsl(true);
    // Without a recheck the cached answer stands.
    expect((await getWslInfoAsync()).available).toBe(false);

    await expect(recheckWsl()).resolves.toMatchObject({ available: true, homeDir: '/home/u' });
    expect(contextSet()).toEqual([true]);
  });

  it('sees WSL removed, and puts the message back', async () => {
    wsl(true);
    expect((await getWslInfoAsync()).available).toBe(true);

    wsl(false);
    await expect(recheckWsl()).resolves.toMatchObject({ available: false });
    expect(contextSet()).toEqual([false]);
  });

  it('with nothing changed, sets the same answer again', async () => {
    wsl(true);
    await getWslInfoAsync();
    await recheckWsl();
    await recheckWsl();
    expect(contextSet()).toEqual([true, true]);
  });

  it('forgets the install check too, not just the WSL details', async () => {
    wsl(false);
    await recheckWsl();
    expect(forgetWslInstalled).toHaveBeenCalled();
  });
});
