import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH } from './gciTestConfig';

describe('GCI Priority 8: Debug Functions', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  describe('GciTsDebugConnectToGem', () => {
    it('returns null session and error for a non-existent gem PID', () => {
      // Use a PID that almost certainly doesn't correspond to a GemStone gem
      const { session, err } = gci.GciTsDebugConnectToGem(999999);
      console.log(
        'DebugConnectToGem(999999) - session:',
        session,
        'err.number:',
        err.number,
        'err.message:',
        err.message,
      );
      // Should fail — no gem is listening on that PID
      expect(session).toBeNull();
      expect(err.number).not.toBe(0);
    });
  });

  // GciTsDebugStartDebugService requires a valid debug session from
  // GciTsDebugConnectToGem, which requires a gem listening for debug
  // connections (GEM_LISTEN_FOR_DEBUG config). The binding is verified
  // to load correctly via the constructor.
});
