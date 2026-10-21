import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  BREAKPOINT_ERROR,
  BreakpointRule,
  DECISION,
  deciderSource,
  decodeDecision,
  applyBreakpointRules,
  logMessageExpression,
} from '../conditionalBreakpoints';
import { OOP_NIL } from '../gciConstants';
import { FRAME_SELF_SMALLTALK } from '../debugQueries';
import { CLIENT_FORWARDER_SEND_ERR } from '../transcriptSink';
import { NbCancelledError } from '../nbRunner';
import * as vscode from 'vscode';
import { fakeActiveSession } from './fakeActiveSession';

const spec = (over: Partial<BreakpointRule> = {}): BreakpointRule => ({
  methodExpr: '(Account compiledMethodAt: #deposit: environmentId: 0)',
  stepPoint: 7,
  condition: 'amount > 100',
  ...over,
});

/** The decider for `specs`, built for a run on process 9001. */
const decider = (specs: BreakpointRule[]): string => deciderSource(specs, 9001n);

describe('deciderSource', () => {
  it('compiles once and parks the block in the session temps', () => {
    // Compiled once and performed per hit: a doit is recompiled every time it
    // is executed, and this source is several KB of it.
    const source = decider([spec()]);
    expect(source).toContain(
      "SessionTemps current at: #'JasperConditionalBreakpointDecider' put: entry.",
    );
    expect(source).toContain('entry := Array with: proc with: nil with: specs with: armed.');
    expect(source).toContain('decider := [:p |');
  });

  it('parks the run with the process it belongs to, and follows it hit by hit', () => {
    // So a Resume of the same process can find this run's trigger arming.
    const source = decider([spec()]);
    expect(source).toContain('proc := Object _objectForOop: 9001.');
    expect(source).toContain('entry at: 1 put: p.');
  });

  it("carries a trigger's arming over from the same process's previous decider", () => {
    const source = decider([spec({ stepPoint: 3 }), spec({ stepPoint: 9, triggeredBy: 1 })]);
    expect(source).toContain('(old notNil and: [ (old at: 1) == proc ]) ifTrue: [');
    expect(source).toContain('ifTrue: [ armed at: k put: ((old at: 4) at: j) ]');
  });

  it('takes the suspended process as the block’s argument', () => {
    // No `_objectForOop:` per hit — the process is handed over as the object it
    // already is.
    expect(decider([spec()])).toContain('fc := p _frameContentsAt: 1.');
  });

  it('never returns non-locally from the block', () => {
    // The home doit has finished by the time the block runs, so a `^` in it is
    // an error rather than an early exit.
    const body = decider([spec()]);
    expect(body.slice(body.indexOf('decider := [:p |'))).not.toMatch(/\^/);
  });

  it('carries one spec per conditional breakpoint', () => {
    const source = decider([
      spec({ stepPoint: 3, condition: 'i > 5' }),
      spec({ stepPoint: 9, condition: 'each isNil' }),
    ]);
    expect(source).toContain("with: 3 with: 'i > 5'");
    expect(source).toContain("with: 9 with: 'each isNil'");
  });

  it('marks a breakpoint with no trigger as armed from the start', () => {
    const source = decider([spec({ condition: 'i > 5' })]);
    // Slot 5 is the trigger index; 0 means "waits for nothing".
    expect(source).toContain("with: 'i > 5' with: nil with: 0");
    expect(source).toContain('armed := specs collect: [:s | (s at: 5) = 0].');
  });

  it('starts a triggered breakpoint disarmed, pointing at its trigger', () => {
    const source = decider([
      spec({ stepPoint: 3 }),
      spec({ stepPoint: 9, condition: undefined, triggeredBy: 1 }),
    ]);
    // The second spec waits on the first, and only the first starts armed.
    expect(source).toContain('with: 9 with: nil with: nil with: 1');
    expect(source).toContain('armed := specs collect: [:s | (s at: 5) = 0].');
  });

  it('skips a disarmed breakpoint instead of stopping at it', () => {
    // The Go branch guarded on `armed`, which is what makes a triggered
    // breakpoint pass over rather than stop while it waits.
    const source = decider([spec({ triggeredBy: 1 })]);
    expect(source).toContain('(armed at: idx) not');
  });

  it('lets a breakpoint that waits on itself stay disarmed for good', () => {
    // How a breakpoint whose trigger was disabled or removed is kept disarmed:
    // its rule names its own index. A waiting breakpoint answers Go before the
    // arming sweep is reached, so it arms nothing — itself included. The live
    // proof is the integration test of the same name.
    const source = decider([spec({ triggeredBy: 1 })]);
    expect(source).toContain('with: 1).');
    expect(source.indexOf('(armed at: idx) not')).toBeLessThan(
      source.indexOf('armed at: k put: true'),
    );
  });

  it('arms every spec that names the one just reached', () => {
    // A sweep of the whole array, not a single at:put:, so one trigger can arm
    // several breakpoints at once.
    const source = decider([spec()]);
    expect(source).toContain('(((specs at: k) at: 5) = idx) ifTrue: [ armed at: k put: true ]');
  });

  it('keeps the generated source ASCII', () => {
    // Non-ASCII in this source reaches GemStone's compiler through the GCI's
    // UTF-8 path and breaks its cursor arithmetic outright — "ComStrmSetCursor:
    // new cursor out of range", reported as a CompileError on a doit that reads
    // perfectly well. A stray em dash in a COMMENT is enough to take the whole
    // feature down, so the bar is the whole string, comments included.
    const source = decider([
      spec({ stepPoint: 3, condition: 'i > 5' }),
      spec({ stepPoint: 9, logMessage: "'x'", triggeredBy: 1 }),
    ]);
    const offending = [...source].filter((c) => c.charCodeAt(0) > 127);
    expect(offending).toEqual([]);
  });

  it('keeps the generated source ASCII when a condition or log message is not', () => {
    // A developer's text can hold anything. Written as a literal, one accented
    // letter in one condition took every breakpoint rule in the session down
    // with the same compiler error, so it is spelled out as code points instead.
    const source = decider([
      spec({ stepPoint: 3, condition: "name = 'caf\u00e9'" }),
      spec({ stepPoint: 9, logMessage: "'\u65e5\u672c ', i printString" }),
    ]);

    expect([...source].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    expect(source).toContain('#(110 97 109 101 32 61 32 39 99 97 102 233 39)');
    expect(source).toContain(
      '#(39 26085 26412 32 39 44 32 105 32 112 114 105 110 116 83 116 114 105 110 103)',
    );
    expect(source).toContain('Character codePoint: c');
  });

  it('leaves an ASCII condition readable, as a plain literal', () => {
    expect(decider([spec({ condition: 'i > 5' })])).toContain("with: 'i > 5'");
  });

  it("doubles a quote in the developer's condition", () => {
    // Otherwise `name = 'ada'` would close the literal early and the doit would
    // fail to compile — reported as if the breakpoint itself were broken.
    expect(decider([spec({ condition: "name = 'ada'" })])).toContain("with: 'name = ''ada'''");
  });

  it('survives a method, or a class, that no longer exists', () => {
    // Recompiling or removing the method makes `compiledMethodAt:` raise, and a
    // removed class makes the expression fail to compile at all. Compiled in
    // the gem inside the guard, a spec that cannot resolve degrades to "no rule
    // here" — which stops — rather than taking every other rule down with it.
    expect(decider([spec()])).toContain(
      "specs add: (Array with: ([ '(Account compiledMethodAt: #deposit: environmentId: 0)' " +
        'evaluate ] on: Error do: [:ex | nil ])',
    );
  });

  it('matches a block frame against its home method', () => {
    // A breakpoint inside a non-inlined block reports the block's own method,
    // while the breakpoint was set on the home method's step point.
    const source = decider([spec()]);
    expect(source).toContain('frameMethod isMethodForBlock');
    expect(source).toContain('ifTrue: [ frameMethod homeMethod ]');
  });

  it("evaluates the condition against the frame's self, as the debugger recovers it", () => {
    // The stopped frame's receiver is the ExecBlock itself, so `self` and every
    // instance variable would otherwise fail to resolve (GemTalk/Jasper#561).
    // The debugger's own rule, not a third copy of it.
    const source = decider([spec()]);
    expect(source).toContain(FRAME_SELF_SMALLTALK);
    expect(source).toContain('rcvr := (frameSelfOf value: fetch value: 1 value: fc value: depth)');
  });

  it("binds the home method's names under the block's own", () => {
    const source = decider([spec()]);
    expect(source).toContain('hArr ifNotNil: [:h | bind value: h ].\n    bind value: fc.');
  });

  it('stops at a step point no condition claims', () => {
    // An unconditional breakpoint, or a `halt`, reached while skipping.
    expect(decider([spec()])).toContain(
      `spec isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ]`,
    );
  });

  it('refuses a condition that does not answer a Boolean', () => {
    // Left alone, `each` (rather than `each > 3`) would never equal true and the
    // run would silently go to completion — a breakpoint that quietly does
    // nothing is the worst answer available.
    expect(decider([spec()])).toContain('(answer == true or: [ answer == false ])');
  });

  it('sends no spec lines when nothing is conditional', () => {
    expect(decider([])).toContain('specs := Array new.');
  });

  it('bakes in every conditional breakpoint, and judges each on its own', () => {
    // Several can be armed at once; the block picks whichever claims the step
    // point the process actually stopped at.
    const source = decider([
      spec({
        methodExpr: '(Account compiledMethodAt: #a environmentId: 0)',
        stepPoint: 3,
        condition: 'x > 1',
      }),
      spec({
        methodExpr: '(Order compiledMethodAt: #b environmentId: 0)',
        stepPoint: 9,
        condition: 'y isNil',
      }),
    ]);
    expect(source).toContain("with: 3 with: 'x > 1'");
    expect(source).toContain("with: 9 with: 'y isNil'");
    // Each stop looks up whichever rule claims the step point it landed on —
    // and remembers which, so a log line can name its own logpoint.
    expect(source).toContain(
      '(idx = 0 and: [ (((specs at: k) at: 1) == home) and: [ ((specs at: k) at: 2) = sp ] ])',
    );
  });
});

describe('logMessageExpression', () => {
  it('compiles a message with no placeholders to a literal', () => {
    expect(logMessageExpression('reached here')).toBe("'reached here'");
  });

  it('evaluates a placeholder and prints it', () => {
    // `{each}` rather than `{each printString}` — the ceremony is ours to add.
    expect(logMessageExpression('hit {each}')).toBe("'hit ', (each) printString");
  });

  it('joins several placeholders into ONE expression', () => {
    // Six placeholders must cost the same single evaluation and single fetch as
    // one, or a message becomes more expensive than the breakpoint it is on.
    expect(logMessageExpression('{a} and {b}')).toBe("(a) printString, ' and ', (b) printString");
  });

  it('takes any expression, not just a variable name', () => {
    expect(logMessageExpression('{self orders size}')).toBe('(self orders size) printString');
  });

  it('doubles a quote in the literal text', () => {
    expect(logMessageExpression("it's here")).toBe("'it''s here'");
  });

  it('leaves an unclosed brace as literal text', () => {
    // A message is prose. Refusing to log because a brace was left open would
    // be worse than logging the brace.
    expect(logMessageExpression('a { b')).toBe("'a { b'");
  });

  it('treats an empty placeholder as literal braces', () => {
    // An empty expression would not compile at all.
    expect(logMessageExpression('x{}y')).toBe("'x', '{}', 'y'");
  });

  it('still answers a String for an empty message', () => {
    expect(logMessageExpression('')).toBe("''");
  });
});

describe('decodeDecision', () => {
  it('reads a skip', () => {
    expect(decodeDecision(DECISION.Go, '')).toEqual({ kind: 'go' });
  });

  it('reads a stop', () => {
    expect(decodeDecision(DECISION.Stop, '')).toEqual({ kind: 'stop' });
  });

  it('reads a failure as its message', () => {
    expect(decodeDecision(DECISION.Failed, 'undefined symbol nope')).toEqual({
      kind: 'failed',
      message: 'undefined symbol nope',
    });
  });

  it('reads a log line, and which rule wrote it', () => {
    expect(decodeDecision(DECISION.Log, 'hit 7', 2)).toEqual({
      kind: 'log',
      text: 'hit 7',
      rule: 2,
    });
  });

  it('treats an unknown decision as a stop', () => {
    // The process really is suspended at a breakpoint, so opening the debugger
    // on it is both true and the reading that loses nothing.
    expect(decodeDecision(77, '')).toEqual({ kind: 'stop' });
  });
});

/**
 * A GCI stub that answers a scripted sequence of decisions, and a scripted
 * sequence of resume outcomes.
 *
 * Decisions are decoded through `oopToInteger`, so the oops only have to be
 * distinguishable — what they decode to is what each test is about.
 */
function stubSession(
  decisions: number[],
  resumes: Resume[],
  message = '',
  hooks: {
    /** Runs inside the Nth resume (0-based), while it is "in flight". */
    duringResume?: (n: number) => void;
    /** Replaces the decider's answer, for a judgement that fails. */
    perform?: () => { result: bigint; err: { number: number; message?: string; context?: bigint } };
  } = {},
) {
  let decisionIndex = 0;
  let resumeIndex = 0;
  const executed: string[] = [];
  const performed: { receiver: bigint; selector: string }[] = [];
  const continues: { process: bigint; flags: number }[] = [];
  const cleared: bigint[] = [];
  const breaks: boolean[] = [];
  const gci = {
    utf8ClassOop: () => 74n,
    // One execute per run: compiling the decider. Everything after is a perform.
    GciTsExecute: (_h: unknown, code: string) => {
      executed.push(code);
      return { result: 400n, err: { number: 0, message: '' } };
    },
    GciTsPerformAsync: (_h: unknown, receiver: bigint, _c: bigint, selector: string) => {
      performed.push({ receiver, selector });
      return Promise.resolve(
        hooks.perform?.() ?? { result: 500n, err: { number: 0, message: '' } },
      );
    },
    // What a Transcript write (2336) carries: client object 2, #nextPutAll:,
    // and an argument Array holding the text.
    GciTsOopToI64: () => ({ success: true, value: 2n, err: { number: 0 } }),
    GciTsFetchUtf8: (_h: unknown, oop: bigint) => ({
      data: oop === 0x12n ? 'nextPutAll:' : 'written',
      err: { number: 0 },
    }),
    GciTsClearStack: (_h: unknown, process: bigint) => {
      cleared.push(process);
      return { success: true, err: { number: 0 } };
    },
    GciTsBreak: (_h: unknown, hard: boolean) => {
      breaks.push(hard);
      return { success: true, err: { number: 0 } };
    },
    GciTsFetchOops: (_h: unknown, oop: bigint) => {
      if (oop === 0x13n) return { result: 1, oops: [0x77n], err: { number: 0 } };
      const decision = decisions[Math.min(decisionIndex, decisions.length - 1)];
      decisionIndex += 1;
      return {
        // decision, message, matched-rule index
        oops: [1000n + BigInt(decision), message === '' ? OOP_NIL : 77n, 1001n],
        err: { number: 0, message: '' },
      };
    },
    GciTsFetchChars: () => ({ data: message, err: { number: 0, message: '' } }),
    oopToInteger: (_h: unknown, oop: bigint) => Number(oop - 1000n),
    GciTsContinueWithAsync: (
      _h: unknown,
      process: bigint,
      _tos: bigint,
      _e: unknown,
      flags: number,
    ) => {
      continues.push({ process, flags });
      const next = resumes[Math.min(resumeIndex, resumes.length - 1)];
      hooks.duringResume?.(resumeIndex);
      resumeIndex += 1;
      return Promise.resolve({
        result: next.result ?? 0n,
        err: { context: 0n, message: '', ...next.err },
      });
    },
  };
  return {
    session: fakeActiveSession({ id: 1, gci, handle: {} }),
    gci,
    executed,
    performed,
    continues,
    cleared,
    breaks,
  };
}

type Resume = {
  result?: bigint;
  err: { number: number; message?: string; context?: bigint; args?: bigint[]; argCount?: number };
};

/** A Transcript write in clientForwarder mode, from `process`. */
const writesToTranscript = (process: bigint): Resume => ({
  err: {
    number: CLIENT_FORWARDER_SEND_ERR,
    context: process,
    args: [0x10n, 0x11n, 0x12n, 0x13n],
    argCount: 4,
  },
});

const hitsBreakpoint = (process: bigint) => ({
  err: { number: BREAKPOINT_ERROR, message: 'Method breakpoint encountered.', context: process },
});

describe('applyBreakpointRules', () => {
  it('stops without resuming when the condition holds at the first hit', async () => {
    const { session, continues } = stubSession([DECISION.Stop], []);

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'stopped',
      context: 7n,
      skipped: 0,
    });
    expect(continues).toHaveLength(0);
  });

  it('compiles the decider with debug flags off', async () => {
    // It must not break on the very breakpoints it is judging.
    const { session } = stubSession([DECISION.Stop], []);
    const execute = vi.spyOn(session, 'GciTsExecute');

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(execute.mock.calls[0][4]).toBe(0);
  });

  it('compiles once and then performs, however many hits it judges', async () => {
    // The whole point of the compile-once shape: a doit is recompiled on every
    // execution, and this one is several KB.
    const { session, executed, performed } = stubSession(
      [DECISION.Go, DECISION.Go, DECISION.Go, DECISION.Stop],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), hitsBreakpoint(10n)],
    );

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(executed).toHaveLength(1);
    expect(performed).toHaveLength(4);
    expect(performed.every((p) => p.selector === 'value:')).toBe(true);
    // …on the block the compile answered.
    expect(performed.every((p) => p.receiver === 400n)).toBe(true);
  });

  it('resumes past a false condition and stops at the next hit that holds', async () => {
    const { session, continues } = stubSession(
      [DECISION.Go, DECISION.Go, DECISION.Stop],
      [hitsBreakpoint(8n), hitsBreakpoint(9n)],
    );

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'stopped',
      context: 9n,
      skipped: 2,
    });
    // And each resume follows the process the previous stop reported, rather
    // than the one we started from — and the stop names the one it ended on,
    // which is the one the debugger has to open.
    expect(continues.map((c) => c.process)).toEqual([7n, 8n]);
  });

  it('keeps the resumed run debuggable and interpreted', async () => {
    // Dropping the debug flag would disarm every remaining breakpoint in the
    // run; dropping interpreted would make the stop unsteppable.
    const { session, continues } = stubSession([DECISION.Go, DECISION.Stop], [hitsBreakpoint(8n)]);

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(continues[0].flags & 1).toBe(1); // ENABLE_DEBUG
    expect(continues[0].flags & 0x20).toBe(0x20); // INTERPRETED
  });

  it('answers a completed run with its result', async () => {
    const { session } = stubSession([DECISION.Go], [{ result: 4242n, err: { number: 0 } }]);

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'completed',
      resultOop: 4242n,
      skipped: 1,
    });
  });

  it('answers an error raised while skipping, on the process it was raised in', async () => {
    const { session } = stubSession(
      [DECISION.Go],
      [{ err: { number: 2010, message: 'doesNotUnderstand: #foo', context: 91n } }],
    );

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'raised',
      description: 'doesNotUnderstand: #foo',
      errorNumber: 2010,
      context: 91n,
      skipped: 1,
    });
  });

  it('lets timers run during a long skip, so it stays interruptible', async () => {
    // The stubbed resume answers an already-resolved promise, so awaiting it
    // drains only the microtask queue. Without a yield of its own the loop
    // would starve setTimeout, so the progress notification never appears and
    // there is nothing to cancel with.
    const decisions: number[] = Array.from({ length: 400 }, () => DECISION.Go);
    decisions.push(DECISION.Stop);
    const { session } = stubSession(decisions, [hitsBreakpoint(8n)]);

    // A stubbed hit is far faster than a real one (~0.25 ms against a stone), so
    // drive the clock rather than the wall: one millisecond per call is what the
    // loop is deciding against.
    let clock = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));

    let timerRan = false;
    setTimeout(() => {
      timerRan = true;
    }, 0);

    try {
      await applyBreakpointRules(session, 7n, [spec()]);
    } finally {
      now.mockRestore();
    }

    expect(timerRan).toBe(true);
  });

  it('writes a logpoint line and carries on rather than stopping', async () => {
    // The whole point of a logpoint: it never stops, so the run reaches its end
    // and the developer gets a line per hit instead of a debugger.
    const { session } = stubSession(
      [DECISION.Log, DECISION.Log, DECISION.Log],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), { result: 42n, err: { number: 0 } }],
      'hit 7',
    );
    const lines: string[] = [];

    const outcome = await applyBreakpointRules(
      session,
      7n,
      [spec({ logMessage: "'hit ', (each) printString" })],
      { onLog: (text) => lines.push(text) },
    );

    expect(outcome).toEqual({ kind: 'completed', resultOop: 42n, skipped: 3 });
    expect(lines).toEqual(['hit 7', 'hit 7', 'hit 7']);
  });

  it('tells the sink which rule wrote the line', async () => {
    // With several logpoints armed, a line has to be attributable to one.
    const { session } = stubSession([DECISION.Log], [{ result: 1n, err: { number: 0 } }], 'x');
    const rules = [spec({ logMessage: "'x'" })];
    const seen: (BreakpointRule | undefined)[] = [];

    await applyBreakpointRules(session, 7n, rules, { onLog: (_text, rule) => seen.push(rule) });

    expect(seen).toEqual([rules[0]]);
  });

  it('carries on past a logpoint whose message will not evaluate', async () => {
    // Stopping there would drop the developer into a debugger they did not ask
    // for, over a typo in a message, and take the run down with it.
    const { session } = stubSession(
      [DECISION.LogFailed, DECISION.LogFailed, DECISION.LogFailed],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), { result: 42n, err: { number: 0 } }],
      'undefined symbol  i',
    );
    const failures: string[] = [];

    const outcome = await applyBreakpointRules(
      session,
      7n,
      [spec({ logMessage: '(i) printString' })],
      { onLogFailure: (message) => failures.push(message) },
    );

    expect(outcome).toEqual({ kind: 'completed', resultOop: 42n, skipped: 3 });
    // Reported ONCE, not once per hit: the message is wrong for every hit, and a
    // thousand identical complaints would bury the run's real output.
    expect(failures).toEqual(['undefined symbol  i']);
  });

  it('answers a condition that could not be evaluated', async () => {
    const { session, continues } = stubSession([DECISION.Failed], [], 'undefined symbol  nope');

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'conditionFailed',
      message: 'undefined symbol  nope',
      context: 7n,
      skipped: 0,
    });
    // And it does not resume: the developer wrote a condition that cannot be
    // applied, so running on past the breakpoint would honour nothing.
    expect(continues).toHaveLength(0);
  });

  it('shows a Transcript write and carries on, without counting it as a hit', async () => {
    // In clientForwarder mode every Transcript write stops the run as 2336.
    // Taken for an error, it opened a debugger on the Transcript's internals
    // and the breakpoint the developer wanted was never reached.
    const { session, continues, performed } = stubSession(
      [DECISION.Go, DECISION.Stop],
      [writesToTranscript(50n), hitsBreakpoint(8n)],
    );
    const written: string[] = [];

    const outcome = await applyBreakpointRules(session, 7n, [spec()], {
      onTranscript: (text) => written.push(text),
    });

    expect(outcome).toEqual({ kind: 'stopped', context: 8n, skipped: 1 });
    expect(written).toEqual(['written']);
    // The writer resumed with the run's own flags, and the decider was not
    // asked about a stop that was never a breakpoint.
    expect(continues.map((c) => c.process)).toEqual([7n, 50n]);
    expect(continues[1].flags).toBe(continues[0].flags);
    expect(performed).toHaveLength(2);
  });

  it('keeps the error number of whatever stopped the run while skipping', async () => {
    // A soft break (6003) is the developer's Cancel; read as error 0 it opened
    // a debugger and failed a SUnit run instead of cancelling it.
    const { session } = stubSession(
      [DECISION.Go],
      [{ err: { number: 6003, message: 'a soft break was received', context: 12n } }],
    );

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toMatchObject({
      kind: 'raised',
      errorNumber: 6003,
      context: 12n,
    });
  });

  describe('cancelled', () => {
    it('stops at the hit it has reached when nothing is running', async () => {
      let cancel = (): void => {};
      const { session, continues, breaks } = stubSession(
        [DECISION.Log, DECISION.Log],
        [hitsBreakpoint(8n)],
        'x',
      );

      const outcome = await applyBreakpointRules(session, 7n, [spec({ logMessage: "'x'" })], {
        onStart: (c) => (cancel = c),
        onLog: () => cancel(),
      });

      expect(outcome).toEqual({ kind: 'cancelled', context: 7n, skipped: 0 });
      expect(continues).toHaveLength(0);
      // No call was in flight, so there was nothing to break.
      expect(breaks).toEqual([]);
    });

    it('sends a soft break to a resume that is running', async () => {
      // Otherwise Cancel waits for the next hit, which slow code between hits
      // may not reach for a long time, or ever.
      let cancel = (): void => {};
      const { session, breaks } = stubSession(
        [DECISION.Go],
        [{ err: { number: 6003, message: 'a soft break was received', context: 7n } }],
        '',
        { duringResume: () => cancel() },
      );

      const outcome = await applyBreakpointRules(session, 7n, [spec()], {
        onStart: (c) => (cancel = c),
      });

      expect(breaks).toEqual([false]);
      expect(outcome).toMatchObject({ kind: 'raised', errorNumber: 6003 });
    });

    it('treats a soft break that stopped the judgement as a cancel, and releases the decider', async () => {
      const { session, cleared } = stubSession([DECISION.Stop], [], '', {
        perform: () => ({
          result: OOP_NIL,
          err: { number: 6003, message: 'a soft break was received', context: 601n },
        }),
      });

      await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
        kind: 'cancelled',
        context: 7n,
        skipped: 0,
      });
      // The decider's own process, never the developer's.
      expect(cleared).toEqual([601n]);
    });
  });

  describe('hard-broken by the run it belongs to', () => {
    it('releases the process and stops, rather than resuming a rejected run', async () => {
      const abandoned = new AbortController();
      const { session, continues, cleared } = stubSession(
        [DECISION.Log],
        [hitsBreakpoint(8n)],
        'x',
      );

      await expect(
        applyBreakpointRules(session, 7n, [spec({ logMessage: "'x'" })], {
          signal: abandoned.signal,
          onLog: () => abandoned.abort(),
        }),
      ).rejects.toBeInstanceOf(NbCancelledError);
      expect(continues).toHaveLength(0);
      expect(cleared).toEqual([7n]);
    });

    it('releases what a break during the resume stopped', async () => {
      const abandoned = new AbortController();
      const { session, cleared } = stubSession(
        [DECISION.Go],
        [{ err: { number: 6004, message: 'hard break', context: 8n } }],
        '',
        { duringResume: () => abandoned.abort() },
      );

      await expect(
        applyBreakpointRules(session, 7n, [spec()], { signal: abandoned.signal }),
      ).rejects.toBeInstanceOf(NbCancelledError);
      expect(cleared).toEqual([8n]);
    });
  });

  it('releases the decider when its judgement fails, and says why', async () => {
    const { session, cleared } = stubSession([DECISION.Stop], [], '', {
      perform: () => ({
        result: OOP_NIL,
        err: { number: 2010, message: 'a MessageNotUnderstood occurred', context: 600n },
      }),
    });

    await expect(applyBreakpointRules(session, 7n, [spec()])).rejects.toThrow(
      'a MessageNotUnderstood occurred',
    );
    expect(cleared).toEqual([600n]);
  });

  it('judges each hit on a worker thread', async () => {
    // A condition is the developer's Smalltalk; one that loops must not freeze
    // the extension host. Only the async perform is stubbed, so a blocking one
    // would throw here.
    const { session, performed } = stubSession([DECISION.Stop], []);
    await applyBreakpointRules(session, 7n, [spec()]);
    expect(performed).toHaveLength(1);
  });

  it('updates its progress now and then, counting skipped and logged hits apart', async () => {
    vi.useFakeTimers();
    try {
      const reports: string[] = [];
      vi.mocked(vscode.window.withProgress).mockImplementationOnce(
        async (_opts, task) =>
          await task(
            { report: (v) => reports.push(v.message ?? '') },
            {
              isCancellationRequested: false,
              onCancellationRequested: () => ({ dispose: () => {} }),
            },
          ),
      );
      // Alternate a skipped hit and a logged one, each taking a millisecond.
      const decisions: number[] = Array.from({ length: 2000 }, (_, k) =>
        k % 2 === 0 ? DECISION.Go : DECISION.Log,
      );
      decisions.push(DECISION.Stop);
      const { session, gci } = stubSession(decisions, [hitsBreakpoint(8n)], 'x');
      const resume = gci.GciTsContinueWithAsync;
      gci.GciTsContinueWithAsync = (...args: Parameters<typeof resume>) =>
        new Promise((resolve) => setTimeout(() => resolve(resume(...args)), 1));

      const run = applyBreakpointRules(session, 7n, [spec({ logMessage: "'x'" })]);
      await vi.advanceTimersByTimeAsync(5000);
      await run;

      // About once per 25 ms after the notification appears at 1.5 s, not once
      // per hit.
      expect(reports.length).toBeGreaterThan(5);
      expect(reports.length).toBeLessThan(100);
      // A logged hit is not also a skipped one.
      const [, skipped, logged] = /^(\d+) skipped, (\d+) logged$/.exec(reports.at(-1)!)!;
      expect(Math.abs(Number(skipped) - Number(logged))).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
