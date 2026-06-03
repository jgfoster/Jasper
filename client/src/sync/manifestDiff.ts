// Diff a freshly fetched manifest against the locally persisted mirror state to
// decide the minimal work: which classes to (re)fetch and which files to drop.

import { Manifest } from './syncFraming';
import { ClassRef } from './syncProtocol';

// Persisted alongside the mirror. Keyed by `${dictIndex}\t${dictName}\t${className}`
// so a class shadowed across dictionaries is tracked per dictionary, and a
// dictionary rename or reorder produces fresh keys (old files pruned, new ones
// fetched) — matching the one-file-per-(dict, class) layout on disk.
export interface MirrorState {
  classes: Record<string, string>; // key -> md5 hash
}

export interface DiffResult {
  toFetch: ClassRef[]; // new or changed classes (need a fresh file-out)
  toDeleteKeys: string[]; // classes gone from the image (files to remove)
  unchanged: number;
}

export function entryKey(dictIndex: number, dictName: string, className: string): string {
  return `${dictIndex}\t${dictName}\t${className}`;
}

export function emptyState(): MirrorState {
  return { classes: {} };
}

export function diffManifest(remote: Manifest, local: MirrorState): DiffResult {
  const toFetch: ClassRef[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const entry of remote.classes) {
    const key = entryKey(entry.dictIndex, entry.dictName, entry.className);
    seen.add(key);
    if (local.classes[key] === entry.hash) {
      unchanged++;
    } else {
      toFetch.push({
        dictIndex: entry.dictIndex,
        dictName: entry.dictName,
        className: entry.className,
      });
    }
  }

  const toDeleteKeys: string[] = [];
  for (const key of Object.keys(local.classes)) {
    if (!seen.has(key)) toDeleteKeys.push(key);
  }

  return { toFetch, toDeleteKeys, unchanged };
}

// Build the next persisted state from the remote manifest (the new source of
// truth once files are written).
export function stateFromManifest(remote: Manifest): MirrorState {
  const classes: Record<string, string> = {};
  for (const entry of remote.classes) {
    classes[entryKey(entry.dictIndex, entry.dictName, entry.className)] = entry.hash;
  }
  return { classes };
}

export function splitKey(
  key: string,
): { dictIndex: number; dictName: string; className: string } {
  const parts = key.split('\t');
  return {
    dictIndex: parseInt(parts[0], 10),
    dictName: parts[1],
    className: parts.slice(2).join('\t'),
  };
}

export function chunkRefs(refs: ClassRef[], size: number): ClassRef[][] {
  const batches: ClassRef[][] = [];
  for (let i = 0; i < refs.length; i += size) {
    batches.push(refs.slice(i, i + size));
  }
  return batches;
}
