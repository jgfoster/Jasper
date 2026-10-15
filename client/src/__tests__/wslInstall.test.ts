import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('os', () => ({ release: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import {
  forgetWslInstalled,
  isWslInstalled,
  isWslInstalledAsync,
  listsDistro,
} from '../wslInstall';

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const WINDOWS_11 = '10.0.22631';
const WINDOWS_10 = '10.0.19045';

// Older WSL writes UTF-16LE whatever WSL_UTF8 says.
const UTF16_UBUNTU = 'U\0b\0u\0n\0t\0u\0\r\0\n\0';

type Answers = Record<string, { status: number; stdout?: string }>;

function wslAnswers(answers: Answers) {
  const answer = (args: string[]) => answers[args.join(' ')] ?? { status: 1 };
  vi.mocked(spawnSync).mockImplementation(((_file: string, args: string[]) => {
    const a = answer(args);
    return { status: a.status, stdout: a.stdout ?? '' } as SpawnSyncReturns<string>;
  }) as unknown as typeof spawnSync);
  vi.mocked(spawn).mockImplementation(((_file: string, args: string[]) => {
    const child = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    Object.assign(child, { stdout });
    const a = answer(args);
    setImmediate(() => {
      if (a.stdout) stdout.emit('data', a.stdout);
      child.emit('close', a.status);
    });
    return child;
  }) as unknown as typeof spawn);
}

const argsRun = (mock: typeof spawnSync | typeof spawn) =>
  vi.mocked(mock).mock.calls.map((c) => (c[1] as string[]).join(' '));

describe('listsDistro', () => {
  it('is false for empty output — WSL with no distro', () => {
    expect(listsDistro({ ok: true, stdout: '\r\n' })).toBe(false);
  });

  it('is true for a distro name, in UTF-8 or UTF-16LE', () => {
    expect(listsDistro({ ok: true, stdout: 'Ubuntu\r\n' })).toBe(true);
    expect(listsDistro({ ok: true, stdout: UTF16_UBUNTU })).toBe(true);
  });

  it('is false when the command failed, whatever it printed', () => {
    expect(listsDistro({ ok: false, stdout: 'Ubuntu\r\n' })).toBe(false);
  });
});

describe('isWslInstalled', () => {
  const realPlatform = process.platform;
  beforeEach(() => {
    vi.clearAllMocks();
    forgetWslInstalled();
    setPlatform('win32');
    vi.mocked(os.release).mockReturnValue(WINDOWS_11);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });
  afterEach(() => {
    setPlatform(realPlatform);
    forgetWslInstalled();
  });

  it('is false off Windows without running anything', async () => {
    setPlatform('linux');
    expect(isWslInstalled()).toBe(false);
    await expect(isWslInstalledAsync()).resolves.toBe(false);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  describe('on Windows 11', () => {
    it('is false when `wsl --status` fails, and never asks for the distro list', () => {
      // Without WSL, `--list --quiet` sits waiting for a key; `--status` exits 50.
      wslAnswers({ '--status': { status: 50 }, '--list --quiet': { status: 0, stdout: 'Ubuntu' } });
      expect(isWslInstalled()).toBe(false);
      expect(argsRun(spawnSync)).toEqual(['--status']);
    });

    it('is false with WSL but no distro', () => {
      wslAnswers({ '--status': { status: 0 }, '--list --quiet': { status: 0, stdout: '' } });
      expect(isWslInstalled()).toBe(false);
    });

    it('is true with WSL and a distro, without looking at files', () => {
      wslAnswers({
        '--status': { status: 0 },
        '--list --quiet': { status: 0, stdout: UTF16_UBUNTU },
      });
      expect(isWslInstalled()).toBe(true);
      expect(argsRun(spawnSync)).toEqual(['--status', '--list --quiet']);
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it('hides the window, ignores stdin and times out, so a prompt could not wait forever', () => {
      wslAnswers({ '--status': { status: 50 } });
      isWslInstalled();
      const [file, , options] = vi.mocked(spawnSync).mock.calls[0];
      expect(file).toMatch(/[\\/]System32[\\/]wsl\.exe$/);
      expect(options).toMatchObject({ windowsHide: true, timeout: expect.any(Number) });
      expect((options as { stdio: string[] }).stdio[0]).toBe('ignore');
    });
  });

  describe('on Windows 10 before Windows 11', () => {
    beforeEach(() => vi.mocked(os.release).mockReturnValue(WINDOWS_10));

    const onlyFile = (present: RegExp) =>
      vi.mocked(fs.existsSync).mockImplementation((p) => present.test(String(p)));
    const withDistro = { '--list --quiet': { status: 0, stdout: 'Ubuntu\r\n' } };

    it('never runs `wsl --status`, and runs nothing at all without the engine files', () => {
      wslAnswers({ '--status': { status: 0 }, ...withDistro });
      // The System32\lxss folder outlives an uninstall; only the DLL in it counts.
      onlyFile(/[\\/]lxss$/);
      expect(isWslInstalled()).toBe(false);
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("counts the inbox feature's LxssManager.dll", () => {
      wslAnswers(withDistro);
      onlyFile(/[\\/]System32[\\/]lxss[\\/]LxssManager\.dll$/);
      expect(isWslInstalled()).toBe(true);
      expect(argsRun(spawnSync)).toEqual(['--list --quiet']);
    });

    it("counts the Store package's wsl.exe under Program Files", () => {
      wslAnswers(withDistro);
      onlyFile(/[\\/]WSL[\\/]wsl\.exe$/);
      expect(isWslInstalled()).toBe(true);
    });

    it('looks through Sysnative from a 32-bit process on 64-bit Windows', () => {
      vi.stubEnv('PROCESSOR_ARCHITEW6432', 'AMD64');
      try {
        wslAnswers(withDistro);
        onlyFile(/[\\/]Sysnative[\\/]lxss[\\/]LxssManager\.dll$/);
        expect(isWslInstalled()).toBe(true);
        expect(vi.mocked(spawnSync).mock.calls[0][0]).toMatch(/[\\/]Sysnative[\\/]wsl\.exe$/);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it('caches until forgotten', () => {
    wslAnswers({ '--status': { status: 50 } });
    expect(isWslInstalled()).toBe(false);
    wslAnswers({ '--status': { status: 0 }, '--list --quiet': { status: 0, stdout: 'Ubuntu' } });
    expect(isWslInstalled()).toBe(false);
    forgetWslInstalled();
    expect(isWslInstalled()).toBe(true);
  });

  it('isWslInstalledAsync fills a cold cache without blocking, sharing one probe between callers', async () => {
    wslAnswers({ '--status': { status: 0 }, '--list --quiet': { status: 0, stdout: 'Ubuntu' } });
    const [a, b] = await Promise.all([isWslInstalledAsync(), isWslInstalledAsync()]);
    expect([a, b]).toEqual([true, true]);
    expect(argsRun(spawn)).toEqual(['--status', '--list --quiet']);
    expect(isWslInstalled()).toBe(true);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('isWslInstalledAsync never asks for the distro list when `wsl --status` fails', async () => {
    wslAnswers({ '--status': { status: 50 } });
    await expect(isWslInstalledAsync()).resolves.toBe(false);
    expect(argsRun(spawn)).toEqual(['--status']);
  });

  it('isWslInstalledAsync answers false when wsl.exe cannot be started', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess;
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    });
    await expect(isWslInstalledAsync()).resolves.toBe(false);
  });
});

// The async check must always settle: activation, Refresh and every async WSL
// entry point await it, so a check that never answers stalls all of them.
describe('isWslInstalledAsync always finishes', () => {
  const realPlatform = process.platform;

  /** A wsl.exe that the test answers by hand; until then it neither exits nor closes. */
  function heldChildren() {
    const children: Array<ChildProcess & { kill: ReturnType<typeof vi.fn> }> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        kill: vi.fn(),
      }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
      children.push(child);
      return child;
    });
    return children;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    forgetWslInstalled();
    setPlatform('win32');
    vi.mocked(os.release).mockReturnValue(WINDOWS_11);
  });
  afterEach(() => {
    vi.useRealTimers();
    setPlatform(realPlatform);
    forgetWslInstalled();
  });

  it('answers false by the deadline when wsl.exe never closes, and kills it', async () => {
    vi.useFakeTimers();
    const children = heldChildren();
    let answer: boolean | undefined;
    void isWslInstalledAsync().then((a) => (answer = a));

    await vi.advanceTimersByTimeAsync(9999);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(answer).toBe(false);
    expect(children).toHaveLength(1);
    expect(children[0].kill).toHaveBeenCalledOnce();
  });

  it('answers false by the deadline when `--list --quiet` hangs after `--status` passed', async () => {
    vi.useFakeTimers();
    const children = heldChildren();
    const answer = isWslInstalledAsync();
    await vi.advanceTimersByTimeAsync(0);
    children[0].emit('close', 0);
    await vi.advanceTimersByTimeAsync(10000);

    await expect(answer).resolves.toBe(false);
    expect(children).toHaveLength(2);
    expect(children[1].kill).toHaveBeenCalledOnce();
  });

  it('answers false when spawn itself throws', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('EPERM');
    });
    await expect(isWslInstalledAsync()).resolves.toBe(false);
  });

  it('a check that failed is not left pending: the next one after a forget runs again', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('EPERM');
    });
    await expect(isWslInstalledAsync()).resolves.toBe(false);
    forgetWslInstalled();
    wslAnswers({ '--status': { status: 0 }, '--list --quiet': { status: 0, stdout: 'Ubuntu' } });
    await expect(isWslInstalledAsync()).resolves.toBe(true);
  });

  it('a late answer does not reach the cache once forgotten — the next call looks again', async () => {
    const children = heldChildren();
    const stale = isWslInstalledAsync();
    await Promise.resolve();
    forgetWslInstalled();

    // WSL is uninstalled while the first check is still running.
    children[0].emit('close', 0);
    await new Promise((r) => setImmediate(r));
    children[1].stdout?.emit('data', 'Ubuntu');
    children[1].emit('close', 0);
    await expect(stale).resolves.toBe(true);

    wslAnswers({ '--status': { status: 50 } });
    await expect(isWslInstalledAsync()).resolves.toBe(false);
    expect(isWslInstalled()).toBe(false);
  });

  it('callers waiting on one check all get its answer, even a failed one', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('EPERM');
    });
    await expect(Promise.all([isWslInstalledAsync(), isWslInstalledAsync()])).resolves.toEqual([
      false,
      false,
    ]);
    expect(spawn).toHaveBeenCalledOnce();
  });
});
