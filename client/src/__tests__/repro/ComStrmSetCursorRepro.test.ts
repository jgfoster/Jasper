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
