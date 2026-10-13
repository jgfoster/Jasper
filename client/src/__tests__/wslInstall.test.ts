import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn() }));

import * as fs from 'fs';
import { execFile, execFileSync, type ChildProcess } from 'child_process';
import {
  forgetWslInstalled,
  isWslInstalled,
  lxssListsDistro,
  recheckWslInstalled,
} from '../wslInstall';

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const KEY = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';

// What `reg query` prints on a machine WSL was uninstalled from: the key and
// its values survive, but no distro subkey does.
const LEFTOVERS = `\r\n${KEY}\r\n    DefaultVersion    REG_DWORD    0x2\r\n    OOBEComplete    REG_DWORD    0x1\r\n\r\n`;
const WITH_DISTRO = `${LEFTOVERS}${KEY}\\{0b5c2d6e-1c6f-4e0a-9d8a-3f1f2b7c9a10}\r\n`;

function engine(present: boolean) {
  vi.mocked(fs.existsSync).mockReturnValue(present);
}

function regAsync(stdout: string | Error) {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    if (stdout instanceof Error) cb(stdout);
    else cb(null, { stdout, stderr: '' });
    return {} as ChildProcess;
  }) as unknown as typeof execFile);
}

describe('lxssListsDistro', () => {
  it('is false for the key with values only — what an uninstall leaves behind', () => {
    expect(lxssListsDistro(LEFTOVERS)).toBe(false);
  });

  it('is true once a distro subkey is listed', () => {
    expect(lxssListsDistro(WITH_DISTRO)).toBe(true);
  });

  it('ignores case, as reg.exe does', () => {
    expect(lxssListsDistro(`${KEY.toUpperCase()}\\{ABC}`)).toBe(true);
  });
});

describe('isWslInstalled', () => {
  const realPlatform = process.platform;
  beforeEach(() => {
    vi.clearAllMocks();
    forgetWslInstalled();
    setPlatform('win32');
  });
  afterEach(() => {
    setPlatform(realPlatform);
    forgetWslInstalled();
  });

  it('is false off Windows without looking', () => {
    setPlatform('linux');
    expect(isWslInstalled()).toBe(false);
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('is false with no WSL engine, and does not query the registry', () => {
    engine(false);
    expect(isWslInstalled()).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('is false with an engine but only leftover registry values', () => {
    engine(true);
    vi.mocked(execFileSync).mockReturnValue(LEFTOVERS);
    expect(isWslInstalled()).toBe(false);
  });

  it('is true with an engine and a registered distro, asking reg.exe — never wsl.exe', () => {
    engine(true);
    vi.mocked(execFileSync).mockReturnValue(WITH_DISTRO);
    expect(isWslInstalled()).toBe(true);
    expect(vi.mocked(execFileSync).mock.calls[0][0]).toBe('reg.exe');
  });

  it('is false when the Lxss key is missing (reg.exe exits 1)', () => {
    engine(true);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('ERROR: The system was unable to find the specified registry key');
    });
    expect(isWslInstalled()).toBe(false);
  });

  it('caches until forgotten', () => {
    engine(true);
    vi.mocked(execFileSync).mockReturnValue(LEFTOVERS);
    expect(isWslInstalled()).toBe(false);
    vi.mocked(execFileSync).mockReturnValue(WITH_DISTRO);
    expect(isWslInstalled()).toBe(false);
    forgetWslInstalled();
    expect(isWslInstalled()).toBe(true);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('recheckWslInstalled sees an install, and then an uninstall, without blocking', async () => {
    engine(true);
    vi.mocked(execFileSync).mockReturnValue(LEFTOVERS);
    expect(isWslInstalled()).toBe(false);

    regAsync(WITH_DISTRO);
    await expect(recheckWslInstalled()).resolves.toBe(true);
    expect(isWslInstalled()).toBe(true);

    engine(false);
    await expect(recheckWslInstalled()).resolves.toBe(false);
    expect(isWslInstalled()).toBe(false);
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
