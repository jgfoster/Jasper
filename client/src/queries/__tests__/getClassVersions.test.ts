import { describe, it, expect, vi } from 'vitest';
import { getClassVersions } from '../getClassVersions';

describe('getClassVersions query', () => {
  it('maps each returned class to its version number', () => {
    const execute = vi.fn().mockReturnValue('Account\t2\nWidget\t3\n');

    const versions = getClassVersions(execute, 3);

    expect(versions.get('Account')).toBe(2);
    expect(versions.get('Widget')).toBe(3);
  });

  it('omits classes the engine did not report as multi-version', () => {
    const execute = vi.fn().mockReturnValue('Account\t2\n');

    const versions = getClassVersions(execute, 3);

    expect(versions.has('Ledger')).toBe(false);
    expect(versions.size).toBe(1);
  });

  it('reads the class history so single-version classes are filtered server-side', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassVersions(execute, 3);

    const code = execute.mock.calls[0][1];
    expect(code).toContain('classHistory');
    expect(code).toContain('hist size > 1');
    expect(code).toContain('hist indexOf: v');
  });

  it('scopes the lookup to a dictionary index when given a number', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassVersions(execute, 3);

    const code = execute.mock.calls[0][1];
    expect(code).toContain('System myUserProfile symbolList at: 3');
  });

  it('resolves the dictionary by name when given a string', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassVersions(execute, 'UserGlobals');

    const code = execute.mock.calls[0][1];
    expect(code).toContain("objectNamed: #'UserGlobals'");
  });

  it('ignores a malformed line with no version', () => {
    const execute = vi.fn().mockReturnValue('Account\t2\nBadLineNoTab\n');

    const versions = getClassVersions(execute, 3);

    expect(versions.size).toBe(1);
    expect(versions.get('Account')).toBe(2);
  });
});
