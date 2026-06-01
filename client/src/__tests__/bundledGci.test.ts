import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initializeBundledGci,
  bundledWindowsClientDir,
  bundledWindowsClientGciPath,
  bundledWindowsClientVersions,
  bundledGciArchSupported,
  BUNDLED_GCI_ARCH,
} from '../bundledGci';

/** Create resources/gci/GemStone64BitClient<version>-x86.Windows_NT/bin/libgcits-<version>-64.dll */
function makeBundledWindowsClient(extRoot: string, version: string): string {
  const binDir = path.join(
    extRoot,
    'resources',
    'gci',
    `GemStone64BitClient${version}-x86.Windows_NT`,
    'bin',
  );
  fs.mkdirSync(binDir, { recursive: true });
  const dll = path.join(binDir, `libgcits-${version}-64.dll`);
  fs.writeFileSync(dll, 'stub');
  return dll;
}

describe('bundledGci', () => {
  let extRoot: string;

  beforeEach(() => {
    extRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-bundled-'));
    initializeBundledGci(extRoot);
  });

  afterEach(() => {
    fs.rmSync(extRoot, { recursive: true, force: true });
  });

  it('computes the bundled Windows client directory under resources/gci', () => {
    const dir = bundledWindowsClientDir('3.7.5');
    expect(dir).toBe(
      path.join(extRoot, 'resources', 'gci', 'GemStone64BitClient3.7.5-x86.Windows_NT'),
    );
  });

  it('returns undefined when no library is bundled', () => {
    expect(bundledWindowsClientGciPath('3.7.5')).toBeUndefined();
    expect(bundledWindowsClientVersions()).toEqual([]);
  });

  it('finds a bundled Windows GCI DLL when present', () => {
    const dll = makeBundledWindowsClient(extRoot, '3.7.5');
    expect(bundledWindowsClientGciPath('3.7.5')).toBe(dll);
    expect(bundledWindowsClientVersions()).toEqual(['3.7.5']);
  });

  it('does not report a version whose directory exists but has no DLL', () => {
    const binDir = path.join(
      extRoot,
      'resources',
      'gci',
      'GemStone64BitClient3.7.5-x86.Windows_NT',
      'bin',
    );
    fs.mkdirSync(binDir, { recursive: true });
    expect(bundledWindowsClientGciPath('3.7.5')).toBeUndefined();
    expect(bundledWindowsClientVersions()).toEqual([]);
  });

  it('lists multiple bundled versions newest-first', () => {
    makeBundledWindowsClient(extRoot, '3.7.4');
    makeBundledWindowsClient(extRoot, '3.7.5');
    makeBundledWindowsClient(extRoot, '3.7.10');
    expect(bundledWindowsClientVersions()).toEqual(['3.7.10', '3.7.5', '3.7.4']);
  });

  it('ignores unrelated entries under resources/gci', () => {
    fs.mkdirSync(path.join(extRoot, 'resources', 'gci'), { recursive: true });
    fs.writeFileSync(path.join(extRoot, 'resources', 'gci', 'README.md'), '# docs');
    fs.mkdirSync(path.join(extRoot, 'resources', 'gci', 'GemStone64Bit3.7.5-x86_64.Linux'));
    expect(bundledWindowsClientVersions()).toEqual([]);
  });

  it('returns nothing before initialization points at a real directory', () => {
    initializeBundledGci(path.join(extRoot, 'does-not-exist'));
    expect(bundledWindowsClientGciPath('3.7.5')).toBeUndefined();
    expect(bundledWindowsClientVersions()).toEqual([]);
  });
});

describe('bundledGciArchSupported', () => {
  const originalArch = process.arch;
  afterEach(() => {
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  it('is true on the x64 architecture (matches the bundled DLLs)', () => {
    expect(BUNDLED_GCI_ARCH).toBe('x64');
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(bundledGciArchSupported()).toBe(true);
  });

  it('is false on arm64 (cannot load x64 DLLs in an ARM64 process)', () => {
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    expect(bundledGciArchSupported()).toBe(false);
  });
});

// Guard the libraries actually committed under resources/gci so they can't
// silently disappear from the shipped .vsix. __dirname = client/src/__tests__,
// so the repo root (where resources/ lives) is three levels up.
describe('bundled libraries shipped in resources/gci', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  beforeEach(() => initializeBundledGci(repoRoot));

  it('ships the 3.6.2 Windows GCI library', () => {
    const dll = bundledWindowsClientGciPath('3.6.2');
    expect(dll).toBeDefined();
    expect(fs.existsSync(dll!)).toBe(true);
    expect(bundledWindowsClientVersions()).toContain('3.6.2');
  });

  it('ships the dependency siblings next to the 3.6.2 GCI library', () => {
    const dll = bundledWindowsClientGciPath('3.6.2')!;
    const binDir = path.dirname(dll);
    // libssl (SSL connections) and msvcr100 (VC++ 2010 runtime, the only
    // non-OS dependency) must travel with the GCI DLL.
    expect(fs.existsSync(path.join(binDir, 'libssl-3.6.2-64.dll'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'msvcr100.dll'))).toBe(true);
  });
});
