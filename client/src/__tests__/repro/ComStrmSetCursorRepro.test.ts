import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from '../gci/gciTestConfig';

// See README.md (same directory) for the full write-up.
//
// Each test mints fresh random text via unique() rather than a fixed
// literal -- GemStone caches something keyed on exact source text, so a
// fixed string would eventually stop reproducing this (see README). Each
// test also logs in with its own session, since a session that's hit this
// once can misbehave on later, unrelated compiles (see README).
//
// This repo's default test stone is 3.6.2, so the two `toThrow` assertions
// below pass out of the box. Against a 3.7.5+ stone, EXPECT them to fail --
// that's the fix working, not a broken test.
//
// Update (2026-07-18): further testing suggests both claims in the comment
// above need revising. See README's "Update" section: repeating the exact
// same text (same session, 10x; fresh sessions, 5x) reproduced every time,
// so it doesn't look text-keyed. And no session-poisoning effect showed up
// either -- an ascii-only compile right after a throw, in the same
// session, succeeded normally. unique() is still a reasonable defensive
// choice; we just no longer believe the reason we originally gave for it.
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

  // Added 2026-07-18 to check "Open question 1" from the README (does
  // hitting this once poison the session for later, unrelated compiles?).
  // Everything below runs against the SAME session on purpose, in one
  // test, so ordering is fixed regardless of vitest's shuffled test order --
  // this is the one test in this file where that matters.
  it('does not poison the session for later, unrelated compiles after it throws once', () => {
    expect(() => gci.execute(session, `1 + 1`)).not.toThrow();

    const poisoningCode = `| t | t := '${unique('—')}'. t printString`;
    expect(() => gci.execute(session, poisoningCode)).toThrow(/ComStrmSetCursor/);

    expect(() => gci.execute(session, `2 + 2`)).not.toThrow();
    expect(() => gci.execute(session, `| x | x := 5. x printString`)).not.toThrow();

    const freshNonAsciiCode = `| t | t := '${unique('—')}'. t printString`;
    expect(() => gci.execute(session, freshNonAsciiCode)).toThrow(/ComStrmSetCursor/);
  });
});
