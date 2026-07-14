import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

describe('GCI Priority 7: Session Utilities', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  beforeAll(() => {
    const login = gci.GciTsLogin(
      STONE_NRS, null, null, false,
      GEM_NRS, GS_USER, GS_PASSWORD, 0, 0,
    );
    expect(login.session).not.toBeNull();
    session = login.session;
  });

  afterAll(() => {
    if (session) {
      gci.GciTsAbort(session);
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  // GciTsWaitForEvent and GciTsCancelWaitForEvent block the calling thread
  // and are designed for multi-threaded use. They cannot be tested in a
  // synchronous koffi FFI context. The bindings are verified to load correctly.

  describe('GciTsDirtyExportedObjs', () => {
    it('returns no dirty objects when none have been modified', () => {
      // Initialize dirty tracking (can only be called once per session)
      const { err: initErr } = gci.GciTsDirtyObjsInit(session);
      expect(initErr.number).toBe(0);

      const { success, oops, err } = gci.GciTsDirtyExportedObjs(session, 100);
      console.log('DirtyExportedObjs - success:', success,
        'oops.length:', oops.length, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(oops.length).toBe(0);
    });
  });

  describe('GciTsKeepAliveCount', () => {
    it('returns a non-negative count', () => {
      const { result, err } = gci.GciTsKeepAliveCount(session);
      console.log('KeepAliveCount - result:', result.toString(), 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('GciTsKeyfilePermissions', () => {
    it('returns a permissions bitmask when logged in as SystemUser', () => {
      // KeyfilePermissions requires SystemUser
      const sysLogin = gci.GciTsLogin(
        STONE_NRS, null, null, false,
        GEM_NRS, 'SystemUser', GS_PASSWORD, 0, 0,
      );
      expect(sysLogin.session).not.toBeNull();

      const { result, err } = gci.GciTsKeyfilePermissions(sysLogin.session);
      console.log('KeyfilePermissions(SystemUser) - result:', result.toString(16),
        'err.number:', err.number, 'err.message:', err.message);
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);

      gci.GciTsLogout(sysLogin.session);
    });
  });
});
