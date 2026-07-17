/**
 * Pure parser for the class-definition history JSON the GsClassHistory engine
 * helper returns (built on GemStone's native classHistory). Kept free of any
 * `vscode` dependency so it unit-tests directly.
 *
 * One entry per version, newest first, each carrying the version index, the name
 * it had then (so a rename shows its old names), its object id (oop), the
 * timeStamp and userId of when/who defined it, an isCurrent flag, its definition
 * source, and the methods added/removed/modified relative to the previous version.
 */

export type MethodChangeKind = 'added' | 'removed' | 'modified';

export interface MethodChange {
  side: 'instance' | 'class';
  selector: string;
  change: MethodChangeKind;
}

export interface ClassVersion {
  index: number;
  name: string;
  oop: number;
  timeStamp: string;
  userId: string;
  isCurrent: boolean;
  definition: string;
  changedMethods: MethodChange[];
}

/** The result of the redo/restore query. `name` is the restored class's name,
 *  which DIFFERS from the name history was opened under when the restored version
 *  had a different name (restoring across a rename renames the class back). */
export interface RevertResult {
  reverted: boolean;
  index?: number;
  newIndex?: number;
  name?: string;
  failed?: number;
  error?: string;
}

function parseMethodChange(raw: unknown): MethodChange | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const side = m.side === 'class' ? 'class' : 'instance';
  const change = m.change;
  if (change !== 'added' && change !== 'removed' && change !== 'modified') return null;
  if (typeof m.selector !== 'string') return null;
  return { side, selector: m.selector, change };
}

/** Parse the history JSON. Throws on the engine's error envelope (unbound name)
 *  or a malformed payload — callers surface that as an error. */
export function parseClassHistory(json: string): ClassVersion[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    && typeof (parsed as Record<string, unknown>).error === 'string') {
    throw new Error((parsed as Record<string, unknown>).error as string);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Class history did not return a version array.');
  }
  return parsed
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      index: typeof v.index === 'number' ? v.index : 0,
      name: typeof v.name === 'string' ? v.name : '?',
      oop: typeof v.oop === 'number' ? v.oop : 0,
      timeStamp: typeof v.timeStamp === 'string' ? v.timeStamp : '',
      userId: typeof v.userId === 'string' ? v.userId : '',
      isCurrent: v.isCurrent === true,
      definition: typeof v.definition === 'string' ? v.definition : '',
      changedMethods: Array.isArray(v.changedMethods)
        ? v.changedMethods.map(parseMethodChange).filter((m): m is MethodChange => m !== null)
        : [],
    }));
}

/** The result of removing a version from the class history. */
export interface RemoveResult {
  removed: boolean;
  index?: number;
  remaining?: number;
  error?: string;
}

/** Parse the remove-version result. */
export function parseRemoveResult(json: string): RemoveResult {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Remove version did not return a result envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    removed: env.removed === true,
    index: typeof env.index === 'number' ? env.index : undefined,
    remaining: typeof env.remaining === 'number' ? env.remaining : undefined,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** Parse the redo/restore result. */
export function parseRevertResult(json: string): RevertResult {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Restore did not return a result envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const apply = (typeof env.apply === 'object' && env.apply !== null)
    ? env.apply as Record<string, unknown> : undefined;
  const failed = apply && Array.isArray(apply.failed) ? apply.failed.length : undefined;
  return {
    reverted: env.reverted === true,
    index: typeof env.index === 'number' ? env.index : undefined,
    newIndex: typeof env.newIndex === 'number' ? env.newIndex : undefined,
    name: typeof env.name === 'string' ? env.name : undefined,
    failed,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** A one-line summary for a version row, e.g. "[2] Foo — 2026-07-17 … by Bob". */
export function versionSummary(v: ClassVersion): string {
  const cur = v.isCurrent ? ' (current)' : '';
  const who = v.userId ? ` by ${v.userId}` : '';
  return `[${v.index}] ${v.name}${cur} — ${v.timeStamp}${who}`;
}
