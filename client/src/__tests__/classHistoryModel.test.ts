import { describe, it, expect } from 'vitest';
import {
  parseClassHistory, parseRevertResult, parseRemoveResult, versionSummary,
} from '../classHistoryModel';

const historyJson = JSON.stringify([
  {
    index: 2, name: 'Bar', oop: 60097537, timeStamp: '2026-07-17 09:56:44', userId: 'SystemUser',
    isCurrent: true, definition: "Object subclass: 'Bar'",
    changedMethods: [{ side: 'instance', selector: 'common', change: 'modified' },
      { side: 'instance', selector: 'm2', change: 'added' }],
  },
  {
    index: 1, name: 'Foo', oop: 60084737, timeStamp: '2026-07-17 09:55:53', userId: 'SystemUser',
    isCurrent: false, definition: "Object subclass: 'Foo'",
    changedMethods: [{ side: 'instance', selector: 'm1', change: 'added' }],
  },
]);

describe('class-definition history parsing', () => {
  it('reads each version newest-first with its name, oop, timestamp, and author', () => {
    const versions = parseClassHistory(historyJson);

    expect(versions.map((v) => v.index)).toEqual([2, 1]);
    expect(versions[0].name).toBe('Bar');
    expect(versions[1].name).toBe('Foo');
    expect(versions[0].oop).toBe(60097537);
    expect(versions[0].userId).toBe('SystemUser');
    expect(versions[0].isCurrent).toBe(true);
  });

  it('captures the original name a renamed class had at an earlier version', () => {
    const versions = parseClassHistory(historyJson);

    expect(versions[1].name).toBe('Foo');
  });

  it('parses the per-version added / removed / modified method changes', () => {
    const versions = parseClassHistory(historyJson);

    expect(versions[0].changedMethods).toEqual([
      { side: 'instance', selector: 'common', change: 'modified' },
      { side: 'instance', selector: 'm2', change: 'added' },
    ]);
  });

  it('throws when the class name is unbound', () => {
    expect(() => parseClassHistory(JSON.stringify({ error: 'not a class: Nope' }))).toThrow(
      'not a class: Nope',
    );
  });
});

describe('redo/restore result parsing', () => {
  it('reads a successful restore with the new version index', () => {
    const result = parseRevertResult(JSON.stringify({
      reverted: true, index: 1, newIndex: 4, failedMethods: 0,
    }));

    expect(result.reverted).toBe(true);
    expect(result.newIndex).toBe(4);
  });

  it('reads a restore error', () => {
    const result = parseRevertResult(JSON.stringify({ reverted: false, error: 'index out of range' }));

    expect(result.reverted).toBe(false);
    expect(result.error).toBe('index out of range');
  });

  it('reports the restored class name (which changes when restoring across a rename)', () => {
    const result = parseRevertResult(JSON.stringify({
      reverted: true, index: 2, newIndex: 4, name: 'Account', apply: { applied: 4, failed: [] },
    }));

    expect(result.name).toBe('Account');
    expect(result.failed).toBe(0);
  });

  it('counts changes that failed to compile during a restore', () => {
    const result = parseRevertResult(JSON.stringify({
      reverted: true, name: 'Account', apply: { applied: 3, failed: [{ id: '2' }] },
    }));

    expect(result.failed).toBe(1);
  });
});

describe('remove-version result parsing', () => {
  it('reads a successful removal with the remaining count', () => {
    const result = parseRemoveResult(JSON.stringify({ removed: true, index: 1, remaining: 2 }));

    expect(result.removed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('reads a removal error (e.g. the current version)', () => {
    const result = parseRemoveResult(JSON.stringify({
      removed: false, error: 'cannot remove the current version',
    }));

    expect(result.removed).toBe(false);
    expect(result.error).toBe('cannot remove the current version');
  });
});

describe('version summary line', () => {
  it('marks the current version and names its author', () => {
    const versions = parseClassHistory(historyJson);

    expect(versionSummary(versions[0])).toContain('(current)');
    expect(versionSummary(versions[0])).toContain('by SystemUser');
  });
});
