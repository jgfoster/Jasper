import { describe, it, expect, vi } from 'vitest';
import { parseArgs, readInitScripts } from '../index';

describe('parseArgs', () => {
  const validArgs = [
    'node', 'index.js',
    '--library-path', '/path/to/lib.dylib',
    '--stone-nrs', '!tcp@localhost#server!gs64stone',
    '--gem-nrs', '!tcp@localhost#netldi:gs64ldi#task!gemnetobject',
    '--gs-user', 'DataCurator',
    '--gemstone', '/opt/gemstone/3.7.4',
    '--gemstone-global-dir', '/home/user/gemstone',
  ];

  it('parses all required arguments', () => {
    const result = parseArgs(validArgs);

    expect(result.libraryPath).toBe('/path/to/lib.dylib');
    expect(result.stoneNrs).toBe('!tcp@localhost#server!gs64stone');
    expect(result.gemNrs).toBe('!tcp@localhost#netldi:gs64ldi#task!gemnetobject');
    expect(result.gsUser).toBe('DataCurator');
    expect(result.gemstone).toBe('/opt/gemstone/3.7.4');
    expect(result.gemstoneGlobalDir).toBe('/home/user/gemstone');
  });

  it('parses optional host-user argument', () => {
    const args = [...validArgs, '--host-user', 'admin'];
    const result = parseArgs(args);

    expect(result.hostUser).toBe('admin');
  });

  it('returns undefined for missing optional arguments', () => {
    const result = parseArgs(validArgs);

    expect(result.hostUser).toBeUndefined();
  });

  it('throws on missing required argument for stdio/sse mode', () => {
    const args = [
      'node', 'index.js',
      '--library-path', '/path/to/lib.dylib',
    ];

    expect(() => parseArgs(args)).toThrow('Missing required argument');
  });

  it('defaults transport to stdio', () => {
    const result = parseArgs(validArgs);
    expect(result.transport).toBe('stdio');
  });

  it('accepts --transport sse', () => {
    const result = parseArgs([...validArgs, '--transport', 'sse']);
    expect(result.transport).toBe('sse');
  });

  it('accepts --transport stdio explicitly', () => {
    const result = parseArgs([...validArgs, '--transport', 'stdio']);
    expect(result.transport).toBe('stdio');
  });

  it('throws on invalid transport value', () => {
    expect(() => parseArgs([...validArgs, '--transport', 'websocket']))
      .toThrow('Invalid --transport');
  });

  // The user's pain: after every gem crash they re-paste a multi-line
  // `importlib grailDir: ... ; CPythonShim libraryPath: ...` block. Storing
  // those as `--session-init-script <path>` lets the server replay them on
  // every login (initial + reconnects).
  describe('--session-init-script', () => {
    it('returns undefined when no init script is given', () => {
      const result = parseArgs(validArgs);
      expect(result.sessionInitScripts).toBeUndefined();
    });

    it('captures a single --session-init-script path', () => {
      const result = parseArgs([...validArgs, '--session-init-script', '/etc/init1.gs']);
      expect(result.sessionInitScripts).toEqual(['/etc/init1.gs']);
    });

    // Order matters: scripts run in argv order at login time, so repeated
    // flags must preserve that order rather than the last-wins shape the
    // rest of the args use.
    it('accepts repeated --session-init-script flags in order', () => {
      const result = parseArgs([
        ...validArgs,
        '--session-init-script', '/etc/a.gs',
        '--session-init-script', '/etc/b.gs',
      ]);
      expect(result.sessionInitScripts).toEqual(['/etc/a.gs', '/etc/b.gs']);
    });
  });

  describe('readInitScripts', () => {
    it('returns [] when no paths are given', () => {
      expect(readInitScripts(undefined)).toEqual([]);
      expect(readInitScripts([])).toEqual([]);
    });

    it('reads each path via the injected reader and returns contents in order', () => {
      const reader = vi.fn((p: string) => `contents of ${p}`);
      expect(readInitScripts(['/a', '/b'], reader)).toEqual(['contents of /a', 'contents of /b']);
      expect(reader).toHaveBeenNthCalledWith(1, '/a');
      expect(reader).toHaveBeenNthCalledWith(2, '/b');
    });

    // Fail loud: silently skipping a missing init script would put the
    // session in a half-primed state without the user knowing why their
    // Grail / CPythonShim setup didn't take.
    it('throws a clear error if the file cannot be read', () => {
      const reader = vi.fn(() => { throw new Error('ENOENT'); });
      expect(() => readInitScripts(['/missing.gs'], reader))
        .toThrow(/Cannot read session-init-script \/missing.gs: ENOENT/);
    });
  });

  describe('proxy mode', () => {
    it('recognizes --proxy-socket without requiring other args', () => {
      const result = parseArgs(['node', 'index.js', '--proxy-socket', '/tmp/jasper.sock']);
      expect(result.transport).toBe('proxy');
      expect(result.proxySocket).toBe('/tmp/jasper.sock');
    });

    it('does not require library-path or GemStone args in proxy mode', () => {
      expect(() => parseArgs(['node', 'index.js', '--proxy-socket', '/tmp/jasper.sock']))
        .not.toThrow();
    });

    it('still exposes the socket path when other args are also given', () => {
      const result = parseArgs([
        ...validArgs,
        '--proxy-socket', '/tmp/jasper.sock',
      ]);
      expect(result.transport).toBe('proxy');
      expect(result.proxySocket).toBe('/tmp/jasper.sock');
    });
  });
});
