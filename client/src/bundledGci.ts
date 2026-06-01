import * as fs from 'fs';
import * as path from 'path';

/**
 * GCI libraries that ship inside the extension, for customers in secure /
 * air-gapped environments where downloading from downloads.gemtalksystems.com
 * is not permitted. When a matching library is bundled it short-circuits the
 * normal download / file-picker flow so the user can connect with no network
 * access and no manual configuration.
 *
 * Layout (mirrors the extracted product directories so the existing GEMSTONE
 * env-var and sibling-library logic in extension.ts works unchanged):
 *
 *   resources/gci/GemStone64BitClient{version}-x86.Windows_NT/bin/libgcits-{version}-64.dll
 *
 * Only the Windows client is bundled today; the helpers are structured so other
 * platforms can be added under resources/gci/ later.
 */

// Set once during activation from context.extensionPath. Tests may set it
// directly via initializeBundledGci() pointing at a fixture directory.
let bundledRoot: string | undefined;

const WIN_CLIENT_PREFIX = 'GemStone64BitClient';
const WIN_CLIENT_SUFFIX = '-x86.Windows_NT';

/** Record the extension install directory so bundled libraries can be found. */
export function initializeBundledGci(extensionPath: string): void {
  bundledRoot = path.join(extensionPath, 'resources', 'gci');
}

/** Architecture the bundled Windows GCI libraries are built for. */
export const BUNDLED_GCI_ARCH = 'x64';

/**
 * Whether the current process can load the bundled Windows GCI libraries.
 *
 * They are x64 DLLs, so an ARM64 VS Code (Windows on ARM) cannot load them
 * in-process — a 64-bit process can only load DLLs of its own architecture,
 * even though Windows on ARM emulates whole x64 processes. The user must run
 * the x64 build of VS Code instead.
 */
export function bundledGciArchSupported(): boolean {
  return process.arch === BUNDLED_GCI_ARCH;
}

/** The directory a bundled Windows client for `version` would live in. */
export function bundledWindowsClientDir(version: string): string | undefined {
  if (!bundledRoot) return undefined;
  return path.join(bundledRoot, `${WIN_CLIENT_PREFIX}${version}${WIN_CLIENT_SUFFIX}`);
}

/**
 * Path to the bundled Windows GCI DLL for `version`, or undefined if no such
 * library ships with this extension build.
 */
export function bundledWindowsClientGciPath(version: string): string | undefined {
  const dir = bundledWindowsClientDir(version);
  if (!dir) return undefined;
  // Windows client distributions place DLLs in bin/, matching getWindowsClientGciPath.
  const dll = path.join(dir, 'bin', `libgcits-${version}-64.dll`);
  return fs.existsSync(dll) ? dll : undefined;
}

/** Versions for which a Windows GCI DLL is bundled with the extension. */
export function bundledWindowsClientVersions(): string[] {
  if (!bundledRoot || !fs.existsSync(bundledRoot)) return [];
  const versions: string[] = [];
  for (const entry of fs.readdirSync(bundledRoot)) {
    if (!entry.startsWith(WIN_CLIENT_PREFIX) || !entry.endsWith(WIN_CLIENT_SUFFIX)) continue;
    const version = entry.slice(WIN_CLIENT_PREFIX.length, -WIN_CLIENT_SUFFIX.length);
    // Only count it if the DLL is actually present, not just the directory.
    if (bundledWindowsClientGciPath(version)) versions.push(version);
  }
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions;
}
