import { describe, it, expect } from 'vitest';
import {
  diffManifest, stateFromManifest, emptyState, entryKey, splitKey, chunkRefs,
} from '../manifestDiff';
import { Manifest } from '../syncFraming';

// rows: [dictIndex, dictName, className, hash]
function manifest(rows: [number, string, string, string][]): Manifest {
  return {
    dictionaries: [],
    classes: rows.map(([dictIndex, dictName, className, hash]) => ({
      dictIndex, dictName, className, hash,
    })),
  };
}

describe('diffManifest', () => {
  it('fetches everything on a first sync (empty local state)', () => {
    const remote = manifest([[1, 'UG', 'Foo', 'a'], [1, 'UG', 'Bar', 'b']]);
    const d = diffManifest(remote, emptyState());
    expect(d.toFetch).toEqual([
      { dictIndex: 1, dictName: 'UG', className: 'Foo' },
      { dictIndex: 1, dictName: 'UG', className: 'Bar' },
    ]);
    expect(d.toDeleteKeys).toEqual([]);
    expect(d.unchanged).toBe(0);
  });

  it('fetches only changed and new classes', () => {
    const remote = manifest([
      [1, 'UG', 'Foo', 'a2'], [1, 'UG', 'Bar', 'b'], [1, 'UG', 'New', 'n'],
    ]);
    const local = {
      classes: {
        [entryKey(1, 'UG', 'Foo')]: 'a1', // changed
        [entryKey(1, 'UG', 'Bar')]: 'b', // unchanged
      },
    };
    const d = diffManifest(remote, local);
    expect(d.toFetch).toEqual([
      { dictIndex: 1, dictName: 'UG', className: 'Foo' },
      { dictIndex: 1, dictName: 'UG', className: 'New' },
    ]);
    expect(d.unchanged).toBe(1);
    expect(d.toDeleteKeys).toEqual([]);
  });

  it('marks classes gone from the image for deletion', () => {
    const remote = manifest([[1, 'UG', 'Foo', 'a']]);
    const local = {
      classes: {
        [entryKey(1, 'UG', 'Foo')]: 'a',
        [entryKey(1, 'UG', 'Gone')]: 'g',
        [entryKey(2, 'G', 'AlsoGone')]: 'x',
      },
    };
    const d = diffManifest(remote, local);
    expect(d.toFetch).toEqual([]);
    expect(d.toDeleteKeys.sort()).toEqual(
      [entryKey(1, 'UG', 'Gone'), entryKey(2, 'G', 'AlsoGone')].sort(),
    );
  });

  it('tracks the same name in two dictionaries independently', () => {
    const remote = manifest([[1, 'A', 'Dup', 'a'], [2, 'B', 'Dup', 'b']]);
    const local = { classes: { [entryKey(1, 'A', 'Dup')]: 'a' } };
    const d = diffManifest(remote, local);
    expect(d.toFetch).toEqual([{ dictIndex: 2, dictName: 'B', className: 'Dup' }]);
    expect(d.unchanged).toBe(1);
  });

  it('re-fetches a renamed dictionary and prunes the old name', () => {
    // Index 2 renamed from "Old" to "New"; class hash unchanged.
    const remote = manifest([[2, 'New', 'Foo', 'h']]);
    const local = { classes: { [entryKey(2, 'Old', 'Foo')]: 'h' } };
    const d = diffManifest(remote, local);
    expect(d.toFetch).toEqual([{ dictIndex: 2, dictName: 'New', className: 'Foo' }]);
    expect(d.toDeleteKeys).toEqual([entryKey(2, 'Old', 'Foo')]);
  });
});

describe('stateFromManifest', () => {
  it('builds keyed hash state', () => {
    const state = stateFromManifest(manifest([[1, 'UG', 'Foo', 'a'], [2, 'G', 'Bar', 'b']]));
    expect(state.classes).toEqual({
      [entryKey(1, 'UG', 'Foo')]: 'a',
      [entryKey(2, 'G', 'Bar')]: 'b',
    });
  });
});

describe('splitKey', () => {
  it('inverts entryKey, preserving class names', () => {
    expect(splitKey(entryKey(3, 'Dict', 'My.Weird.Name'))).toEqual({
      dictIndex: 3,
      dictName: 'Dict',
      className: 'My.Weird.Name',
    });
  });
});

describe('chunkRefs', () => {
  it('splits refs into batches of the given size', () => {
    const refs = Array.from({ length: 5 }, (_, i) => ({
      dictIndex: 1, dictName: 'UG', className: `C${i}`,
    }));
    const batches = chunkRefs(refs, 2);
    expect(batches.map(b => b.length)).toEqual([2, 2, 1]);
  });

  it('returns no batches for empty input', () => {
    expect(chunkRefs([], 10)).toEqual([]);
  });
});
