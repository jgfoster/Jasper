import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from '../gci/gciTestConfig';

// See README.md (same directory) for the full write-up.
//
// Each test mints a fresh, never-before-seen selector via unique() -- the
// whole point being demonstrated here is that a selector string only raises
// NameError the first time this session has seen it become a real Symbol.
// A fixed literal would only reproduce the "never seen" case once per
// session -- reusing one across a whole session's lifetime (e.g. multiple
// tests sharing one login) makes the result depend on what ran earlier.
function unique(label: string): string {
  return `${label}${Math.random().toString(36).slice(2, 10)}`;
}

describe('GemStone perform: symbol interning changes the error you get', () => {
  let gci: GciLibrary;
  let session: unknown;

  beforeEach(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;
  });

  afterEach(() => {
    if (session) gci.GciTsLogout(session);
    gci.close();
  });

  it('raises NameError for a selector that has never been seen before', () => {
    const selector = unique('gciReproNeverSeen');

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/NameError/);
  });

  it('repeating the exact same failed perform still raises NameError, not MessageNotUnderstood', () => {
    const selector = unique('gciReproRepeatedFailure');

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/NameError/);
    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/NameError/);
  });

  it('raises MessageNotUnderstood once the selector text has appeared as a Symbol literal in unrelated compiled source', () => {
    const selector = unique('gciReproSymbolLiteral');

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/NameError/);

    gci.execute(session, `#${selector}`);

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/MessageNotUnderstood/);
  });

  it('raises MessageNotUnderstood once the selector text has been sent asSymbol in unrelated compiled source', () => {
    const selector = unique('gciReproAsSymbolSend');

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/NameError/);

    gci.execute(session, `'${selector}' asSymbol`);

    expect(() => gci.perform(session, gci.falseOop(), selector)).toThrow(/MessageNotUnderstood/);
  });

  it('does not carry over to a brand new session, even after an explicit commit', () => {
    const selector = unique('gciReproCrossSession');

    gci.execute(session, `#${selector}`);
    gci.GciTsCommit(session);

    const otherLogin = gci.GciTsLogin(
      STONE_NRS,
      null,
      null,
      false,
      GEM_NRS,
      GS_USER,
      GS_PASSWORD,
      0,
      0,
    );
    expect(otherLogin.session).not.toBeNull();
    const otherSession = otherLogin.session;

    try {
      expect(() => gci.perform(otherSession, gci.falseOop(), selector)).toThrow(/NameError/);
    } finally {
      gci.GciTsLogout(otherSession);
    }
  });
});
