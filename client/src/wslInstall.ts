import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Is WSL really installed — answered WITHOUT running `wsl.exe`.
 *
 * Windows keeps a small `wsl.exe` launcher in System32 even when WSL was never
 * installed or has been uninstalled, and any call to it opens a console window
 * saying "Press any key to install Windows Subsystem for Linux". A user who
 * presses a key at the wrong moment starts an install they never asked for, so
 * running `wsl.exe` to find out whether WSL is there is the one thing the check
 * must not do. Hiding that window is no answer either: the launcher would still
 * sit waiting for a key until it times out.
 *
 * Installed means both of:
 *  - an engine: the Store package's own `wsl.exe` under Program Files, or the
 *    inbox optional feature's `LxssManager.dll`. The System32 `lxss` folder and
 *    launcher are no evidence — both outlive an uninstall.
 *  - a registered distro: a subkey under HKCU\...\Lxss. The key itself, with
 *    values such as `DefaultVersion`, also outlives an uninstall; only the
 *    per-distro subkeys say there is a Linux to run commands in.
 *
 * `reg.exe` is a plain console tool that never prompts, so querying it is safe.
 */

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';

let cachedInstalled: boolean | undefined;

function hasWslEngine(): boolean {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return (
    fs.existsSync(path.join(programFiles, 'WSL', 'wsl.exe')) ||
    fs.existsSync(path.join(systemRoot, 'System32', 'lxss', 'LxssManager.dll'))
  );
}

/** Does `reg query <Lxss>` output list at least one distro subkey? */
export function lxssListsDistro(regOutput: string): boolean {
  const prefix = `HKEY_CURRENT_USER${LXSS_KEY.slice('HKCU'.length)}\\`.toLowerCase();
  return regOutput.split(/\r?\n/).some((line) => {
    const l = line.trim().toLowerCase();
    return l.startsWith(prefix) && l.length > prefix.length;
  });
}

const REG_OPTIONS = { encoding: 'utf-8', timeout: 5000, windowsHide: true } as const;

function probeSync(): boolean {
  if (!hasWslEngine()) return false;
  try {
    return lxssListsDistro(execFileSync('reg.exe', ['query', LXSS_KEY], REG_OPTIONS));
  } catch {
    // reg.exe exits 1 when the key does not exist.
    return false;
  }
}

async function probeAsync(): Promise<boolean> {
  if (!hasWslEngine()) return false;
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', LXSS_KEY], REG_OPTIONS);
    return lxssListsDistro(String(stdout));
  } catch {
    return false;
  }
}

/** Cached; {@link forgetWslInstalled} or {@link recheckWslInstalled} renew it.
 *  Always false off Windows. */
export function isWslInstalled(): boolean {
  if (process.platform !== 'win32') return false;
  cachedInstalled ??= probeSync();
  return cachedInstalled;
}

/** Look again without blocking the extension host, and remember the answer.
 *  Cheap enough to run on every window focus — it never starts WSL. */
export async function recheckWslInstalled(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  cachedInstalled = await probeAsync();
  return cachedInstalled;
}

export function forgetWslInstalled(): void {
  cachedInstalled = undefined;
}
