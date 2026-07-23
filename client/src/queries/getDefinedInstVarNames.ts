import { QueryExecutor } from './types';
import { splitLines } from './util';

// Instance variables DEFINED in this class only (not inherited) — GemStone's
// `instVarNames`, unlike `allInstVarNames` (see getInstVarNames.ts) which walks
// the whole superclass chain. Used by the GemStone Explorer's per-class ivar
// sub-tree, where renaming an inherited ivar belongs to its defining class.
export function getDefinedInstVarNames(execute: QueryExecutor, className: string): string[] {
  const code = `| ws |
ws := WriteStream on: String new.
${className} instVarNames do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(code));
}
