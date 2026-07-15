import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

// GemStone compiler finding: source with a non-ASCII (multi-byte UTF-8)
// character can fail to compile with "a CompileError occurred (error 1001),
// Internal logic error in compiler: ComStrmSetCursor: new cursor out of
// range". GemStone's compiler is closed-source -- we can't tell whether this
// is an unintended defect or some by-design constraint, and most of what
// follows is inferred from black-box testing, not from reading its
// implementation. One piece IS independently documented, though: GemStone's
// own GemBuilder for C reference ("Error Report Structure - GciErrSType")
// states that a compiler error's argument carries "the offset into the
// source string at which the error occurred" -- confirming the compiler
// really does track a source-string position for errors, consistent with
// (though not proof of) a byte-vs-character-length mismatch being the root
// cause here.
//
// TRIGGERS -- a non-ASCII character as the value being *stored*:
//   - `:=` into a declared temp
//   - `at:put:`
//
// SAFE -- the same character in an inert (unassigned) expression:
//   - a bare literal
//   - a `^` early return, e.g. the `ifNil: [^ '...']` guard clause used
//     throughout queries/*.ts
// Blocks are not a factor either way (an early suspect, ruled out).
//
// Each test mints fresh random text via unique() instead of reusing a fixed
// literal. GemStone appears to cache something keyed on exact source text:
// `| x | x := '—'` failed reliably a dozen times across separate runs, then
// started passing on every later run with that same text -- while a
// brand-new snippet failed again on the first try, every time. A test with
// fixed strings would silently go green without anything actually changing.
// OPEN QUESTION: whether this per-text caching and the Shared Page Cache
// effect described below are the same mechanism observed at different
// granularities, or two separate findings, has not been determined.
//
// Each test also logs in with its own session (beforeEach/afterEach): a
// session that just hit this can misbehave on later, unrelated compiles --
// confirmed directly. OPEN QUESTIONS not yet characterized: what the
// misbehavior looks like (the same ComStrmSetCursor error recurring vs. a
// different symptom), what it's scoped to (that session? that gem process?
// something shared across sessions?), and whether it's the same underlying
// mechanism as the per-text caching above, observed at a different
// granularity, or a separate effect.
//
// Side effect: triggering this was, in this investigation, followed by
// GemStone's Shared Page Cache reaching a state where unrelated compiles in
// OTHER gem processes started failing too, surviving a plain stone
// stop/start. That's NOT documented GemStone behavior -- per GemStone's own
// System Administration Guide, stopstone waits for every session to detach
// from the cache before it returns, and cache "warming" across a restart
// re-reads the same pages from disk into a freshly-created cache; nothing
// describes the cache memory itself surviving a restart. So this looks like
// a gem process left in a bad state (plausibly by this exact bug) failing to
// detach cleanly, not a documented persistence feature. If other tests fail
// after this file runs, clear orphaned shared memory/semaphores (`ipcs -m`,
// `ipcs -s`) before restarting the stone -- a plain restart isn't always
// enough.
//
// VERSIONS TESTED -- binary search via
// `npm run test:server:stop && npm run test:server:start -- <version>`,
// then running this file against each:
//   3.6.2    reproduces
//   3.6.8    reproduces
//   3.7.2    reproduces
//   3.7.4.3  reproduces
//   3.7.5    does not reproduce -- both trigger tests below compile clean
// (3.7.4.3 and 3.7.5 are adjacent in the tracked matrix; no in-between build
// was tested.) This repo's default test stone is 3.6.2 (the oldest tracked
// release), so the two `toThrow` assertions below pass out of the box.
// Against a 3.7.5+ stone, EXPECT them to fail -- that's this no longer
// reproducing, not a broken test. Delete or invert them once this repo's
// minimum supported GemStone version reaches 3.7.5+.
//
// Not something we can address here either way: whether intentional or not,
// it's GemStone-side behavior we can only work around by not generating the
// trigger shape.
function unique(label: string): string {
  return `${label}${Math.random().toString(36).slice(2, 10)}`;
}

describe('GemStone compiler: ComStrmSetCursor with non-ASCII source text', () => {
  let gci: GciLibrary;
  let session: unknown;

  beforeEach(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(
      STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0,
    );
    expect(login.session).not.toBeNull();
    session = login.session;
  });

  afterEach(() => {
    if (session) gci.GciTsLogout(session);
    gci.close();
  });

  it('compiles a bare non-ASCII literal with nothing else in the doit', () => {
    expect(() => gci.execute(session, `'${unique('—')}'`)).not.toThrow();
  });

  it('fails to compile a non-ASCII literal assigned to a declared temp', () => {
    const temp = unique('t');
    const code = `| ${temp} | ${temp} := '${unique('—')}'`;

    expect(() => gci.execute(session, code)).toThrow(/ComStrmSetCursor/);
  });

  it('fails to compile a non-ASCII literal stored via at:put:, even with no temp declared', () => {
    const key = unique('GciNonAsciiSourceScratch');
    const code = `UserGlobals at: #${key} put: '${unique('—')}'. UserGlobals at: #${key}`;

    expect(() => gci.execute(session, code)).toThrow(/ComStrmSetCursor/);
  });

  it('does not trigger on a declared-but-unused temp when non-ASCII text appears in an unrelated statement', () => {
    const temp = unique('t');
    const code = `| ${temp} | '${unique('—')}'`;

    expect(() => gci.execute(session, code)).not.toThrow();
  });

  it('does not trigger on the ^-return guard-clause idiom used throughout queries/, even with non-ASCII text', () => {
    const message = unique('Not found: Ñoño—');
    const code = `| base | base := nil. base ifNil: [^ '${message}']. 'unreachable'`;

    expect(() => gci.execute(session, code)).not.toThrow();
  });
});
