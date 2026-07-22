import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';
import { runNbCall } from './nbRunner';

import { QueryExecutor } from './queries/types';

// Read-path shared queries.
import { getMethodSource as sharedGetMethodSource } from './queries/getMethodSource';
import { getBaseMethodSource as sharedGetBaseMethodSource } from './queries/getBaseMethodSource';
import { getDictionaryNames as sharedGetDictionaryNames } from './queries/getDictionaryNames';
import { getClassNames as sharedGetClassNames } from './queries/getClassNames';
import {
  getClassesWithCategory as sharedGetClassesWithCategory,
  ClassCategoryEntry,
} from './queries/getClassesWithCategory';
import { getDictionaryClassFileOutOrder as sharedGetDictionaryClassFileOutOrder } from './queries/getDictionaryClassFileOutOrder';
import { getDictionaryEntries as sharedGetDictionaryEntries } from './queries/getDictionaryEntries';
import { getGlobalsForDictionary as sharedGetGlobalsForDictionary } from './queries/getGlobalsForDictionary';
import { getMethodCategories as sharedGetMethodCategories } from './queries/getMethodCategories';
import { getClassEnvironments as sharedGetClassEnvironments } from './queries/getClassEnvironments';
import { getClassDefinition as sharedGetClassDefinition } from './queries/getClassDefinition';
import { getClassComment as sharedGetClassComment } from './queries/getClassComment';
import { canClassBeWritten as sharedCanClassBeWritten } from './queries/canClassBeWritten';
import { getAllClassNames as sharedGetAllClassNames } from './queries/getAllClassNames';
import { getClassHierarchy as sharedGetClassHierarchy } from './queries/getClassHierarchy';
import { fileOutClass as sharedFileOutClass } from './queries/fileOutClass';
import { describeClass as sharedDescribeClass } from './queries/describeClass';
import { getInstVarNames as sharedGetInstVarNames } from './queries/getInstVarNames';
import { getDefinedInstVarNames as sharedGetDefinedInstVarNames } from './queries/getDefinedInstVarNames';
import { getDefinedInstVarCounts as sharedGetDefinedInstVarCounts } from './queries/getDefinedInstVarCounts';
import {
  getGrailStubReflection as sharedGetGrailStubReflection,
  GrailStubReflection,
} from './queries/grailStubReflection';
import { getAllSelectors as sharedGetAllSelectors } from './queries/getAllSelectors';
import { getMethodList as sharedGetMethodList } from './queries/getMethodList';
import { getSourceOffsets as sharedGetSourceOffsets } from './queries/getSourceOffsets';
import { getStepPointSelectorRanges as sharedGetStepPointSelectorRanges } from './queries/getStepPointSelectorRanges';
import { listRowanProjects as sharedListRowanProjects } from './queries/rowan/listRowanProjects';
import { getGemCacheKB as sharedGetGemCacheKB } from './queries/rowan/getGemCacheKB';
import { exportRowanProject as sharedExportRowanProject } from './queries/rowan/exportRowanProject';
import { findRowanClassOwners as sharedFindRowanClassOwners } from './queries/rowan/findRowanClassOwners';
import { listAllRowanClasses as sharedListAllRowanClasses } from './queries/rowan/listAllRowanClasses';
import {
  buildLoadRowanProjectCode,
  parseRowanLoadResult,
  RowanLoadResult,
} from './queries/rowan/loadRowanProject';
import { diffRowanProject as sharedDiffRowanProject } from './queries/rowan/diffRowanProject';
import { unloadRowanProject as sharedUnloadRowanProject } from './queries/rowan/unloadRowanProject';
import {
  searchMethodSource as sharedSearchMethodSource,
  sendersOf as sharedSendersOf,
  implementorsOf as sharedImplementorsOf,
  hierarchyImplementorsOf as sharedHierarchyImplementorsOf,
  referencesToObject as sharedReferencesToObject,
} from './queries/methodSearch';

// Write-path shared queries.
import { compileMethod as sharedCompileMethod } from './queries/compileMethod';
import { compileClassDefinition as sharedCompileClassDefinition } from './queries/compileClassDefinition';
import { setClassComment as sharedSetClassComment } from './queries/setClassComment';
import { deleteMethod as sharedDeleteMethod } from './queries/deleteMethod';
import { recategorizeMethod as sharedRecategorizeMethod } from './queries/recategorizeMethod';
import { recategorizeClass as sharedRecategorizeClass } from './queries/recategorizeClass';
import { copyMethodToClass as sharedCopyMethodToClass } from './queries/copyMethodToClass';
import { renameCategory as sharedRenameCategory } from './queries/renameCategory';
import { deleteClass as sharedDeleteClass } from './queries/deleteClass';
import { moveClass as sharedMoveClass } from './queries/moveClass';
import { addDictionary as sharedAddDictionary } from './queries/addDictionary';
import { removeDictionary as sharedRemoveDictionary } from './queries/removeDictionary';
import { moveDictionaryUp as sharedMoveDictionaryUp } from './queries/moveDictionaryUp';
import { moveDictionaryDown as sharedMoveDictionaryDown } from './queries/moveDictionaryDown';
import { setBreakAtStepPoint as sharedSetBreakAtStepPoint } from './queries/setBreakAtStepPoint';
import { clearBreakAtStepPoint as sharedClearBreakAtStepPoint } from './queries/clearBreakAtStepPoint';
import { clearAllBreaks as sharedClearAllBreaks } from './queries/clearAllBreaks';

// Re-export shared types so existing callers (extension.ts, systemBrowser.ts, etc.)
// can continue to import them from './browserQueries'.
export type { DictEntry } from './queries/getDictionaryEntries';
export type { GlobalEntry } from './queries/getGlobalsForDictionary';
export type { ClassNameEntry } from './queries/getAllClassNames';
export type { ClassCategoryEntry } from './queries/getClassesWithCategory';
export type { EnvCategoryLine } from './queries/getClassEnvironments';
export type { ClassHierarchyEntry } from './queries/getClassHierarchy';
export type { MethodEntry } from './queries/getMethodList';
export type { StepPointSelectorInfo } from './queries/getStepPointSelectorRanges';
export type { MethodSearchResult } from './queries/methodSearch';
export type { RowanProject, RowanProjectList } from './queries/rowan/listRowanProjects';
export type { RowanExportResult } from './queries/rowan/exportRowanProject';
export type { RowanClassOwner, RowanClassOwners } from './queries/rowan/findRowanClassOwners';
export type { RowanClassLocation } from './queries/rowan/listAllRowanClasses';
export type { RowanLoadResult } from './queries/rowan/loadRowanProject';
export type { RowanDiff, RowanDiffOp } from './queries/rowan/diffRowanProject';
export { formatRowanDiff } from './queries/rowan/diffRowanProject';
export type { RowanUnloadResult } from './queries/rowan/unloadRowanProject';

const MAX_RESULT = 256 * 1024;

// Cache resolved OOP_CLASS_Utf8 per session handle (Node.js strings are UTF-8 when passed via koffi)
const classUtf8Cache = new Map<unknown, bigint>();

export class BrowserQueryError extends Error {
  constructor(
    message: string,
    public readonly gciErrorNumber: number = 0,
  ) {
    super(message);
  }
}

function resolveClassUtf8(session: ActiveSession): bigint {
  let oop = classUtf8Cache.get(session.handle);
  if (oop !== undefined) return oop;
  const { result, err } = session.gci.GciTsResolveSymbol(session.handle, 'Utf8', OOP_NIL);
  if (err.number !== 0) {
    throw new BrowserQueryError(err.message || `Cannot resolve Utf8 class`, err.number);
  }
  oop = result;
  classUtf8Cache.set(session.handle, oop);
  return oop;
}

export function executeFetchString(session: ActiveSession, label: string, code: string): string {
  logQuery(session.id, label, code);

  // Check if session is busy with an async operation (e.g., Display It)
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  logGciCall(session.id, 'GciTsExecuteFetchBytes', {
    sourceStr: code,
    sourceSize: -1,
    sourceOop: oopClassUtf8,
    contextObject: OOP_ILLEGAL,
    symbolList: OOP_NIL,
    maxResultSize: MAX_RESULT,
  });

  const { bytesReturned, data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    MAX_RESULT,
  );

  logGciResult(session.id, 'GciTsExecuteFetchBytes', {
    bytesReturned,
    data,
    'err.number': err.number,
    'err.category': err.category,
    'err.context': err.context,
    'err.exceptionObj': err.exceptionObj,
    'err.args': err.args,
    'err.message': err.message,
    'err.reason': err.reason,
    'err.fatal': err.fatal,
  });

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, err.number);
  }
  logResult(session.id, data);
  return data;
}

// Non-blocking variant of executeFetchString for LONG-RUNNING queries (e.g. a
// Rowan project load, which can take minutes). The synchronous GCI call would
// freeze the whole extension host for the duration; this one starts the
// execution with GciTsNbExecute and polls via the shared nb runner, which keeps
// VS Code responsive and, past ~2s, shows a cancellable progress notification
// (soft break on first Cancel, hard break on second — see nbRunner). The result
// must be a String, fetched verbatim (no printString quoting) for parity with
// executeFetchString.
export async function executeFetchStringNb(
  session: ActiveSession,
  label: string,
  code: string,
  progressTitle?: string,
  suppressNotification = false,
): Promise<string> {
  logQuery(session.id, label, code);

  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  const data = await runNbCall(
    session,
    () =>
      session.gci.GciTsNbExecute(session.handle, code, oopClassUtf8, OOP_ILLEGAL, OOP_NIL, 0, 0),
    () => {
      const { result: resultOop, err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        const msg = err.message || `GCI error ${err.number}`;
        logError(session.id, msg);
        throw new BrowserQueryError(msg, err.number);
      }
      const fetched = session.gci.GciTsFetchChars(session.handle, resultOop, 1n, MAX_RESULT);
      if (fetched.err.number !== 0) {
        const msg = fetched.err.message || `GCI error ${fetched.err.number}`;
        logError(session.id, msg);
        throw new BrowserQueryError(msg, fetched.err.number);
      }
      return fetched.data;
    },
    { title: progressTitle ?? `GemStone: ${label}…`, suppressNotification },
  );

  logResult(session.id, data);
  return data;
}

// Like executeFetchString but with a caller-chosen result-buffer size. The
// class-sync transport (see client/src/sync/) moves multi-MB chunks well above
// the default 256 KB cap, slicing on code-point boundaries so the UTF-8 decode
// here is always lossless. Result data is not logged — chunks can be megabytes.
export function executeFetchStringWithLimit(
  session: ActiveSession,
  label: string,
  code: string,
  maxBytes: number,
): string {
  logQuery(session.id, label, code);

  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  const { data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    maxBytes,
  );

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, err.number);
  }
  return data;
}

// A LimitExecutor bound to a session, for the sync transport.
export function boundLimitExecutor(session: ActiveSession) {
  return (label: string, code: string, maxBytes: number) =>
    executeFetchStringWithLimit(session, label, code, maxBytes);
}

export function checkEnhancedInspectorAvailable(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
      session,
      'checkEnhancedInspectorAvailable',
      "[GtRemotePhlowViewedObject notNil printString] on: Error do: [:e | 'false']",
    );
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Tri-state probe of whether the session's transaction holds uncommitted changes
 * that an abort or logout would discard: `true` = pending work, `false` = clean,
 * `undefined` = couldn't tell (session busy, unreachable, or an unrecognized reply).
 *
 * Callers must treat `undefined` like `true` — prompt rather than silently
 * discard — since a failed probe is not evidence that the transaction is clean.
 */
export function sessionNeedsCommit(session: ActiveSession): boolean | undefined {
  try {
    const result = executeFetchString(
      session,
      'sessionNeedsCommit',
      'System needsCommit printString',
    ).trim();
    if (result === 'true') return true;
    if (result === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binds a session to the QueryExecutor shape that shared queries expect,
 * backed by GciLibrary.executeAndFetchString.
 *
 * executeAndFetchString explicitly encodes the evaluated result as UTF-8 in
 * Smalltalk before paging it out, so results decode correctly regardless of
 * their original encoding and are not capped at a single fixed-size buffer.
 */
function defaultQueryExecutorUsing(session: ActiveSession): QueryExecutor {
  return (label, code) => {
    logQuery(session.id, label, code);

    const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
    if (inProgress !== 0) {
      const msg = 'Session is busy with another operation. Please wait or use a different session.';
      logError(session.id, msg);
      throw new BrowserQueryError(msg);
    }

    try {
      const data = session.gci.executeAndFetchString(session.handle, code);
      logResult(session.id, data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);
      throw new BrowserQueryError(msg);
    }
  };
}

// ── Read-only queries (thin delegates to client/src/queries/) ─────────────

export function getDictionaryNames(session: ActiveSession): string[] {
  return sharedGetDictionaryNames(defaultQueryExecutorUsing(session));
}

// ── Rowan browser queries ─────────────────────────────────────────────────

export function getGemCacheKB(session: ActiveSession) {
  return sharedGetGemCacheKB(defaultQueryExecutorUsing(session));
}

export function listRowanProjects(session: ActiveSession) {
  return sharedListRowanProjects(defaultQueryExecutorUsing(session));
}

export function exportRowanProject(session: ActiveSession, projectName: string, targetDir: string) {
  return sharedExportRowanProject(defaultQueryExecutorUsing(session), projectName, targetDir);
}

export function findRowanClassOwners(session: ActiveSession, className: string) {
  return sharedFindRowanClassOwners(defaultQueryExecutorUsing(session), className);
}

export function listAllRowanClasses(session: ActiveSession) {
  return sharedListAllRowanClasses(defaultQueryExecutorUsing(session));
}

// Non-blocking load for the extension: same Smalltalk, run via
// executeFetchStringNb so a minutes-long load doesn't freeze the extension host
// and the user gets a cancellable progress notification.
export async function loadRowanProjectNb(
  session: ActiveSession,
  specPath: string,
  diskPath: string,
  progressTitle: string,
): Promise<RowanLoadResult> {
  const raw = await executeFetchStringNb(
    session,
    `loadRowanProject(${specPath})`,
    buildLoadRowanProjectCode(specPath, diskPath),
    progressTitle,
  );
  return parseRowanLoadResult(raw);
}

export function diffRowanProject(session: ActiveSession, projectName: string) {
  return sharedDiffRowanProject(defaultQueryExecutorUsing(session), projectName);
}

export function unloadRowanProject(session: ActiveSession, projectName: string) {
  return sharedUnloadRowanProject(defaultQueryExecutorUsing(session), projectName);
}

export function getClassNames(session: ActiveSession, dict: number | string): string[] {
  return sharedGetClassNames(defaultQueryExecutorUsing(session), dict);
}

export function getClassesWithCategory(
  session: ActiveSession,
  dict: number | string,
): ClassCategoryEntry[] {
  return sharedGetClassesWithCategory(defaultQueryExecutorUsing(session), dict);
}

export function getDictionaryClassFileOutOrder(
  session: ActiveSession,
  dict: number | string,
): string[] {
  return sharedGetDictionaryClassFileOutOrder(defaultQueryExecutorUsing(session), dict);
}

export function getDictionaryEntries(session: ActiveSession, dict: number | string) {
  return sharedGetDictionaryEntries(defaultQueryExecutorUsing(session), dict);
}

export function getGlobalsForDictionary(session: ActiveSession, dictIndex: number) {
  return sharedGetGlobalsForDictionary(defaultQueryExecutorUsing(session), dictIndex);
}

export function getMethodCategories(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  dict?: number | string,
): string[] {
  return sharedGetMethodCategories(defaultQueryExecutorUsing(session), className, isMeta, dict);
}

export function getClassEnvironments(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  maxEnv: number,
) {
  return sharedGetClassEnvironments(
    defaultQueryExecutorUsing(session),
    dictIndex,
    className,
    maxEnv,
  );
}

export function getMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetMethodSource(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getBaseMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetBaseMethodSource(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getClassDefinition(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassDefinition(defaultQueryExecutorUsing(session), className, dict);
}

export function getClassComment(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassComment(defaultQueryExecutorUsing(session), className, dict);
}

export function canClassBeWritten(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): boolean {
  return sharedCanClassBeWritten(defaultQueryExecutorUsing(session), className, dict);
}

export function getAllClassNames(session: ActiveSession) {
  return sharedGetAllClassNames(defaultQueryExecutorUsing(session));
}

export function getClassHierarchy(session: ActiveSession, className: string) {
  return sharedGetClassHierarchy(defaultQueryExecutorUsing(session), className);
}

export function fileOutClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedFileOutClass(defaultQueryExecutorUsing(session), className, dict);
}

export function describeClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedDescribeClass(defaultQueryExecutorUsing(session), className, dict);
}

export function getInstVarNames(session: ActiveSession, className: string): string[] {
  return sharedGetInstVarNames(defaultQueryExecutorUsing(session), className);
}

export function getDefinedInstVarNames(session: ActiveSession, className: string): string[] {
  return sharedGetDefinedInstVarNames(defaultQueryExecutorUsing(session), className);
}

export function getDefinedInstVarCounts(
  session: ActiveSession,
  dict: number | string,
): Map<string, number> {
  return sharedGetDefinedInstVarCounts(defaultQueryExecutorUsing(session), dict);
}

export function getGrailStubReflection(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): GrailStubReflection {
  return sharedGetGrailStubReflection(defaultQueryExecutorUsing(session), className, dict);
}

export function getAllSelectors(session: ActiveSession, className: string): string[] {
  return sharedGetAllSelectors(defaultQueryExecutorUsing(session), className);
}

export function getMethodList(session: ActiveSession, className: string) {
  return sharedGetMethodList(defaultQueryExecutorUsing(session), className);
}

export function getSourceOffsets(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): number[] {
  return sharedGetSourceOffsets(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getStepPointSelectorRanges(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
) {
  return sharedGetStepPointSelectorRanges(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function searchMethodSource(session: ActiveSession, term: string, ignoreCase: boolean) {
  return sharedSearchMethodSource(defaultQueryExecutorUsing(session), term, ignoreCase);
}

export function sendersOf(session: ActiveSession, selector: string, environmentId: number = 0) {
  return sharedSendersOf(defaultQueryExecutorUsing(session), selector, environmentId);
}

export function implementorsOf(
  session: ActiveSession,
  selector: string,
  environmentId: number = 0,
) {
  return sharedImplementorsOf(defaultQueryExecutorUsing(session), selector, environmentId);
}

export function hierarchyImplementorsOf(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  selector: string,
  isMeta: boolean,
  direction: 'up' | 'down',
  environmentId: number = 0,
) {
  return sharedHierarchyImplementorsOf(
    defaultQueryExecutorUsing(session),
    dictIndex,
    className,
    selector,
    isMeta,
    direction,
    environmentId,
  );
}

export function referencesToObject(
  session: ActiveSession,
  objectName: string,
  environmentId: number = 0,
) {
  return sharedReferencesToObject(defaultQueryExecutorUsing(session), objectName, environmentId);
}

// ── Write-path queries (mutations) ─────────────────────────────────────────
// All of these delegate to the shared layer. None auto-commit.

export function compileClassDefinition(session: ActiveSession, source: string): string {
  return sharedCompileClassDefinition(defaultQueryExecutorUsing(session), source);
}

export function compileMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedCompileMethod(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    category,
    source,
    environmentId,
    dict,
  );
}

export function setClassComment(
  session: ActiveSession,
  className: string,
  comment: string,
  dict?: number | string,
): string {
  return sharedSetClassComment(defaultQueryExecutorUsing(session), className, comment, dict);
}

export function recategorizeClass(
  session: ActiveSession,
  className: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeClass(defaultQueryExecutorUsing(session), className, newCategory, dict);
}

export function copyMethodToClass(
  session: ActiveSession,
  sourceClass: string,
  targetClass: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedCopyMethodToClass(
    defaultQueryExecutorUsing(session),
    sourceClass,
    targetClass,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function deleteMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  dict?: number | string,
): string {
  return sharedDeleteMethod(defaultQueryExecutorUsing(session), className, isMeta, selector, dict);
}

export function recategorizeMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeMethod(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    newCategory,
    dict,
  );
}

export function renameCategory(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  oldCategory: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRenameCategory(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    oldCategory,
    newCategory,
    dict,
  );
}

export function deleteClass(
  session: ActiveSession,
  dict: number | string,
  className: string,
): string {
  return sharedDeleteClass(defaultQueryExecutorUsing(session), dict, className);
}

export function moveClass(
  session: ActiveSession,
  srcDictIndex: number,
  destDictIndex: number,
  className: string,
): string {
  return sharedMoveClass(
    defaultQueryExecutorUsing(session),
    srcDictIndex,
    destDictIndex,
    className,
  );
}

export function addDictionary(session: ActiveSession, dictName: string): string {
  return sharedAddDictionary(defaultQueryExecutorUsing(session), dictName);
}

export function removeDictionary(session: ActiveSession, dict: number | string): string {
  return sharedRemoveDictionary(defaultQueryExecutorUsing(session), dict);
}

export function moveDictionaryUp(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryUp(defaultQueryExecutorUsing(session), dictIndex);
}

export function moveDictionaryDown(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryDown(defaultQueryExecutorUsing(session), dictIndex);
}

export function setBreakAtStepPoint(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedSetBreakAtStepPoint(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    stepPoint,
    environmentId,
    dict,
  );
}

export function clearBreakAtStepPoint(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedClearBreakAtStepPoint(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    stepPoint,
    environmentId,
    dict,
  );
}

export function clearAllBreaks(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedClearAllBreaks(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}
