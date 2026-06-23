import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_TRUE, OOP_ILLEGAL, GCI_PERFORM_FLAG_ENABLE_DEBUG } from './gciConstants';
import { logInfo, logError } from './gciLog';
import { runNbCall, NbRunOptions } from './nbRunner';

const MAX_RESULT = 256 * 1024;

// ── Helpers ─────────────────────────────────────────────

function gciPerform(
  session: ActiveSession, receiver: bigint, selector: string, args: bigint[] = [],
): bigint {
  const { result, err } = session.gci.GciTsPerform(
    session.handle, receiver, OOP_ILLEGAL, selector, args, 0, 0,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return result;
}

function gciPerformFetchString(
  session: ActiveSession, receiver: bigint, selector: string, args: bigint[] = [],
): string {
  const { data, err } = session.gci.GciTsPerformFetchBytes(
    session.handle, receiver, selector, args, MAX_RESULT,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return data;
}

function oopToInt(session: ActiveSession, oop: bigint): number {
  const { value, err } = session.gci.GciTsOopToI64(session.handle, oop);
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in OopToI64`);
  }
  return Number(value);
}

function intToOop(session: ActiveSession, n: number): bigint {
  const { result, err } = session.gci.GciTsI64ToOop(session.handle, BigInt(n));
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in I64ToOop`);
  }
  return result;
}

// ── Frame info ──────────────────────────────────────────

export interface FrameInfo {
  methodOop: bigint;
  ipOffset: number;
  receiverOop: bigint;
  argAndTempNames: string[];
  argAndTempOops: bigint[];
}

export interface MethodInfo {
  className: string;
  selector: string;
}

export interface MethodBlockInfo {
  /** True when the frame's method is the compiled method of a block. */
  isBlock: boolean;
  /**
   * Oop of the home (enclosing) method. GsNMethod>>homeMethod returns self for
   * non-block methods, so this is always safe to use for naming. A block
   * method's own inClass/selector are NOT the displayable class/selector
   * (inClass returns the home method), so resolve names from this oop.
   */
  homeMethodOop: bigint;
}

export interface MethodUriInfo {
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
}

/**
 * Returns the number of stack frames in the suspended process.
 */
export function getStackDepth(session: ActiveSession, gsProcess: bigint): number {
  const oop = gciPerform(session, gsProcess, 'localStackDepth');
  return oopToInt(session, oop);
}

/**
 * Returns frame details at the given level (1-based, 1 = top).
 *
 * GsProcess>>_frameContentsAt: returns an Array:
 *   [1] method (GsNMethod)
 *   [2] ipOffset (SmallInteger)
 *   [3..7] internal details
 *   [8] self
 *   [9] argAndTempNames (Array of Strings)
 *   [10] receiver
 *   [11..] arg and temp values
 */
export function getFrameInfo(
  session: ActiveSession, gsProcess: bigint, level: number,
): FrameInfo {
  const levelOop = intToOop(session, level);
  const arrayOop = gciPerform(session, gsProcess, '_frameContentsAt:', [levelOop]);

  // Fetch the size of the returned array
  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, arrayOop);
  if (sizeErr.number !== 0) {
    throw new Error(sizeErr.message || `Cannot fetch array size`);
  }
  const size = Number(sizeRaw);

  // Fetch all OOPs from the array (1-based indexing in GemStone, 0-based in GciTsFetchOops)
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(
    session.handle, arrayOop, 1n, size,
  );
  if (fetchErr.number !== 0) {
    throw new Error(fetchErr.message || `Cannot fetch frame contents`);
  }

  const methodOop = oops[0];     // [1] method
  const ipOffsetOop = oops[1];   // [2] ipOffset
  const receiverOop = oops[9];   // [10] receiver (0-indexed: 9)
  const namesArrayOop = oops[8]; // [9] argAndTempNames (0-indexed: 8)

  const ipOffset = oopToInt(session, ipOffsetOop);

  // Fetch arg and temp names from the names array
  const argAndTempNames: string[] = [];
  if (namesArrayOop !== OOP_NIL) {
    const { result: namesSizeRaw } = session.gci.GciTsFetchSize(
      session.handle, namesArrayOop,
    );
    const namesSize = Number(namesSizeRaw);
    if (namesSize > 0) {
      const { oops: nameOops } = session.gci.GciTsFetchOops(
        session.handle, namesArrayOop, 1n, namesSize,
      );
      for (const nameOop of nameOops) {
        const name = gciPerformFetchString(session, nameOop, 'asString');
        argAndTempNames.push(name);
      }
    }
  }

  // Arg and temp values start at index 10 (0-indexed) = Smalltalk index 11
  const argAndTempOops = oops.slice(10);

  return { methodOop, ipOffset, receiverOop, argAndTempNames, argAndTempOops };
}

/**
 * Returns class name and selector for a method OOP.
 */
export function getMethodInfo(session: ActiveSession, methodOop: bigint): MethodInfo {
  const classOop = gciPerform(session, methodOop, 'inClass');
  const className = gciPerformFetchString(session, classOop, 'name');
  const selector = gciPerformFetchString(session, methodOop, 'selector');
  return { className, selector };
}

/**
 * Reports whether a frame's method is a block method, plus the oop of its home
 * (enclosing) method. Used to render block frames as `[] in Class>>selector`,
 * mirroring GsNMethod>>printOn:. Resolve the displayed class/selector from
 * homeMethodOop, not the block method itself.
 */
export function getMethodBlockInfo(
  session: ActiveSession, methodOop: bigint,
): MethodBlockInfo {
  const isBlock = gciPerform(session, methodOop, 'isMethodForBlock') === OOP_TRUE;
  const homeMethodOop = gciPerform(session, methodOop, 'homeMethod');
  return { isBlock, homeMethodOop };
}

/**
 * Returns everything needed to construct a gemstone:// URI for a method.
 * Uses a single Smalltalk execution to minimise GCI round-trips.
 */
export function getMethodUriInfo(session: ActiveSession, methodOop: bigint): MethodUriInfo | undefined {
  try {
    const { result: classUtf8, err: resErr } = session.gci.GciTsResolveSymbol(
      session.handle, 'Utf8', OOP_NIL,
    );
    if (resErr.number !== 0) return undefined;

    const code = `| method class baseClass dictName category |
method := Object _objectForOop: ${methodOop}.
class := method inClass.
baseClass := class theNonMetaClass.
dictName := ''.
System myUserProfile symbolList do: [:d |
  (d includesKey: baseClass name asSymbol) ifTrue: [dictName := d name]].
category := (class categoryOfSelector: method selector environmentId: 0) ifNil: ['as yet unclassified'].
dictName, String tab,
  baseClass name, String tab,
  (class isMeta ifTrue: ['class'] ifFalse: ['instance']), String tab,
  category, String tab,
  method selector asString`;

    const { data, err } = session.gci.GciTsExecuteFetchBytes(
      session.handle, code, -1, classUtf8, OOP_ILLEGAL, OOP_NIL, 64 * 1024,
    );
    if (err.number !== 0) return undefined;

    const parts = data.split('\t');
    if (parts.length < 5) return undefined;
    return {
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === 'class',
      category: parts[3],
      selector: parts[4],
    };
  } catch {
    return undefined;
  }
}

/**
 * Returns the source code of a method.
 */
export function getMethodSource(session: ActiveSession, methodOop: bigint): string {
  return gciPerformFetchString(session, methodOop, 'sourceString');
}

/**
 * The pieces needed to create the method a `doesNotUnderstand:` is asking for.
 * `className` is the (non-meta) name of the class the method should be added to;
 * `isMeta` is true when the unknown message was sent to a *class* (so a
 * class-side method is wanted). `dictName` is the dictionary that class lives in
 * (for the gemstone:// new-method URI); '' when the class isn't in the user's
 * symbol list. `selector` / `argCount` come straight from the failed send.
 */
export interface DnuInfo {
  className: string;
  isMeta: boolean;
  dictName: string;
  selector: string;
  argCount: number;
}

/**
 * If the suspended process is parked on a `doesNotUnderstand:` (a
 * MessageNotUnderstood), return what's needed to create the missing method;
 * otherwise undefined. Walks the process's frames top-down for the
 * `Object>>doesNotUnderstand: aMessageDescriptor` frame, then reads the receiver
 * and the descriptor (`aMessageDescriptor at: 1` is the selector, `at: 2` the
 * args — see Object>>doesNotUnderstand:). A class receiver means the missing
 * method is class-side.
 *
 * One Smalltalk round-trip (mirrors getMethodUriInfo's execute-and-split shape);
 * returns undefined on any failure so callers degrade to "no Create button".
 */
export function getDoesNotUnderstandInfo(
  session: ActiveSession, gsProcess: bigint,
): DnuInfo | undefined {
  try {
    const { result: classUtf8, err: resErr } = session.gci.GciTsResolveSymbol(
      session.handle, 'Utf8', OOP_NIL,
    );
    if (resErr.number !== 0) return undefined;

    // Walk all frames for the doesNotUnderstand:/_doesNotUnderstand:… machinery
    // (selectors containing 'doesNotUnderstand'). `dnuTop` is the `doesNotUnderstand:`
    // frame (it carries `aMessageDescriptor` — `at: 1` selector, `at: 2` args);
    // `dnuBot` is the deepest such frame, so `dnuBot + 1` is the sender frame that
    // made the failing send (the one to restart). A class receiver ⇒ class-side.
    const code = `| p depth dnuTop dnuBot |
p := Object _objectForOop: ${gsProcess}.
depth := p localStackDepth.
dnuTop := nil. dnuBot := nil.
1 to: depth do: [:i | | m sel |
  m := (p _frameContentsAt: i) at: 1.
  sel := m isNil ifTrue: [nil] ifFalse: [m selector].
  (sel notNil and: [ (sel asString indexOfSubCollection: 'doesNotUnderstand') > 0 ]) ifTrue: [
    dnuTop isNil ifTrue: [ dnuTop := i ].
    dnuBot := i ] ].
dnuTop isNil
  ifTrue: [ '' ]
  ifFalse: [ | arr rcvr descr sel base meta dn |
    arr := p _frameContentsAt: dnuTop.
    rcvr := arr at: 10.
    descr := arr at: 11.
    sel := descr at: 1.
    (rcvr isKindOf: Class)
      ifTrue: [ base := rcvr. meta := true ]
      ifFalse: [ base := rcvr class. meta := false ].
    dn := ''.
    System myUserProfile symbolList do: [:d |
      (d includesKey: base name asSymbol) ifTrue: [ dn := d name ] ].
    base name asString, String tab,
      (meta ifTrue: ['class'] ifFalse: ['instance']), String tab,
      dn, String tab,
      sel asString, String tab,
      (descr at: 2) size printString ]`;

    const { data, err } = session.gci.GciTsExecuteFetchBytes(
      session.handle, code, -1, classUtf8, OOP_ILLEGAL, OOP_NIL, 64 * 1024,
    );
    if (err.number !== 0) return undefined;
    if (data === '') return undefined; // not parked on a doesNotUnderstand:

    const parts = data.split('\t');
    if (parts.length < 5) return undefined;
    const argCount = parseInt(parts[4], 10);
    return {
      className: parts[0],
      isMeta: parts[1] === 'class',
      dictName: parts[2],
      selector: parts[3],
      argCount: Number.isNaN(argCount) ? 0 : argCount,
    };
  } catch {
    return undefined;
  }
}

/**
 * Maps an IP offset to a source line number.
 */
export function getLineForIp(
  session: ActiveSession, methodOop: bigint, ipOffset: number,
): number {
  const ipOop = intToOop(session, ipOffset);
  const lineOop = gciPerform(session, methodOop, '_lineNumberForIp:', [ipOop]);
  return oopToInt(session, lineOop);
}

/**
 * Returns a method's source offsets — GemStone `_sourceOffsets`, a 1-based array
 * where index i holds the source-string character offset of step point i. Mirrors
 * queries.getSourceOffsets but works straight from the method OOP, so it serves
 * executed-code (doit) frames, which have no class>>selector to look up. Returns
 * an empty array on any failure (best-effort; callers fall back to line-level).
 */
export function getSourceOffsetsForMethod(
  session: ActiveSession, methodOop: bigint,
): number[] {
  const arrayOop = gciPerform(session, methodOop, '_sourceOffsets');
  if (arrayOop === OOP_NIL) return [];
  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, arrayOop);
  if (sizeErr.number !== 0) return [];
  const size = Number(sizeRaw);
  if (size <= 0) return [];
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(
    session.handle, arrayOop, 1n, size,
  );
  if (fetchErr.number !== 0) return [];
  return oops.map(oop => oopToInt(session, oop));
}

/**
 * Returns the step point for the frame at the given level (1-based, 1 = top),
 * or undefined when the frame has no step point. Uses GsProcess>>_stepPointAt:,
 * the same primitive the topaz debugger uses — it accounts for native-stack
 * and async-callee frames, which a raw ipOffset→stepPoint mapping would not.
 */
export function getStepPoint(
  session: ActiveSession, gsProcess: bigint, level: number,
): number | undefined {
  const levelOop = intToOop(session, level);
  const resultOop = gciPerform(session, gsProcess, '_stepPointAt:', [levelOop]);
  if (resultOop === OOP_NIL) return undefined;
  return oopToInt(session, resultOop);
}

// ── Variables ───────────────────────────────────────────

/**
 * Returns the printString of an object together with a truncation flag.
 * truncated is true when the GCI fetch hit maxBytes exactly, meaning the
 * full printString is longer than what was returned.
 */
/**
 * Returns the printString of an object limited to maxBytes display characters,
 * together with a truncation flag.
 *
 * Truncation can happen two ways:
 *  1. GemStone's own collection limit fires first (ends with '...' or ', ...)').
 *  2. The GCI byte limit fires (data.length or bytesReturned exceeds maxBytes).
 * We detect both.
 */
export function fetchPrintString(
  session: ActiveSession, oop: bigint, maxBytes: number,
): { value: string; truncated: boolean } {
  try {
    const { bytesReturned, data, err } = session.gci.GciTsPerformFetchBytes(
      session.handle, oop, 'printString', [], maxBytes + 2,
    );
    if (err.number !== 0) return { value: `<error: ${err.message}>`, truncated: false };
    const gciTruncated = data.length > maxBytes || bytesReturned > maxBytes;
    // GemStone appends '...' (optionally followed by ')') when printString hits
    // its own internal collection size cap.
    const gemstoneTruncated = /\.\.\.\s*\)?\s*$/.test(data);
    const truncated = gciTruncated || gemstoneTruncated;
    return { value: gciTruncated ? data.slice(0, maxBytes) : data, truncated };
  } catch {
    return { value: '<error getting printString>', truncated: false };
  }
}

const MAX_FULL_PRINT = 256 * 1024;

/**
 * Returns the full output of printOn: for an object, bypassing GemStone's
 * internal printString size cap.  printString uses a LimitedWriteStream
 * internally; calling printOn: directly with a plain WriteStream has no limit.
 */
export function fetchFullPrintString(session: ActiveSession, oop: bigint): string {
  try {
    const { result: classUtf8, err: classErr } = session.gci.GciTsResolveSymbol(
      session.handle, 'Utf8', OOP_NIL,
    );
    if (classErr.number !== 0) return `<error: cannot resolve Utf8>`;
    const code = `| s |
s := WriteStream on: String new.
(Object _objectForOop: ${oop}) printOn: s.
s contents`;
    const { data, err } = session.gci.GciTsExecuteFetchBytes(
      session.handle, code, -1, classUtf8, OOP_ILLEGAL, OOP_NIL, MAX_FULL_PRINT,
    );
    if (err.number !== 0) return `<error: ${err.message}>`;
    return data;
  } catch {
    return '<error getting full printString>';
  }
}

/**
 * Returns a printString representation of an object (truncated to maxBytes).
 */
export function getObjectPrintString(
  session: ActiveSession, oop: bigint, maxBytes: number = 1024,
): string {
  return fetchPrintString(session, oop, maxBytes).value;
}

/**
 * Returns the class name of an object.
 */
export function getObjectClassName(session: ActiveSession, oop: bigint): string {
  try {
    const classOop = gciPerform(session, oop, 'class');
    return gciPerformFetchString(session, classOop, 'name');
  } catch {
    return '<Unknown>';
  }
}

/**
 * Returns true if the OOP is a special (immediate) value — SmallInteger, Character, etc.
 */
export function isSpecialOop(session: ActiveSession, oop: bigint): boolean {
  return session.gci.GciTsOopIsSpecial(oop);
}

/**
 * Returns named instvar names for an object's class.
 */
export function getInstVarNames(session: ActiveSession, oop: bigint): string[] {
  const classOop = gciPerform(session, oop, 'class');
  const namesArrayOop = gciPerform(session, classOop, 'allInstVarNames');
  const { result: sizeRaw } = session.gci.GciTsFetchSize(session.handle, namesArrayOop);
  const size = Number(sizeRaw);
  const names: string[] = [];
  if (size > 0) {
    const { oops } = session.gci.GciTsFetchOops(session.handle, namesArrayOop, 1n, size);
    for (const nameOop of oops) {
      names.push(gciPerformFetchString(session, nameOop, 'asString'));
    }
  }
  return names;
}

/**
 * Fetches OOPs of named instance variables.
 *
 * Uses absolute GciTsFetchOops rather than GciTsFetchNamedOops (which does not
 * exist in GemStone 3.6.2). Named instance variables are the first slots of an
 * object, so the absolute 1-based index of named var N is simply N.
 */
export function getNamedInstVarOops(
  session: ActiveSession, oop: bigint, count: number,
): bigint[] {
  if (count <= 0) return [];
  const { oops, err } = session.gci.GciTsFetchOops(
    session.handle, oop, 1n, count,
  );
  if (err.number !== 0) return [];
  return oops;
}

/**
 * Returns the varying (indexed) size of an object.
 */
export function getIndexedSize(session: ActiveSession, oop: bigint): number {
  const { result, err } = session.gci.GciTsFetchVaryingSize(session.handle, oop);
  if (err.number !== 0) return 0;
  return Number(result);
}

/**
 * Fetches OOPs of varying (indexed) elements. `startIndex` is 1-based within
 * the varying region.
 *
 * Uses absolute GciTsFetchOops rather than GciTsFetchVaryingOops (which does
 * not exist in GemStone 3.6.2). Varying elements follow the named instance
 * variables, so varying element `startIndex` is at absolute index
 * namedSize + startIndex.
 */
export function getIndexedOops(
  session: ActiveSession, oop: bigint, startIndex: number, count: number,
): bigint[] {
  if (count <= 0) return [];
  const { info, err: infoErr } = session.gci.GciTsFetchObjInfo(
    session.handle, oop, false, 0,
  );
  if (infoErr.number !== 0) return [];
  const { oops, err } = session.gci.GciTsFetchOops(
    session.handle, oop, BigInt(info.namedSize + startIndex), count,
  );
  if (err.number !== 0) return [];
  return oops;
}

/**
 * Returns sorted key-value entries for a SymbolDictionary.
 */
export function getDictionaryEntries(
  session: ActiveSession, oop: bigint,
): { key: string; valueOop: bigint }[] {
  const keysOop = gciPerform(session, oop, 'keys');
  const sortedOop = gciPerform(session, keysOop, 'asSortedCollection');
  const keyArrayOop = gciPerform(session, sortedOop, 'asArray');

  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(
    session.handle, keyArrayOop,
  );
  if (sizeErr.number !== 0) return [];
  const count = Number(sizeRaw);
  if (count === 0) return [];

  const { oops: keyOops, err: fetchErr } = session.gci.GciTsFetchOops(
    session.handle, keyArrayOop, 1n, count,
  );
  if (fetchErr.number !== 0) return [];

  const entries: { key: string; valueOop: bigint }[] = [];
  for (const keyOop of keyOops) {
    const key = gciPerformFetchString(session, keyOop, 'asString');
    const valueOop = gciPerform(session, oop, 'at:', [keyOop]);
    entries.push({ key, valueOop });
  }
  return entries;
}

// ── Stepping ────────────────────────────────────────────

/**
 * Outcome of a step/continue. `completed` means the process ran to completion
 * (not stopped at another step point/error); when it does, `resultOop` is the
 * process's result — for a wrapped doit, the user code's value — which the
 * caller can display (e.g. a halted Display It that the user resumes).
 */
export interface StepResult {
  completed: boolean;
  resultOop?: bigint;
  errorMessage?: string;
  errorContext?: bigint;
  /** GemStone error number when the op stopped on an error (0/undefined otherwise). */
  errorNumber?: number;
}

// ── Native-code toggle for stepping ─────────────────────────────────────────
//
// GemStone cannot single-step or set breakpoints in NATIVE code (error 6014):
// a `halt`/error parks execution in native signal machinery that can't be
// stepped while the gem runs native code (GemNativeCodeEnabled, on by default).
// Setting ANY breakpoint flips the gem to interpreted execution, which makes
// stepping work — this is how topaz steps. So we toggle a breakpoint in a
// benign kernel method as the switch, and clear it once the last debugger for a
// session closes, restoring native-code performance for normal execution.
//
// Ref-counted per session: concurrent debuggers share one toggle — the break is
// set on the first acquire and cleared on the last release. Best-effort:
// failures are logged, not thrown (the debugger still opens; stepping degrades).

/** Benign kernel method whose breakpoint we toggle to disable/enable native code. */
const NATIVE_CODE_TOGGLE = 'GsSshSocket class>>exampleUserId';
const steppingRefs = new Map<number, number>();

function setNativeCodeBreak(session: ActiveSession, on: boolean): void {
  const selector = on ? 'setBreakAtStepPoint:' : 'clearBreakAtStepPoint:';
  const code = `(GsSshSocket class compiledMethodAt: #exampleUserId) ${selector} 1`;
  // sourceOop is the class of the source string (String); contextObject is
  // OOP_ILLEGAL — matching the working GciTsExecute calling convention.
  const { result: strClass, err: resErr } = session.gci.GciTsResolveSymbol(
    session.handle, 'String', OOP_NIL,
  );
  if (resErr.number !== 0) {
    logError(session.id, `[Jasper Debugger] could not resolve String for native-code toggle: ${resErr.message || resErr.number}`);
    return;
  }
  const { err } = session.gci.GciTsExecute(
    session.handle, code, strClass, OOP_ILLEGAL, OOP_NIL, 0, 0,
  );
  if (err.number !== 0) {
    logError(session.id, `[Jasper Debugger] could not ${on ? 'set' : 'clear'} native-code toggle (${NATIVE_CODE_TOGGLE}): ${err.message || err.number}`);
  }
}

/**
 * Disable native code for the session so the debugger can single-step. Sets the
 * benign toggle breakpoint on the first hold for the session. Ref-counted —
 * pair every call with releaseStepping.
 */
export function acquireStepping(session: ActiveSession): void {
  const n = steppingRefs.get(session.id) ?? 0;
  if (n === 0) setNativeCodeBreak(session, true);
  steppingRefs.set(session.id, n + 1);
}

/**
 * Release one stepping hold; restores native code (clears the toggle) once the
 * last debugger for the session closes.
 */
export function releaseStepping(session: ActiveSession): void {
  const n = steppingRefs.get(session.id) ?? 0;
  if (n <= 1) {
    steppingRefs.delete(session.id);
    if (n === 1) setNativeCodeBreak(session, false);
  } else {
    steppingRefs.set(session.id, n - 1);
  }
}

/**
 * Sends a step message (e.g. gciStepOverFromLevel:) to the GsProcess
 * via blocking GciTsPerform. The step message both configures and
 * executes the step — it blocks until the process stops at the next
 * step point, breakpoint, or error.
 */
function performStep(
  session: ActiveSession, gsProcess: bigint, selector: string, args: bigint[],
): StepResult {
  const { result, err } = session.gci.GciTsPerform(
    session.handle, gsProcess, OOP_ILLEGAL, selector, args,
    GCI_PERFORM_FLAG_ENABLE_DEBUG, 0,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
      errorNumber: err.number,
    };
  }
  // gciStep…FromLevel: returns the completion result when the process finishes.
  return { completed: true, resultOop: result };
}

export function stepOver(
  session: ActiveSession, gsProcess: bigint, level: number,
): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepOver from level ${level}`);
  return performStep(session, gsProcess, 'gciStepOverFromLevel:', [levelOop]);
}

export function stepInto(
  session: ActiveSession, gsProcess: bigint, level: number,
): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepInto from level ${level}`);
  return performStep(session, gsProcess, 'gciStepIntoFromLevel:', [levelOop]);
}

export function stepOut(
  session: ActiveSession, gsProcess: bigint, level: number,
): StepResult {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepThru from level ${level}`);
  return performStep(session, gsProcess, 'gciStepThruFromLevel:', [levelOop]);
}

// ── Non-blocking step variants ──────────────────────────
//
// Same step messages as performStep, but issued via GciTsNbPerform and polled to
// completion off the main thread (see nbRunner.ts) so a slow step — crawling
// hidden machinery, or stepping a method that loops — never freezes the whole
// extension host, and can be cancelled. Used by the webview debugger; the DAP
// session keeps the simpler blocking variants (intentionally left alone).

/**
 * Issue a step message non-blocking and resolve with its StepResult. A halt /
 * breakpoint / error stopping the process is a normal outcome (completed=false
 * with errorMessage), NOT a thrown error — only an outright GCI failure rejects.
 */
function performStepNb(
  session: ActiveSession, gsProcess: bigint, selector: string, args: bigint[], opts: NbRunOptions,
): Promise<StepResult> {
  return runNbCall(
    session,
    () => session.gci.GciTsNbPerform(
      session.handle, gsProcess, OOP_ILLEGAL, selector, args, GCI_PERFORM_FLAG_ENABLE_DEBUG, 0,
    ),
    () => {
      const { result, err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        return {
          completed: false,
          errorMessage: err.message || `GemStone error ${err.number}`,
          errorContext: err.context,
          errorNumber: err.number,
        };
      }
      return { completed: true, resultOop: result };
    },
    opts,
  );
}

export function stepOverNb(
  session: ActiveSession, gsProcess: bigint, level: number,
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepOver (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepOverFromLevel:', [levelOop], { title: 'GemStone: stepping over…' });
}

export function stepIntoNb(
  session: ActiveSession, gsProcess: bigint, level: number,
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepInto (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepIntoFromLevel:', [levelOop], { title: 'GemStone: stepping into…' });
}

export function stepThruNb(
  session: ActiveSession, gsProcess: bigint, level: number,
): Promise<StepResult> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepThru (nb) from level ${level}`);
  return performStepNb(session, gsProcess, 'gciStepThruFromLevel:', [levelOop], { title: 'GemStone: stepping through…' });
}

// ── Continue / Terminate ────────────────────────────────

/**
 * Continues execution of a suspended process. This is blocking in GCI,
 * so we use it synchronously (the caller should handle UI responsiveness).
 *
 * Returns true if execution completed normally, false if it hit another error.
 */
export function continueExecution(
  session: ActiveSession, gsProcess: bigint,
): StepResult {
  logInfo(`[Session ${session.id}] Debug: continue`);
  // replaceTopOfStack = OOP_ILLEGAL means "resume as-is, don't touch the top
  // frame's evaluation stack". Per the GciTsContinueWith contract that is also
  // the right value for a normal halt: when the top frame is AbstractException
  // >>signal it auto-replaces TOS with nil (same as AbstractException>>resume).
  //
  // We previously passed OOP_NIL, which *forces* TOS := nil. That happens to be
  // harmless for a halt (top frame is a signal frame), but after an edit-and-
  // continue / restart-frame `trimStackToLevel:` the top frame is a method reset
  // to its FIRST instruction with a fresh, empty evaluation stack — clobbering
  // its TOS with nil corrupts the frame, so continuing it never returns (the gem
  // hangs). OOP_ILLEGAL handles both cases correctly.
  const { result, err } = session.gci.GciTsContinueWith(
    session.handle, gsProcess, OOP_ILLEGAL, null, GCI_PERFORM_FLAG_ENABLE_DEBUG,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
      errorNumber: err.number,
    };
  }
  // On normal completion GciTsContinueWith returns the process's result oop.
  return { completed: true, resultOop: result };
}

/**
 * Clears the stack of a suspended process (aborts it).
 */
export function clearStack(session: ActiveSession, gsProcess: bigint): void {
  logInfo(`[Session ${session.id}] Debug: clearStack`);
  try {
    session.gci.GciTsClearStack(session.handle, gsProcess);
  } catch {
    // Ignore — process may already be gone
  }
}

/**
 * Trims the stack to just below the given level (for restart frame / edit-and-continue).
 */
export function trimStackToLevel(
  session: ActiveSession, gsProcess: bigint, level: number,
): void {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: trimStackToLevel ${level}`);
  gciPerform(session, gsProcess, 'trimStackToLevel:', [levelOop]);
}

/**
 * Non-blocking trimStackToLevel: (restart-frame / edit-and-continue). The public
 * `trimStackToLevel:` evaluates unwind/ensure: blocks with an INFINITE timeout,
 * so a hung unwind block would freeze the host on the blocking path — running it
 * non-blocking (and cancellable) avoids that. Flags 0, matching the blocking
 * variant (no debug-stop during the trim's unwind).
 */
export function trimStackToLevelNb(
  session: ActiveSession, gsProcess: bigint, level: number,
): Promise<void> {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: trimStackToLevel (nb) ${level}`);
  return runNbCall(
    session,
    () => session.gci.GciTsNbPerform(
      session.handle, gsProcess, OOP_ILLEGAL, 'trimStackToLevel:', [levelOop], 0, 0,
    ),
    () => {
      const { err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        throw new Error(err.message || `GemStone error ${err.number} in trimStackToLevel:`);
      }
    },
    { title: 'GemStone: restarting frame…' },
  );
}

// ── Evaluate ────────────────────────────────────────────

/**
 * Evaluates an expression in the context of a stack frame and returns the
 * printString of the result.
 *
 * `self` is always bound to the frame's receiver (so instVars and globals
 * resolve too), via `String>>evaluateInContext:`. When the frame has named
 * arguments/temps, they are *also* bound: a transient `SymbolDictionary`
 * mapping each name → its current value is prepended to the user's symbol list
 * so a bare identifier like `amount` resolves to the frame's temp
 * (`evaluateInContext:symbolList:`). The dictionary shadows globals, while
 * globals still resolve through the appended user list.
 *
 * Limitation: temps are bound for *reads* only — assigning to a temp in the
 * eval bar writes the transient dictionary, not the live frame.
 *
 * (The earlier `_framePerform:withArgs:onLevel:` primitive does NOT exist on
 * GemStone 3.7.x — and it performed a *selector*, not an expression, so it
 * raised a NameError trying to intern the source as a Symbol.)
 */
export function evaluateInFrame(
  session: ActiveSession, gsProcess: bigint, expression: string, level: number,
): string {
  // The frame's receiver becomes `self` for the evaluation.
  const { receiverOop, argAndTempNames, argAndTempOops } = getFrameInfo(session, gsProcess, level);

  const { result: exprOop, err: strErr } = session.gci.GciTsNewString(
    session.handle, expression,
  );
  if (strErr.number !== 0) {
    throw new Error(strErr.message || 'Cannot create expression string');
  }

  // Bind the frame's named args/temps when present; otherwise keep the lean
  // single-arg path (self + instVars + globals via the session's symbol list).
  const symbolListOop = buildFrameSymbolList(session, argAndTempNames, argAndTempOops);
  const resultOop = symbolListOop === null
    ? gciPerform(session, exprOop, 'evaluateInContext:', [receiverOop])
    : gciPerform(session, exprOop, 'evaluateInContext:symbolList:', [receiverOop, symbolListOop]);
  return getObjectPrintString(session, resultOop);
}

/** Resolve a global (e.g. a class name) to its OOP; null if it doesn't resolve. */
function resolveGlobalOop(session: ActiveSession, name: string): bigint | null {
  const { result, err } = session.gci.GciTsResolveSymbol(session.handle, name, OOP_NIL);
  if (err.number !== 0) return null;
  return result;
}

/**
 * Builds a SymbolList whose first entry is a transient SymbolDictionary mapping
 * each *named* (non-synthetic) arg/temp to its current value, prepended to the
 * user's own symbol list — so bare identifiers like `amount` resolve to the
 * frame's temps while globals still resolve through the appended user list.
 * Returns null when the frame has no bindable named temps (the caller then uses
 * the simpler `evaluateInContext:`), or if any of the required globals can't be
 * resolved (degrade to the self-only eval rather than fail).
 *
 * The synthetic `.tN` eval-stack temporaries have no source name (and `.t1`
 * isn't a legal identifier), so they are skipped.
 */
function buildFrameSymbolList(
  session: ActiveSession, names: string[], oops: bigint[],
): bigint | null {
  const bindings: { name: string; oop: bigint }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const oop = oops[i];
    if (!name || name.startsWith('.') || oop === undefined) continue;
    bindings.push({ name, oop });
  }
  if (bindings.length === 0) return null;

  const symDictClass = resolveGlobalOop(session, 'SymbolDictionary');
  const symListClass = resolveGlobalOop(session, 'SymbolList');
  const systemClass = resolveGlobalOop(session, 'System');
  if (symDictClass === null || symListClass === null || systemClass === null) return null;

  const dictOop = gciPerform(session, symDictClass, 'new');
  for (const { name, oop } of bindings) {
    const { result: symOop, err } = session.gci.GciTsNewSymbol(session.handle, name);
    if (err.number !== 0) continue; // skip un-internable names defensively
    gciPerform(session, dictOop, 'at:put:', [symOop, oop]);
  }

  // (SymbolList with: dict) , (System myUserProfile symbolList)
  const profileOop = gciPerform(session, systemClass, 'myUserProfile');
  const userListOop = gciPerform(session, profileOop, 'symbolList');
  const frontOop = gciPerform(session, symListClass, 'with:', [dictOop]);
  return gciPerform(session, frontOop, ',', [userListOop]);
}
