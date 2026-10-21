import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
  toBigInt,
} from './gciConstants';
import { gsStringLiteral as literal } from './serverPlugin/installHelpers';
import { logError, logInfo } from './gciLog';
import { NbCancelledError } from './nbRunner';
import { continueThroughForwarderSends } from './transcriptSink';
import { FRAME_SELF_SMALLTALK } from './debugQueries';
import type { StepResult } from './debugQueries';
import type { GciError } from './gciLibrary';
import { appendLogpoint, showLogpointChannel } from './logpointChannel';
import { skipLiteral } from './smalltalkScan';

/**
 * The rule a breakpoint carries: stop only when a condition holds, stop only
 * once another breakpoint has been reached, write a line to the log and carry
 * on, or any combination of those.
 *
 * **A condition cannot be applied before the stop.** A GemStone method
 * breakpoint always unwinds to the client as error 6005 with the suspended
 * `GsProcess` in `err.context`; a Smalltalk `on: Breakpoint do:` handler is
 * never entered, and neither `GsProcess>>debugActionBlock:` nor
 * `disableDebugging` suppresses it. By the time anyone can evaluate anything,
 * execution has already stopped and the client has already been told. So the
 * work here is deciding, after the fact, whether this particular stop is one the
 * developer asked for — and resuming when it is not.
 *
 * Each skipped hit costs **three** GCI round trips — a `perform:` on a decider
 * block that judges the stop in the suspended frame, a `GciTsFetchOops` to read
 * its verdict, and the `GciTsContinueWith` that resumes — and a hit that logs
 * costs a fourth, to fetch the line. Everything the judgement needs — the
 * receiver, the frame's names and values, the symbol list, the
 * `evaluateInContext:` — happens inside that block rather than as the 15-20
 * separate calls it would take to assemble a frame's variables from here, every
 * one of them scaling with network latency.
 *
 * **Why not do the whole loop inside the gem.** `GsProcess>>_continue` resumes a
 * suspended process and returns control to its *Smalltalk* caller, which would
 * put the entire skip loop in one doit — measured at 198 skips in 12-29 ms
 * against 3.6.2, with the cost no longer scaling with hit count or latency at
 * all. It cannot be used: **3.7.x has no `_continue`**. What is left of that
 * primitive there (`_primContinue:`) is unreachable from a GCI-suspended process
 * — it answers "the Process nil to continue from is invalid" whatever it is
 * handed — and 3.7's in-process resume (`setStepOverBreaksAtLevel:breakpointLevel:`)
 * is documented for a *forked* debuggee that has installed its own `Breakpoint`
 * handler and yields to a debugger process, which a process suspended out of a
 * GCI execute has not. `GciTsContinueWith` is the one resume that behaves the
 * same on both releases, so the loop lives here and pays for the round trips.
 *
 * **The rules hold for the whole run**, not just until the first stop: the
 * debugger's Resume and Run to Cursor come back through
 * {@link honourRulesAfterResume}, so a false condition is still skipped, a
 * logpoint still logs and a trigger stays armed after the debugger opens. Steps
 * are explicit, and are never filtered.
 *
 * The developer's code is never touched either way: not wrapped, not recompiled,
 * its step points untouched. Nothing is written to the repository: the only
 * thing left behind is the decider in the session's own temporaries, under one
 * key that each run overwrites, which is never committed and goes away with the
 * session — the same lifetime as the breakpoints it serves.
 */
export interface BreakpointRule {
  /**
   * Smalltalk expression resolving the compiled method the breakpoint is in —
   * `compiledMethodExpr`'s output. An expression rather than an OOP so no round
   * trip is spent resolving one, and so a method that has since been recompiled
   * or removed fails as "no such spec" instead of matching a stale OOP. The
   * decider compiles it in the gem, inside an error guard, so one that no
   * longer compiles (its class was removed) costs only its own rule.
   */
  methodExpr: string;
  stepPoint: number;
  /**
   * The Smalltalk expression that has to answer true to stop here. Undefined
   * when the rule has no condition: a pure logpoint, or a breakpoint listed only
   * because it is one end of a trigger.
   */
  condition?: string;
  /**
   * What to write to the log each time this breakpoint is reached (and its
   * condition holds), already compiled to a Smalltalk expression answering a
   * String — see `logMessageExpression`. Undefined on a plain breakpoint.
   *
   * A rule with one of these **never stops**: it logs and resumes, which is what
   * makes a logpoint a way of instrumenting a method without editing it.
   */
  logMessage?: string;
  /**
   * How to name this breakpoint's method in a log line — `Account>>deposit:`.
   *
   * Presentation only: the gem is handed `methodExpr`, and this exists so a
   * logpoint's output can say where each line came from without the client
   * spending a round trip to turn an expression back into a class and selector.
   */
  label?: string;
  /**
   * The 1-based index, in this same spec array, of the breakpoint that has to be
   * reached before this one is allowed to stop. Undefined on a breakpoint that
   * is armed from the start, which is almost all of them.
   *
   * An index rather than a method-and-step-point pair because the decider works
   * in indices already: the arming state is one Array parallel to the specs, so
   * a trigger firing is a single at:put: rather than another lookup.
   */
  triggeredBy?: number;
}

/**
 * Where the rules on the currently armed breakpoints come from.
 *
 * Narrowed to the one question asked here so this module does not depend on the
 * whole breakpoint manager — and so a test can answer it with a literal.
 */
export interface BreakpointRuleSource {
  breakpointRulesFor(session: ActiveSession): BreakpointRule[];
}

let ruleSource: BreakpointRuleSource | undefined;

/**
 * Name the source every run consults. The executor registers the breakpoint
 * manager here when it is built, which is how the debugger's Resume reaches the
 * same rules as the run that opened it without depending on either.
 */
export function setBreakpointRuleSource(source: BreakpointRuleSource | undefined): void {
  ruleSource = source;
}

function rulesFor(session: ActiveSession): BreakpointRule[] {
  return ruleSource?.breakpointRulesFor(session) ?? [];
}

/**
 * What came of running a suspended process past every stop its breakpoint rules
 * declined. Each outcome that leaves a process suspended names it in `context`:
 * that is the one the debugger has to open on.
 */
export type ConditionOutcome =
  /** Execution is suspended at a breakpoint that should stop: open the debugger. */
  | { kind: 'stopped'; context: bigint; skipped: number }
  /** The developer asked to stop skipping; suspended at the hit it had reached. */
  | { kind: 'cancelled'; context: bigint; skipped: number }
  /** No breakpoint wanted to stop, and the code ran to completion. */
  | { kind: 'completed'; resultOop: bigint; skipped: number }
  /**
   * The run stopped for something that is not a breakpoint while we were
   * skipping: the developer's code raised, or a soft break (6003) arrived.
   * `errorNumber` is GemStone's own, so a caller can tell the two apart.
   */
  | {
      kind: 'raised';
      description: string;
      errorNumber: number;
      context: bigint;
      skipped: number;
    }
  /** A condition could not be evaluated. */
  | { kind: 'conditionFailed'; message: string; context: bigint; skipped: number };

/**
 * What the decider answers, as SmallIntegers.
 *
 * Integers rather than Symbols so reading the answer back is an OOP-to-integer
 * decode rather than another round trip to fetch a symbol's characters — this
 * runs once per hit, so it is the one thing in the loop worth keeping cheap.
 */
export const DECISION = {
  /** Stop here: the condition held, or this step point has no condition. */
  Stop: 1,
  /** Skip: the condition answered false. */
  Go: 2,
  /** The condition could not be evaluated, so it cannot be honoured. */
  Failed: 3,
  /** Write the answered text to the log, then carry on. Never stops. */
  Log: 4,
  /**
   * The log message could not be evaluated. Reported, then carried on from —
   * a logpoint that cannot say anything is still a logpoint, and hijacking the
   * run into a debugger the developer did not ask for is the wrong answer to a
   * typo in a message.
   */
  LogFailed: 5,
} as const;

/** GemStone's "method breakpoint encountered". */
export const BREAKPOINT_ERROR = 6005;

/**
 * GemStone's "a soft break was received". Only ever the developer's Cancel, so
 * a skip it interrupts is a cancelled skip, not a failed one.
 */
export const SOFT_BREAK_ERROR = 6003;

/**
 * Resumed execution stays interpreted and debuggable, the same flags the
 * debugger's own Resume uses (see `debugQueries`): GemStone cannot step native
 * code, and dropping the debug flag would disarm every remaining breakpoint in
 * the run.
 */
export const CONTINUE_FLAGS = GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED;

/**
 * How many characters of a log line or a condition's error are read back. Cut
 * in the gem, by characters, so a long non-ASCII line is never split inside a
 * character, and marked with `...` so a cut line does not pass for a whole one.
 */
const MAX_MESSAGE_CHARS = 4096;

/** Room for `MAX_MESSAGE_CHARS` characters of UTF-8 and the cut marker. */
const MAX_MESSAGE_BYTES = MAX_MESSAGE_CHARS * 4 + 16;

/** How long a skip runs before it is worth telling the developer about. */
const PROGRESS_AFTER_MS = 1500;

/**
 * How long the loop may hold the event loop before yielding a macrotask, and
 * how often the progress notification is updated.
 *
 * The resume settles from a worker thread's callback, which gives timers a turn
 * already, but the loop does not rely on how the resume settles: a promise that
 * arrives already resolved drains only the *microtask* queue, and a loop of
 * thousands of hits would then starve `setTimeout` outright — the progress
 * notification never appears, cancellation never runs, and the editor sits still
 * for the whole run with no way out of it. Yielding on elapsed time rather than
 * every N hits keeps the cost proportional however fast or slow a hit turns out
 * to be: about one timer's minimum delay per 25 ms of work.
 */
const YIELD_EVERY_MS = 25;

/** Let pending timers — the progress notification, and its Cancel — run. */
function yieldToTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A Smalltalk expression answering the developer's `text` as a Unicode string,
 * for the decider's own source, which has to stay ASCII.
 *
 * ASCII text is an ordinary literal. Anything else is spelled out as code points
 * and built in the gem: a condition like `name = 'café'` written as a literal
 * broke the 3.6.x compiler on the WHOLE decider ("ComStrmSetCursor: new cursor
 * out of range"), so one accented letter in one condition failed every
 * breakpoint rule in the session. Answered as a Unicode string either way, so
 * `evaluateInContext:` compiles the condition exactly as a workspace would
 * compile the same text — the same literal classes, the same comparisons.
 */
function developerText(text: string): string {
  const codePoints = [...text].map((c) => c.codePointAt(0) as number);
  if (codePoints.every((cp) => cp < 128)) return literal(text);
  return (
    `((String withAll: (#(${codePoints.join(' ')}) collect: [:c | Character codePoint: c])) ` +
    `asUnicodeString)`
  );
}

/**
 * Where the `}` that closes the placeholder opened at `open` is, or -1.
 *
 * Read the way Smalltalk reads it, because a placeholder is Smalltalk: a brace
 * array (`{a. b}`) nests, and a `}` inside a string literal, a comment or a
 * character literal (`$}`) closes nothing.
 */
function closingBrace(message: string, open: number): number {
  let depth = 0;
  for (let i = open + 1; i < message.length;) {
    const quoted = skipLiteral(message, i);
    if (quoted) {
      i = quoted.end;
      continue;
    }
    if (message[i] === '{') depth += 1;
    else if (message[i] === '}') {
      if (depth === 0) return i;
      depth -= 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Compile a logpoint's message into one Smalltalk expression answering a String.
 *
 * The message is plain text with `{…}` placeholders, as VS Code writes them.
 * Text outside the braces is literal; what is inside is an expression evaluated
 * in the suspended frame, with the same names in scope a condition gets — the
 * method's arguments and temporaries, a block's own variables, `self`, instance
 * and class variables, and the symbol list.
 *
 * The whole message becomes **one** expression rather than one per placeholder,
 * so a message with six of them costs the same single evaluation and single
 * string fetch as a message with one.
 *
 * Each placeholder is wrapped in `printString`, so `{each}` is written rather
 * than `{each printString}`. GemStone has no `displayString`, so a String logs
 * with its quotes — `'demo'` rather than `demo` — which is at least unambiguous.
 * A placeholder is one expression, not a sequence of statements.
 *
 * An unclosed `{` is treated as literal text: a message is prose, and refusing
 * to log because a brace was left open would be worse than logging the brace.
 */
export function logMessageExpression(message: string): string {
  const parts: string[] = [];
  let rest = message;

  while (rest.length > 0) {
    const open = rest.indexOf('{');
    if (open === -1) break;
    const close = closingBrace(rest, open);
    if (close === -1) break; // unclosed — the remainder is literal

    if (open > 0) parts.push(literal(rest.slice(0, open)));
    const expression = rest.slice(open + 1, close).trim();
    // `{}` says nothing; treat it as the literal braces rather than compiling
    // an empty expression, which would not compile at all.
    if (expression === '') parts.push(literal('{}'));
    else parts.push(`(${expression}) printString`);
    rest = rest.slice(close + 1);
  }
  if (rest.length > 0) parts.push(literal(rest));

  // A message that is entirely literal, or empty, still has to answer a String.
  if (parts.length === 0) return literal('');
  return parts.join(', ');
}

/**
 * The key the current run's decider is parked under, in the session's
 * temporaries.
 *
 * `SessionTemps` is per-session VM state, exactly like the breakpoints this
 * serves: it is never committed, is invisible to every other session, and goes
 * away at logout. It is also what keeps the decider alive between the
 * `perform:`s that use it — a GCI result is not otherwise pinned. One key, so a
 * session holds one run's decider however many runs it makes.
 */
const DECIDER_KEY = 'JasperConditionalBreakpointDecider';

/**
 * A doit that compiles the decision logic for one run and answers the block.
 *
 * Compiled once and then performed, rather than sent as a doit per hit, because
 * the source below is several KB and GemStone compiles a doit every time it is
 * executed: measured against a live stone, a ~1.2 KB doit that does no work at
 * all costs 0.21 ms, while a `perform:` on an already-compiled block costs
 * 0.048 ms. The developer's condition and log message are still compiled on
 * every hit, by `evaluateInContext:` — the price of never touching their method.
 *
 * The specs are baked in rather than passed per call, and the block needs no
 * argument but the process. Each spec's method is resolved by compiling its
 * expression in the gem, inside the error guard: a method whose class has since
 * been removed then costs its own rule (it matches nothing, so that breakpoint
 * simply stops), where a bare class name in this source would fail to compile
 * the whole decider and every rule with it.
 *
 * **Every stop is re-identified from its own frame.** A resume can land on a
 * *different* breakpoint — another condition, or none at all — so the block
 * looks up which spec, if any, claims the step point it actually stopped at. A
 * stop that matches none is an unconditional breakpoint (or a `halt`) and
 * answers Stop, which is what keeps a plain breakpoint working while a
 * conditional one is being skipped, and what lets several conditional
 * breakpoints be armed at once with each judged on its own condition.
 *
 * **Triggers are an Array of flags the block closes over**, parallel to the
 * specs: a breakpoint waiting on another starts false and is skipped like a
 * false condition until the breakpoint it names is reached. Arming is one
 * `at:put:`, not a round trip, and the arm necessarily happens before anything
 * downstream can be reached, since both the trigger and the thing it arms are
 * judged in the same gem in execution order.
 *
 * **The flags last for the run, not for one call.** The run's process, specs
 * and flags are parked together under {@link DECIDER_KEY}. When the debugger
 * resumes that same process, the decider is rebuilt from whatever the rules are
 * now — the developer may have edited one while stopped — and every breakpoint
 * that is still the same breakpoint waiting on the same trigger keeps the flag
 * it had. So a trigger that stopped the run has still armed what waits on it
 * when Resume is pressed. A different process is a different run, and starts
 * from the specs' own flags.
 *
 * The receiver and names a condition sees are the debugger's: `self` is the
 * frame's self as {@link FRAME_SELF_SMALLTALK} recovers it — the receiver a
 * block captured, else the home activation's — and the names are the home
 * method's arguments and temporaries overlaid with the block's own, as the eval
 * bar binds them. A block that captured `self` is judged against the receiver
 * that made it even when a deeper activation of the same method is on the stack.
 *
 * Written without `^`: a non-local return from a block whose home doit has
 * already finished is an error, so each exit assigns `answerArray` and the
 * steps after it are guarded on its being nil. Kept ASCII, comments included:
 * the 3.6 compiler fails on anything else.
 */
export function deciderSource(specs: BreakpointRule[], processOop: bigint): string {
  const specLines = specs
    .map(
      (spec) =>
        `specs add: (Array with: ([ ${developerText(spec.methodExpr)} evaluate ] on: Error do: [:ex | nil ]) ` +
        `with: ${spec.stepPoint} ` +
        `with: ${spec.condition === undefined ? 'nil' : developerText(spec.condition)} ` +
        `with: ${spec.logMessage === undefined ? 'nil' : developerText(spec.logMessage)} ` +
        // The fifth slot is the trigger's index, 0 for "armed from the start".
        // `Array with:` takes five on both 3.6.2 and 3.7.
        `with: ${spec.triggeredBy ?? 0}).`,
    )
    .join('\n');

  return `| proc specs armed old oldSpecs entry decider homeFrameOf frameSelfOf |
proc := Object _objectForOop: ${processOop}.
${FRAME_SELF_SMALLTALK}
specs := Array new.
${specLines}
armed := specs collect: [:s | (s at: 5) = 0].
"Carry the flags over from this process's previous decider: a breakpoint that is
 the same step point, waiting on the same step point, keeps its arming."
old := SessionTemps current at: #'${DECIDER_KEY}' otherwise: nil.
(old notNil and: [ (old at: 1) == proc ]) ifTrue: [
  oldSpecs := old at: 3.
  1 to: specs size do: [:k | | s t |
    s := specs at: k.
    ((s at: 5) > 0 and: [ (s at: 1) notNil ]) ifTrue: [
      t := specs at: (s at: 5).
      1 to: oldSpecs size do: [:j | | os ot |
        os := oldSpecs at: j.
        (((os at: 1) == (s at: 1) and: [ (os at: 2) = (s at: 2) ]) and: [ (os at: 5) > 0 ]) ifTrue: [
          ot := oldSpecs at: (os at: 5).
          ((ot at: 1) == (t at: 1) and: [ (ot at: 2) = (t at: 2) ])
            ifTrue: [ armed at: k put: ((old at: 4) at: j) ] ] ] ] ] ].
entry := Array with: proc with: nil with: specs with: armed.
decider := [:p | | answerArray fc frameMethod home sp spec idx rcvr fetch depth hArr dict bind sl answer |
  entry at: 1 put: p.
  answerArray := nil.
  idx := 0.
  fc := p _frameContentsAt: 1.
  fc isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ].
  answerArray isNil ifTrue: [
    frameMethod := fc at: 1.
    home := frameMethod isMethodForBlock
              ifTrue: [ frameMethod homeMethod ]
              ifFalse: [ frameMethod ].
    sp := p _stepPointAt: 1.
    "The index, not just the spec: a log line has to name which logpoint wrote
     it, and this is the only place that knows which one matched."
    1 to: specs size do: [:k |
      (idx = 0 and: [ (((specs at: k) at: 1) == home) and: [ ((specs at: k) at: 2) = sp ] ])
        ifTrue: [ idx := k ] ].
    spec := idx = 0 ifTrue: [ nil ] ifFalse: [ specs at: idx ].
    spec isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ].
    "A breakpoint still waiting on its trigger is skipped exactly as a false
     condition is, and arms nothing on the way past."
    (answerArray isNil and: [ (armed at: idx) not ])
      ifTrue: [ answerArray := Array with: ${DECISION.Go} with: nil ] ].
  answerArray isNil ifTrue: [
    fetch := [:j | [ p _frameContentsAt: j ] on: Error do: [:e | nil ] ].
    depth := p localStackDepth.
    rcvr := (frameSelfOf value: fetch value: 1 value: fc value: depth)
              ifNil: [ (fc at: 7) isNil ifTrue: [ fc at: 10 ] ifFalse: [ nil ] ].
    hArr := homeFrameOf value: fetch value: 1 value: fc value: depth.
    dict := SymbolDictionary new.
    bind := [:a | (a at: 9) ifNotNil: [:names |
      1 to: names size do: [:k | | nm |
        nm := (names at: k) asString.
        ((nm isEmpty or: [ (nm at: 1) == $. ]) or: [ (10 + k) > a size ])
          ifFalse: [ dict at: nm asSymbol put: (a at: 10 + k) ] ] ] ].
    hArr ifNotNil: [:h | bind value: h ].
    bind value: fc.
    sl := (SymbolList with: dict), System myUserProfile symbolList.
    "A rule with no condition always applies; one with a condition has to answer
     true, and anything that is not a Boolean is a mistake worth reporting
     rather than a quiet no."
    (spec at: 3) ifNotNil: [
      answer := [ (spec at: 3) evaluateInContext: rcvr symbolList: sl ]
                  on: Error
                  do: [:ex |
                    answerArray := Array with: ${DECISION.Failed}
                                         with: (ex messageText ifNil: [ ex class name asString ]).
                    nil ].
      answerArray isNil ifTrue: [
        (answer == true or: [ answer == false ])
          ifFalse: [
            answerArray := Array with: ${DECISION.Failed}
                                 with: ('the condition answered ',
                                        ([ answer printString ] on: Error do: [:ex | answer class name asString ]),
                                        ', not true or false') ]
          ifTrue: [ answer ifFalse: [ answerArray := Array with: ${DECISION.Go} with: nil ] ] ] ].
    "Here the rule applies, so this breakpoint counts as reached and anything
     waiting on it is armed from now on - before deciding what to do about this
     stop, so a trigger that stops the run has already armed its dependents."
    answerArray isNil ifTrue: [
      1 to: specs size do: [:k |
        (((specs at: k) at: 5) = idx) ifTrue: [ armed at: k put: true ] ] ].
    answerArray isNil ifTrue: [
      (spec at: 4)
        ifNil: [ answerArray := Array with: ${DECISION.Stop} with: nil ]
        ifNotNil: [ | text |
          text := [ ((spec at: 4) evaluateInContext: rcvr symbolList: sl) ]
                    on: Error
                    do: [:ex |
                      answerArray := Array with: ${DECISION.LogFailed}
                                           with: (ex messageText ifNil: [ ex class name asString ]).
                      nil ].
          answerArray isNil ifTrue: [
            answerArray := Array with: ${DECISION.Log}
                                 with: ([ text asString ] on: Error do: [:ex | text printString ]) ] ] ] ].
  "Cut by characters, then sent as UTF-8, which is how the client decodes it."
  (answerArray at: 2) ifNotNil: [:m | | t |
    t := m.
    t size > ${MAX_MESSAGE_CHARS} ifTrue: [ t := (t copyFrom: 1 to: ${MAX_MESSAGE_CHARS}), '...' ].
    answerArray at: 2 put: t encodeAsUTF8 ].
  answerArray , (Array with: idx) ].
entry at: 2 put: decider.
SessionTemps current at: #'${DECIDER_KEY}' put: entry.
decider`;
}

/** One stop's verdict, as the loop reads it. */
export type Decision =
  | { kind: 'stop' }
  | { kind: 'go' }
  /** `rule` is the index into the rules the decider was built with, 1-based. */
  | { kind: 'log'; text: string; rule: number }
  /** A logpoint whose message would not evaluate. Reported, never stopped at. */
  | { kind: 'logFailed'; message: string; rule: number }
  | { kind: 'failed'; message: string };

/**
 * Read the decider's `{ decision. message. rule index }` back.
 *
 * An unrecognised decision is read as a stop: the process really is suspended at
 * a breakpoint, so opening the debugger on it is both true and the reading that
 * loses nothing.
 */
export function decodeDecision(decision: number, message: string, rule = 0): Decision {
  switch (decision) {
    case DECISION.Go:
      return { kind: 'go' };
    case DECISION.Log:
      return { kind: 'log', text: message, rule };
    case DECISION.LogFailed:
      return { kind: 'logFailed', message, rule };
    case DECISION.Failed:
      return { kind: 'failed', message };
    default:
      return { kind: 'stop' };
  }
}

/** A GCI call of ours that failed, keeping GemStone's error number. */
class DeciderError extends Error {
  constructor(
    message: string,
    readonly errorNumber: number,
  ) {
    super(message);
  }
}

/**
 * Release a process one of our own calls left suspended. The decider runs in a
 * process of its own, never the developer's, so whatever stopped it — a soft or
 * hard break, an error — leaves nothing anyone will resume.
 */
function releaseProcess(session: ActiveSession, context: number | bigint | undefined): void {
  if (context === undefined) return;
  const process = toBigInt(context);
  if (process === 0n || process === OOP_NIL) return;
  try {
    session.GciTsClearStack(process);
  } catch (e) {
    logError(session.id, `Could not release a stopped process: ${errorText(e)}`);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compile this run's decider and answer the block. One doit per run or Resume. */
function installDecider(session: ActiveSession, specs: BreakpointRule[], process: bigint): bigint {
  const { result, err } = session.GciTsExecute(
    deciderSource(specs, process),
    session.utf8ClassOop(),
    OOP_ILLEGAL,
    OOP_NIL,
    0, // debug OFF: the decider must not break on the breakpoints it is judging
    0,
  );
  if (err.number !== 0) {
    releaseProcess(session, err.context);
    throw new DeciderError(err.message || `GemStone error ${err.number}`, err.number);
  }
  return result;
}

/**
 * Ask the compiled decider what to do about the stop `process` is parked at.
 *
 * A `perform:` rather than a doit, so the decider itself is not recompiled per
 * hit, and on a worker thread, because what it evaluates is the developer's: a
 * condition that loops or crawls must leave VS Code responsive, and a soft
 * break from Cancel must be able to reach it.
 */
async function decideWith(
  session: ActiveSession,
  decider: bigint,
  process: bigint,
): Promise<Decision> {
  const { result: arrayOop, err } = await session.GciTsPerformAsync(
    decider,
    OOP_ILLEGAL,
    'value:',
    [process],
    0,
    0,
  );
  if (err.number !== 0) {
    releaseProcess(session, err.context);
    throw new DeciderError(err.message || `GemStone error ${err.number}`, err.number);
  }

  // Three slots in one fetch: the decision, its message, and which rule matched.
  const { oops, err: fetchErr } = session.GciTsFetchOops(arrayOop, 1n, 3);
  if (fetchErr.number !== 0) {
    throw new DeciderError(
      fetchErr.message || `GemStone error ${fetchErr.number}`,
      fetchErr.number,
    );
  }
  const decision = Number(session.oopToInteger(oops[0]));
  const rule = Number(session.oopToInteger(oops[2]));

  let message = '';
  const carriesText =
    decision === DECISION.Failed || decision === DECISION.Log || decision === DECISION.LogFailed;
  if (carriesText && oops[1] !== OOP_NIL) {
    const fetched = session.GciTsFetchChars(oops[1], 1n, MAX_MESSAGE_BYTES);
    if (fetched.err.number === 0) message = fetched.data;
    else logError(session.id, fetched.err.message || `GCI error ${fetched.err.number}`);
  }
  return decodeDecision(decision, message, rule);
}

/** What a caller can hand the skip loop. */
export interface RuleRunOptions {
  onLog?: (text: string, rule: BreakpointRule | undefined) => void;
  /**
   * A logpoint whose message would not evaluate, reported **once per rule** —
   * the message is wrong for every hit, and a thousand identical complaints
   * would bury the run's real output.
   */
  onLogFailure?: (message: string, rule: BreakpointRule | undefined) => void;
  /**
   * Transcript text the resumed run wrote. In clientForwarder mode each write
   * stops the run as error 2336 and has to be shown and resumed, exactly as
   * `settleNbResult` does before the first breakpoint; without this the text is
   * dropped but the run still carries on.
   */
  onTranscript?: (text: string) => void;
  /**
   * A hard break from the runner the loop is part of: the caller has already
   * given up on the run, so the loop releases the process and stops.
   */
  signal?: AbortSignal;
  /**
   * Handed the loop's cancel, for a caller with a Cancel of its own (the
   * debugger's busy overlay). The same thing the notification's Cancel does.
   */
  onStart?: (cancel: () => void) => void;
  /** Skip the loop's own progress notification; see `onStart`. */
  suppressNotification?: boolean;
}

/**
 * Resume `processOop` past every stop its rules decline — a false condition, a
 * logpoint, a trigger not yet reached — and answer where it ended up.
 *
 * Every GCI call that runs the developer's code — the resume and the judgement
 * — runs on a worker thread, so a long run of skipped hits, or a slow
 * condition, leaves VS Code responsive. Past `PROGRESS_AFTER_MS` a cancellable
 * notification appears. Cancel sends a soft break if one of those calls is
 * running, and otherwise stops at the hit the run has reached, which is a real
 * place to be — the process is suspended at a breakpoint either way. A soft
 * break that lands in the resumed code comes back as a `raised` 6003, exactly
 * as a soft break anywhere else in a run does.
 */
export async function applyBreakpointRules(
  session: ActiveSession,
  processOop: bigint,
  specs: BreakpointRule[],
  options: RuleRunOptions = {},
): Promise<ConditionOutcome> {
  const { onLog, onLogFailure, onTranscript, signal } = options;
  const decider = installDecider(session, specs, processOop);
  let process = processOop;
  let skipped = 0;
  let logged = 0;
  const reportedBadLog = new Set<number>();
  let lastYield = Date.now();
  let cancelled = false;
  let calling = false;
  let report: (() => void) | undefined;
  let closeProgress: (() => void) | undefined;

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (!calling) return;
    try {
      session.GciTsBreak(false);
    } catch (e) {
      logError(session.id, `Could not send a soft break: ${errorText(e)}`);
    }
  };
  options.onStart?.(cancel);

  // The hard break has already rejected the run, so nobody else will release
  // what it stopped.
  const abandon = (): never => {
    releaseProcess(session, process);
    throw new NbCancelledError();
  };

  const progressTimer = options.suppressNotification
    ? undefined
    : setTimeout(() => {
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'GemStone: applying breakpoint rules',
            cancellable: true,
          },
          (progress, token) =>
            new Promise<void>((resolve) => {
              closeProgress = resolve;
              report = () =>
                progress.report({
                  message:
                    logged > 0
                      ? `${skipped - logged} skipped, ${logged} logged`
                      : `${skipped} skipped`,
                });
              report();
              token.onCancellationRequested(cancel);
            }),
        );
      }, PROGRESS_AFTER_MS);

  try {
    for (;;) {
      if (signal?.aborted) abandon();
      let decision: Decision;
      calling = true;
      try {
        decision = await decideWith(session, decider, process);
      } catch (e) {
        if (signal?.aborted) abandon();
        // A soft break that landed in the judgement stopped only the decider's
        // own process; the run is still suspended at this hit.
        if (cancelled || (e instanceof DeciderError && e.errorNumber === SOFT_BREAK_ERROR)) {
          return { kind: 'cancelled', context: process, skipped };
        }
        throw e;
      } finally {
        calling = false;
      }

      if (decision.kind === 'stop') return { kind: 'stopped', context: process, skipped };
      if (decision.kind === 'failed') {
        return { kind: 'conditionFailed', message: decision.message, context: process, skipped };
      }
      // A logpoint writes its line and carries on. It never stops, which is the
      // whole point: it instruments a method without editing it.
      if (decision.kind === 'log') {
        onLog?.(decision.text, specs[decision.rule - 1]);
      }
      // …and a logpoint whose message is broken carries on too. Stopping would
      // drop the developer into a debugger they did not ask for, over a typo in
      // a message, and take the run with it.
      if (decision.kind === 'logFailed' && !reportedBadLog.has(decision.rule)) {
        reportedBadLog.add(decision.rule);
        onLogFailure?.(decision.message, specs[decision.rule - 1]);
      }
      if (signal?.aborted) abandon();
      if (cancelled) return { kind: 'cancelled', context: process, skipped };

      let resumed: { result: bigint; err: GciError };
      calling = true;
      try {
        resumed = await continueThroughForwarderSends(
          session,
          await session.GciTsContinueWithAsync(
            process,
            // Resume as-is rather than forcing the top of stack to nil — see
            // `continueExecution` in debugQueries for why that distinction matters.
            OOP_ILLEGAL,
            null,
            CONTINUE_FLAGS,
          ),
          (text) => onTranscript?.(text),
          CONTINUE_FLAGS,
          signal,
        );
      } finally {
        calling = false;
      }
      // Whatever the break stopped has been released by the forwarder loop.
      if (signal?.aborted) throw new NbCancelledError();
      skipped += 1;
      if (decision.kind === 'log' || decision.kind === 'logFailed') logged += 1;

      if (Date.now() - lastYield >= YIELD_EVERY_MS) {
        report?.();
        await yieldToTimers();
        lastYield = Date.now();
      }

      const { result, err } = resumed;
      if (err.number === 0) return { kind: 'completed', resultOop: result, skipped };
      const next = toBigInt(err.context ?? 0n);
      if (err.number !== BREAKPOINT_ERROR) {
        // The developer's own code raised, or execution stopped for some other
        // reason. Either way that is the thing worth showing.
        return {
          kind: 'raised',
          description: err.message || `GemStone error ${err.number}`,
          errorNumber: err.number,
          context: next,
          skipped,
        };
      }
      if (next !== 0n && next !== OOP_NIL) process = next;
    }
  } finally {
    clearTimeout(progressTimer);
    closeProgress?.();
  }
}

/**
 * Where a logpoint line came from, for the log's own prefix.
 *
 * `Account>>deposit: @4`. Falls back to the method expression the gem was handed
 * if a rule reached here without a label — not a shape the manager produces, but
 * a line naming its source awkwardly beats one naming nothing.
 */
function describeRule(rule: BreakpointRule): string {
  return `${rule.label ?? rule.methodExpr} @${rule.stepPoint}`;
}

/** How a stop at a breakpoint resolved once its rules had been applied. */
export type BreakpointStop =
  | { kind: 'completed'; resultOop: bigint }
  /**
   * Suspended at `context`, for the debugger. `cancelled` when the developer
   * asked to stop skipping, so a caller that treats a cancel differently from a
   * stop (a SUnit run reports it as cancelled) can tell.
   */
  | {
      kind: 'stopped';
      message: string;
      context: bigint;
      errorNumber: number;
      cancelled?: boolean;
    };

/**
 * Decide whether the breakpoint `context` is stopped at is one the developer
 * asked to stop at, resuming past every one they did not, and say where the run
 * ended up.
 *
 * Costs nothing when no breakpoint carries a rule, which is the ordinary case:
 * the rules are read from what is already applied, and an empty list short
 * circuits before any GCI call.
 *
 * Throws `NbCancelledError` on a hard break, and a plain Error when there is
 * nothing left to debug — the session logged out, or the run stopped somewhere
 * with no process to open a debugger on.
 */
export async function resolveBreakpointStop(
  session: ActiveSession,
  context: bigint,
  message: string,
  options: Omit<RuleRunOptions, 'onLog' | 'onLogFailure'> = {},
): Promise<BreakpointStop> {
  const stopHere = {
    kind: 'stopped' as const,
    message,
    context,
    errorNumber: BREAKPOINT_ERROR,
  };
  const specs = rulesFor(session);
  // Logged even when there are none. "Stopped at a breakpoint" looks identical
  // whether a condition was consulted and held, or was never seen at all — so
  // the one place that knows says which, rather than leaving it to be guessed
  // from the outside.
  logInfo(
    `[Session ${session.id}] breakpoint at a stop: ${specs.length} breakpoint rule(s) armed` +
      specs
        .map(
          (s) =>
            `\n  ${s.methodExpr} @${s.stepPoint}` +
            (s.condition === undefined ? '' : ` if ${s.condition}`) +
            (s.logMessage === undefined ? '' : ' (logpoint)'),
        )
        .join(''),
  );
  if (specs.length === 0) return stopHere;

  let outcome: ConditionOutcome;
  try {
    // Revealed once per run, on the first line. A logpoint writing to a
    // channel nobody has opened is barely better than no logpoint at all —
    // but reopening it on every line would fight the developer for focus.
    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      showLogpointChannel();
    };
    outcome = await applyBreakpointRules(session, context, specs, {
      ...options,
      onLog: (text, rule) => {
        appendLogpoint(rule === undefined ? `session ${session.id}` : describeRule(rule), text);
        reveal();
      },
      onLogFailure: (failure, rule) => {
        // Into the log the lines would have gone to, where the developer is
        // already looking, and said once out loud — a logpoint that silently
        // writes nothing is the failure this whole feature exists to avoid.
        appendLogpoint(
          rule === undefined ? `session ${session.id}` : describeRule(rule),
          `!! the log message could not be evaluated: ${failure}`,
        );
        reveal();
        vscode.window.showWarningMessage(
          `A logpoint's message could not be evaluated: ${failure}. Execution carried on; ` +
            'see the GemStone Logpoints panel in Output.',
        );
      },
    });
  } catch (e: unknown) {
    // A cancel is the developer's answer, not a failure: let it unwind the
    // execution the same way cancelling any other run does.
    if (e instanceof NbCancelledError) throw e;
    // With the session gone there is no breakpoint left to stop at, and no
    // debugger to offer.
    if (session.isLoggedOut()) throw new Error('The GemStone session is logged out.', { cause: e });
    // Anything else, and the breakpoint still happened. Falling back to
    // stopping is the safe end of the trade: a breakpoint that stops when it
    // should not have is a nuisance, one that silently does not is a bug hunt.
    const detail = errorText(e);
    logError(session.id, `breakpoint rules could not be evaluated: ${detail}`);
    vscode.window.showWarningMessage(
      `Could not evaluate the breakpoint rules (${detail}) — stopping at the breakpoint.`,
    );
    return stopHere;
  }

  logInfo(
    `[Session ${session.id}] breakpoint rules: ${outcome.kind} after ${outcome.skipped} skipped hit(s)`,
  );

  switch (outcome.kind) {
    case 'completed':
      return { kind: 'completed', resultOop: outcome.resultOop };
    case 'raised':
      // The run stopped for something that is not a breakpoint while we were
      // skipping. That is the thing worth showing, on the process it stopped.
      if (outcome.context === 0n || outcome.context === OOP_NIL) {
        throw new Error(outcome.description);
      }
      return {
        kind: 'stopped',
        message: outcome.description,
        context: outcome.context,
        errorNumber: outcome.errorNumber,
      };
    case 'cancelled':
      return {
        ...stopHere,
        message: `${message} (cancelled while applying breakpoint rules)`,
        context: outcome.context,
        cancelled: true,
      };
    case 'conditionFailed':
      // Said out loud, because the alternative is a breakpoint that stops for
      // no visible reason and a condition that was never really applied.
      vscode.window.showWarningMessage(
        `Breakpoint condition could not be evaluated: ${outcome.message} — ` +
          'stopping at the breakpoint.',
      );
      return {
        ...stopHere,
        message: `${message} (condition: ${outcome.message})`,
        context: outcome.context,
      };
    default:
      return { ...stopHere, context: outcome.context };
  }
}

/**
 * Whether a debugger Resume that answered `result` stopped at a breakpoint the
 * rules may want to pass — the one case {@link honourRulesAfterResume} has
 * anything to do. Lets a caller keep its ordinary, synchronous path for every
 * other stop.
 */
export function resumeNeedsRules(session: ActiveSession, result: StepResult): boolean {
  if (result.completed || result.errorNumber !== BREAKPOINT_ERROR) return false;
  const context = toBigInt(result.errorContext ?? 0n);
  if (context === 0n || context === OOP_NIL) return false;
  return rulesFor(session).length > 0;
}

/**
 * Carry a debugger Resume on past every stop its rules decline, from the stop
 * `result` reports, and answer it in the debugger's own terms.
 *
 * The same rule application as the run's first stop, with the same decider —
 * see `deciderSource` — so a trigger armed before the debugger opened is still
 * armed. Only for a Resume (and Run to Cursor): a step is explicit and goes
 * where it was told.
 */
export async function honourRulesAfterResume(
  session: ActiveSession,
  result: StepResult,
  options: Omit<RuleRunOptions, 'onLog' | 'onLogFailure'> = {},
): Promise<StepResult> {
  if (!resumeNeedsRules(session, result)) return result;
  const stop = await resolveBreakpointStop(
    session,
    toBigInt(result.errorContext ?? 0n),
    result.errorMessage ?? 'Method breakpoint encountered',
    options,
  );
  if (stop.kind === 'completed') return { completed: true, resultOop: stop.resultOop };
  return {
    completed: false,
    errorMessage: stop.message,
    errorContext: stop.context,
    errorNumber: stop.errorNumber,
  };
}
