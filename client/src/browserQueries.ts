import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';
import { runNbCall } from './nbRunner';

import { QueryExecutor } from './queries/types';

// Read-path shared queries.
import { getMethodSource as sharedGetMethodSource } from './queries/getMethodSource';
import { getBaseMethodSource as sharedGetBaseMethodSource } from './queries/getBaseMethodSource';
import { getDictionaryNames as sharedGetDictionaryNames } from './queries/getDictionaryNames';
import { getPoolDictionaryNames as sharedGetPoolDictionaryNames } from './queries/getPoolDictionaryNames';
import { getClassNames as sharedGetClassNames } from './queries/getClassNames';
import {
  getClassesWithCategory as sharedGetClassesWithCategory,
  ClassCategoryEntry,
} from './queries/getClassesWithCategory';
import { getDictionaryClassFileOutOrder as sharedGetDictionaryClassFileOutOrder } from './queries/getDictionaryClassFileOutOrder';
import { getDictionaryEntries as sharedGetDictionaryEntries } from './queries/getDictionaryEntries';
import { getGlobalsForDictionary as sharedGetGlobalsForDictionary } from './queries/getGlobalsForDictionary';
import { getMethodCategories as sharedGetMethodCategories } from './queries/getMethodCategories';
import { getMethodSelectors as sharedGetMethodSelectors } from './queries/getMethodSelectors';
import { getClassEnvironments as sharedGetClassEnvironments } from './queries/getClassEnvironments';
import { getClassDefinition as sharedGetClassDefinition } from './queries/getClassDefinition';
import { getClassComment as sharedGetClassComment } from './queries/getClassComment';
import { getSuperclassDictName as sharedGetSuperclassDictName } from './queries/getSuperclassDictName';
import { canClassBeWritten as sharedCanClassBeWritten } from './queries/canClassBeWritten';
import { getAllClassNames as sharedGetAllClassNames } from './queries/getAllClassNames';
import { getClassHierarchy as sharedGetClassHierarchy } from './queries/getClassHierarchy';
import { fileOutClass as sharedFileOutClass } from './queries/fileOutClass';
import { describeClass as sharedDescribeClass } from './queries/describeClass';
import { loadClassInfo as sharedLoadClassInfo } from './queries/loadClassInfo';
import { getInstVarNames as sharedGetInstVarNames } from './queries/getInstVarNames';
import { getDefinedInstVarNames as sharedGetDefinedInstVarNames } from './queries/getDefinedInstVarNames';
import { getDefinedInstVarCounts as sharedGetDefinedInstVarCounts } from './queries/getDefinedInstVarCounts';
import { getDefinedClassVarNames as sharedGetDefinedClassVarNames } from './queries/getDefinedClassVarNames';
import { getVisibleClassVarNames as sharedGetVisibleClassVarNames } from './queries/getVisibleClassVarNames';
import { getDefinedClassVarCounts as sharedGetDefinedClassVarCounts } from './queries/getDefinedClassVarCounts';
import {
  getClassVersions as sharedGetClassVersions,
  ClassVersionInfo,
} from './queries/getClassVersions';
import { previewRenameInstVar as sharedPreviewRenameInstVar } from './queries/previewRenameInstVar';
import {
  startRenameMethodPreview as sharedStartRenameMethodPreview,
  pageRenameMethodPreview as sharedPageRenameMethodPreview,
  applyRenameMethod as sharedApplyRenameMethod,
  clearRenameMethodPreview as sharedClearRenameMethodPreview,
  RenameMethodScope,
} from './queries/previewRenameMethod';
import {
  startRenameClassPreview as sharedStartRenameClassPreview,
  pageRenameClassPreview as sharedPageRenameClassPreview,
  applyRenameClass as sharedApplyRenameClass,
  clearRenameClassPreview as sharedClearRenameClassPreview,
  RenameClassScope,
  RenameClassOptions,
} from './queries/previewRenameClass';
import {
  startRenameClassVarPreview as sharedStartRenameClassVarPreview,
  pageRenameClassVarPreview as sharedPageRenameClassVarPreview,
  applyRenameClassVar as sharedApplyRenameClassVar,
  clearRenameClassVarPreview as sharedClearRenameClassVarPreview,
} from './queries/previewRenameClassVar';
import {
  startRenameTemporaryPreview as sharedStartRenameTemporaryPreview,
  pageRenameTemporaryPreview as sharedPageRenameTemporaryPreview,
  applyRenameTemporary as sharedApplyRenameTemporary,
  clearRenameTemporaryPreview as sharedClearRenameTemporaryPreview,
  renameTemporaryDeclineReason as sharedRenameTemporaryDeclineReason,
} from './queries/previewRenameTemporary';
import {
  getClassHistory as sharedGetClassHistory,
  revertClassToVersion as sharedRevertClassToVersion,
  removeClassVersion as sharedRemoveClassVersion,
} from './queries/classHistory';
import { globalNameInUse as sharedGlobalNameInUse } from './queries/globalNameInUse';
import { isKernelClass as sharedIsKernelClass } from './queries/isKernelClass';
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
  loadRowanProject as sharedLoadRowanProject,
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
import { reclassifyClass as sharedReclassifyClass } from './queries/reclassifyClass';
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
export type { ClassInfo } from './queries/loadClassInfo';
export type { RowanProject, RowanProjectList } from './queries/rowan/listRowanProjects';
export type { RowanExportResult } from './queries/rowan/exportRowanProject';
export type { RowanClassOwner, RowanClassOwners } from './queries/rowan/findRowanClassOwners';
export type { RowanClassLocation } from './queries/rowan/listAllRowanClasses';
export type { RowanLoadResult } from './queries/rowan/loadRowanProject';
export type { RowanDiff, RowanDiffOp } from './queries/rowan/diffRowanProject';
export { formatRowanDiff } from './queries/rowan/diffRowanProject';
export type { RowanUnloadResult } from './queries/rowan/unloadRowanProject';
export type { RenameClassScope, RenameClassOptions } from './queries/previewRenameClass';
export type { ClassVersionInfo } from './queries/getClassVersions';

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

/** Whether the server-side refactoring engine is loaded in this session's stone.
 *  Probes for the rename-instance-variable refactoring class, the entry point the
 *  Explorer's rename command drives. Resolving the name via the symbol list avoids
 *  a compile-time reference to a class that may be absent (the engine ships as an
 *  optional, separately-installed payload — see the loader stage). */
export function checkRefactoringSupportAvailable(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
      session,
      'checkRefactoringSupportAvailable',
      "[(System myUserProfile symbolList objectNamed: #GsRenameInstanceVariableRefactoring) notNil printString] on: Error do: [:e | 'false']",
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

// Bind a session to the QueryExecutor shape that shared queries expect.
function bind(session: ActiveSession): QueryExecutor {
  return (label, code) => executeFetchString(session, label, code);
}

// ── Read-only queries (thin delegates to client/src/queries/) ─────────────

export function getDictionaryNames(session: ActiveSession): string[] {
  return sharedGetDictionaryNames(bind(session));
}

export function getPoolDictionaryNames(session: ActiveSession): string[] {
  return sharedGetPoolDictionaryNames(bind(session));
}

// ── Rowan browser queries ─────────────────────────────────────────────────

export function getGemCacheKB(session: ActiveSession) {
  return sharedGetGemCacheKB(bind(session));
}

export function listRowanProjects(session: ActiveSession) {
  return sharedListRowanProjects(bind(session));
}

export function exportRowanProject(session: ActiveSession, projectName: string, targetDir: string) {
  return sharedExportRowanProject(bind(session), projectName, targetDir);
}

export function findRowanClassOwners(session: ActiveSession, className: string) {
  return sharedFindRowanClassOwners(bind(session), className);
}

export function listAllRowanClasses(session: ActiveSession) {
  return sharedListAllRowanClasses(bind(session));
}

export function loadRowanProject(session: ActiveSession, specPath: string, diskPath: string) {
  return sharedLoadRowanProject(bind(session), specPath, diskPath);
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
  return sharedDiffRowanProject(bind(session), projectName);
}

export function unloadRowanProject(session: ActiveSession, projectName: string) {
  return sharedUnloadRowanProject(bind(session), projectName);
}

export function getClassNames(session: ActiveSession, dict: number | string): string[] {
  return sharedGetClassNames(bind(session), dict);
}

export function getClassesWithCategory(
  session: ActiveSession,
  dict: number | string,
): ClassCategoryEntry[] {
  return sharedGetClassesWithCategory(bind(session), dict);
}

export function getDictionaryClassFileOutOrder(
  session: ActiveSession,
  dict: number | string,
): string[] {
  return sharedGetDictionaryClassFileOutOrder(bind(session), dict);
}

export function getDictionaryEntries(session: ActiveSession, dict: number | string) {
  return sharedGetDictionaryEntries(bind(session), dict);
}

export function getGlobalsForDictionary(session: ActiveSession, dictIndex: number) {
  return sharedGetGlobalsForDictionary(bind(session), dictIndex);
}

export function getMethodCategories(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  dict?: number | string,
): string[] {
  return sharedGetMethodCategories(bind(session), className, isMeta, dict);
}

export function getMethodSelectors(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  dict?: number | string,
): string[] {
  return sharedGetMethodSelectors(bind(session), className, isMeta, category, dict);
}

export function getClassEnvironments(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  maxEnv: number,
) {
  return sharedGetClassEnvironments(bind(session), dictIndex, className, maxEnv);
}

export function getMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetMethodSource(bind(session), className, isMeta, selector, environmentId, dict);
}

export function getBaseMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetBaseMethodSource(bind(session), className, isMeta, selector, environmentId, dict);
}

export function getClassDefinition(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassDefinition(bind(session), className, dict);
}

export function getClassComment(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassComment(bind(session), className, dict);
}

export function getSuperclassDictName(
  session: ActiveSession,
  dictIndex: number,
  className: string,
): string {
  return sharedGetSuperclassDictName(bind(session), dictIndex, className);
}

export function canClassBeWritten(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): boolean {
  return sharedCanClassBeWritten(bind(session), className, dict);
}

export function getAllClassNames(session: ActiveSession) {
  return sharedGetAllClassNames(bind(session));
}

export function getClassHierarchy(session: ActiveSession, className: string) {
  return sharedGetClassHierarchy(bind(session), className);
}

export function fileOutClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedFileOutClass(bind(session), className, dict);
}

export function loadClassInfo(session: ActiveSession, dictIndex: number, className: string) {
  return sharedLoadClassInfo(bind(session), dictIndex, className);
}

export function describeClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedDescribeClass(bind(session), className, dict);
}

export function getInstVarNames(session: ActiveSession, className: string): string[] {
  return sharedGetInstVarNames(bind(session), className);
}

export function getDefinedInstVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetDefinedInstVarNames(bind(session), className, dict);
}

export function getDefinedInstVarCounts(
  session: ActiveSession,
  dict: number | string,
): Map<string, number> {
  return sharedGetDefinedInstVarCounts(bind(session), dict);
}

export function getDefinedClassVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetDefinedClassVarNames(bind(session), className, dict);
}

export function getVisibleClassVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetVisibleClassVarNames(bind(session), className, dict);
}

export function getDefinedClassVarCounts(
  session: ActiveSession,
  dict: number | string,
): Map<string, number> {
  return sharedGetDefinedClassVarCounts(bind(session), dict);
}

export function getClassVersions(
  session: ActiveSession,
  dict: number | string,
): Map<string, ClassVersionInfo> {
  return sharedGetClassVersions(bind(session), dict);
}

export function previewRenameInstVar(
  session: ActiveSession,
  className: string,
  oldName: string,
  newName: string,
  dict?: number | string,
): string {
  return sharedPreviewRenameInstVar(bind(session), className, oldName, newName, dict);
}

// Paginated rename-method preview: fetched NON-BLOCKING so a slow build shows a
// progress notification and keeps the extension host responsive. Pages are
// byte-bounded (PREVIEW_PAGE_BYTES) to stay under the non-blocking fetch cap.
export function startRenameMethodPreview(
  session: ActiveSession,
  className: string,
  oldSelector: string,
  newParts: string[],
  permutation: number[],
  scope: RenameMethodScope,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldSelector}…`);
  return sharedStartRenameMethodPreview(
    exec,
    className,
    oldSelector,
    newParts,
    permutation,
    scope,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameMethodPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameMethodPreview(exec, token, offset, maxBytes);
}

export function applyRenameMethod(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameMethod(exec, token, deselectedIds);
}

export function clearRenameMethodPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameMethodPreview(bind(session), token);
}

// Paginated rename-class preview: fetched NON-BLOCKING (progress + responsive),
// byte-bounded pages, server-side apply. Mirrors the rename-method wrappers.
export function startRenameClassPreview(
  session: ActiveSession,
  className: string,
  newName: string,
  scope: RenameClassScope,
  options: RenameClassOptions,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${className}…`);
  return sharedStartRenameClassPreview(
    exec,
    className,
    newName,
    scope,
    options,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameClassPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameClassPreview(exec, token, offset, maxBytes);
}

export function applyRenameClass(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameClass(exec, token, deselectedIds);
}

export function clearRenameClassPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameClassPreview(bind(session), token);
}

// Paginated rename-class-variable preview: fetched NON-BLOCKING (progress +
// responsive), byte-bounded pages, server-side value-preserving apply. Mirrors the
// rename-method/class wrappers; the rename is all-or-nothing, so the apply always
// passes an empty deselected set.
export function startRenameClassVarPreview(
  session: ActiveSession,
  className: string,
  oldName: string,
  newName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldName}…`);
  return sharedStartRenameClassVarPreview(exec, className, oldName, newName, token, maxBytes, dict);
}

export function pageRenameClassVarPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameClassVarPreview(exec, token, offset, maxBytes);
}

export function applyRenameClassVar(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameClassVar(exec, token);
}

export function clearRenameClassVarPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameClassVarPreview(bind(session), token);
}

// Paginated rename-temporary/argument (R5) preview: method-local, a single
// methodRecompile change, fetched NON-BLOCKING, server-side apply. All-or-nothing,
// so the apply passes an empty deselected set.
export function startRenameTemporaryPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  newName: string,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldName}…`);
  return sharedStartRenameTemporaryPreview(
    exec,
    className,
    selector,
    isMeta,
    oldName,
    newName,
    offset,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameTemporaryPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameTemporaryPreview(exec, token, offset, maxBytes);
}

export function applyRenameTemporary(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameTemporary(exec, token);
}

export function clearRenameTemporaryPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameTemporaryPreview(bind(session), token);
}

export function renameTemporaryDeclineReason(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Checking…');
  return sharedRenameTemporaryDeclineReason(
    exec,
    className,
    selector,
    isMeta,
    oldName,
    offset,
    dict,
  );
}

// Class-definition history (native classHistory, this-stone-only, read-only) and
// the redo (restore a historical version as a new version, no commit).
export function getClassHistory(session: ActiveSession, className: string): string {
  return sharedGetClassHistory(bind(session), className);
}

export function revertClassToVersion(
  session: ActiveSession,
  className: string,
  index: number,
): string {
  return sharedRevertClassToVersion(bind(session), className, index);
}

export function globalNameInUse(session: ActiveSession, name: string): boolean {
  return sharedGlobalNameInUse(bind(session), name);
}

export function isKernelClass(session: ActiveSession, name: string): boolean {
  return sharedIsKernelClass(bind(session), name);
}

export function removeClassVersion(
  session: ActiveSession,
  className: string,
  index: number,
): string {
  return sharedRemoveClassVersion(bind(session), className, index);
}

export function getGrailStubReflection(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): GrailStubReflection {
  return sharedGetGrailStubReflection(bind(session), className, dict);
}

export function getAllSelectors(session: ActiveSession, className: string): string[] {
  return sharedGetAllSelectors(bind(session), className);
}

export function getMethodList(session: ActiveSession, className: string) {
  return sharedGetMethodList(bind(session), className);
}

export function getSourceOffsets(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): number[] {
  return sharedGetSourceOffsets(bind(session), className, isMeta, selector, environmentId, dict);
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
    bind(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function searchMethodSource(session: ActiveSession, term: string, ignoreCase: boolean) {
  return sharedSearchMethodSource(bind(session), term, ignoreCase);
}

export function sendersOf(session: ActiveSession, selector: string, environmentId: number = 0) {
  return sharedSendersOf(bind(session), selector, environmentId);
}

export function implementorsOf(
  session: ActiveSession,
  selector: string,
  environmentId: number = 0,
) {
  return sharedImplementorsOf(bind(session), selector, environmentId);
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
    bind(session),
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
  return sharedReferencesToObject(bind(session), objectName, environmentId);
}

// ── Write-path queries (mutations) ─────────────────────────────────────────
// All of these delegate to the shared layer. None auto-commit.

export function compileClassDefinition(session: ActiveSession, source: string): string {
  return sharedCompileClassDefinition(bind(session), source);
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
    bind(session),
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
  return sharedSetClassComment(bind(session), className, comment, dict);
}

export function recategorizeClass(
  session: ActiveSession,
  className: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeClass(bind(session), className, newCategory, dict);
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
    bind(session),
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
  return sharedDeleteMethod(bind(session), className, isMeta, selector, dict);
}

export function recategorizeMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeMethod(bind(session), className, isMeta, selector, newCategory, dict);
}

export function renameCategory(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  oldCategory: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRenameCategory(bind(session), className, isMeta, oldCategory, newCategory, dict);
}

export function deleteClass(
  session: ActiveSession,
  dict: number | string,
  className: string,
): string {
  return sharedDeleteClass(bind(session), dict, className);
}

export function moveClass(
  session: ActiveSession,
  srcDictIndex: number,
  destDictIndex: number,
  className: string,
): string {
  return sharedMoveClass(bind(session), srcDictIndex, destDictIndex, className);
}

export function reclassifyClass(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  newCategory: string,
): string {
  return sharedReclassifyClass(bind(session), dictIndex, className, newCategory);
}

export function addDictionary(session: ActiveSession, dictName: string): string {
  return sharedAddDictionary(bind(session), dictName);
}

export function removeDictionary(session: ActiveSession, dict: number | string): string {
  return sharedRemoveDictionary(bind(session), dict);
}

export function moveDictionaryUp(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryUp(bind(session), dictIndex);
}

export function moveDictionaryDown(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryDown(bind(session), dictIndex);
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
    bind(session),
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
    bind(session),
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
  return sharedClearAllBreaks(bind(session), className, isMeta, selector, environmentId, dict);
}
