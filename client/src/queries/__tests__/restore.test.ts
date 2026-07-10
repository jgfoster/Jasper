import { describe, it, expect } from 'vitest';
import {
  RESTORE_NO_LOGOUT_MARKER,
  restoreFromBackupCode,
  commitRestoreCode,
  restoreStatusInfoCode,
} from '../restore';

describe('full logical restore queries', () => {
  describe('restore Smalltalk', () => {
    it('restores the repository from the requested backup file', () => {
      const code = restoreFromBackupCode('/data/backups/gs.dbf');

      expect(code).toContain("SystemRepository restoreFromBackup: '/data/backups/gs.dbf'");
    });

    it('escapes single quotes in the backup path', () => {
      const code = restoreFromBackupCode("/data/o'brien/gs.dbf");

      expect(code).toContain("restoreFromBackup: '/data/o''brien/gs.dbf'");
    });

    it('marks a completion that did not auto-log-out so the partial-logging case is detectable', () => {
      const code = restoreFromBackupCode('/x.dbf');

      expect(code).toContain(`'${RESTORE_NO_LOGOUT_MARKER}'`);
    });
  });

  describe('finalizing the restore', () => {
    it('commits the restore to make the stone operational', () => {
      const code = commitRestoreCode();

      expect(code).toContain('SystemRepository commitRestore');
    });

    it('evaluates to a success marker once committed', () => {
      const code = commitRestoreCode();

      expect(code).toContain("'OK'");
    });
  });

  describe('restore status', () => {
    it('reports the current restore state', () => {
      const code = restoreStatusInfoCode();

      expect(code).toContain('SystemRepository restoreStatusInfo');
    });
  });
});
