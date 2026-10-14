import { spawn, spawnSync, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Is WSL really installed — answered without opening WSL's install prompt.
 *
 * Windows keeps a small `wsl.exe` launcher in System32 even when WSL was never
 * installed or has been uninstalled, and most commands sent to it there open a
 * console window saying "Press any key to install Windows Subsystem for Linux";
 * a user who presses a key at the wrong moment starts an install they never
 * asked for. `wsl --status` is the exception: on a machine without WSL it exits
 * non-zero straight away, with no window. VS Code's own WSL detection
 * (src/vs/platform/remote/node/wsl.ts) relies on the same thing, and this
 * follows it:
 *  - Windows 11 (build 22000 and later): `wsl --status` exits 0.
 *  - Older Windows 10, where `--status` may not exist yet: files only — the
 *    inbox feature's `LxssManager.dll`, or the Store package's own `wsl.exe`
 *    under Program Files. VS Code checks only the DLL, which misses a machine
 *    with just the Store package.
 * Installed also means a distro to run commands in: `wsl --list --quiet` must
 * name one. That command waits for a key on a machine without WSL, so it runs
 * only once the step above has found the engine.
 *
 * Every run hides its window and ignores stdin, so should some build prompt
 * after all, nothing can answer it and the timeout ends it.
 */

const WINDOWS_11_FIRST_BUILD = 22000;
const RUN_TIMEOUT_MS = 10000;

let cachedInstalled: boolean | undefined;
let pendingProbe: Promise<boolean> | undefined;

/** A 32-bit process on 64-bit Windows has System32 redirected to SysWOW64,
 *  which holds neither `wsl.exe` nor `lxss`; `Sysnative` reaches the real one. */
function system32(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return path.join(systemRoot, process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32');
}

function isWindows11OrLater(): boolean {
  const build = parseInt(os.release().split('.')[2] ?? '', 10);
  return build >= WINDOWS_11_FIRST_BUILD;
}

function hasEngineFiles(): boolean {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  return (
    fs.existsSync(path.join(programFiles, 'WSL', 'wsl.exe')) ||
    fs.existsSync(path.join(system32(), 'lxss', 'LxssManager.dll'))
  );
}

interface WslRun {
  ok: boolean;
  stdout: string;
}

const RUN_OPTIONS: SpawnOptions = {
  windowsHide: true,
  timeout: RUN_TIMEOUT_MS,
  stdio: ['ignore', 'pipe', 'ignore'],
  // Older WSL writes UTF-16LE whatever this says; listsDistro copes with both.
  env: { ...process.env, WSL_UTF8: '1' },
};

function runSync(args: string[]): WslRun {
  const r = spawnSync(path.join(system32(), 'wsl.exe'), args, {
    ...RUN_OPTIONS,
    encoding: 'utf-8',
  });
  return { ok: !r.error && r.status === 0, stdout: String(r.stdout ?? '') };
}

function runAsync(args: string[]): Promise<WslRun> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawn(path.join(system32(), 'wsl.exe'), args, RUN_OPTIONS);
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.on('error', () => resolve({ ok: false, stdout: '' }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout }));
  });
}

/** Does `wsl --list --quiet` output name at least one distro? */
export function listsDistro(run: WslRun): boolean {
  return run.ok && run.stdout.replace(/\0/g, '').trim() !== '';
}

function probeSync(): boolean {
  const engine = isWindows11OrLater() ? runSync(['--status']).ok : hasEngineFiles();
  return engine && listsDistro(runSync(['--list', '--quiet']));
}

async function probeAsync(): Promise<boolean> {
  const engine = isWindows11OrLater() ? (await runAsync(['--status'])).ok : hasEngineFiles();
  return engine && listsDistro(await runAsync(['--list', '--quiet']));
}

/** Cached until {@link forgetWslInstalled}. Always false off Windows. Blocks on
 *  a cold cache — async callers use {@link isWslInstalledAsync}. */
export function isWslInstalled(): boolean {
  if (process.platform !== 'win32') return false;
  cachedInstalled ??= probeSync();
  return cachedInstalled;
}

/** {@link isWslInstalled} for async callers: a cold cache is filled without
 *  blocking the extension host, and callers arriving together share one probe. */
export async function isWslInstalledAsync(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (cachedInstalled !== undefined) return cachedInstalled;
  pendingProbe ??= probeAsync().then((installed) => {
    cachedInstalled = installed;
    pendingProbe = undefined;
    return installed;
  });
  return await pendingProbe;
}

export function forgetWslInstalled(): void {
  cachedInstalled = undefined;
  pendingProbe = undefined;
}
