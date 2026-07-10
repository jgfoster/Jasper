// Query layer for logical (object) restore — Repository>>restoreFromBackup: and
// the commit/status calls that finalize it. The counterpart to backup.ts.
//
// These follow the shared `QueryExecutor` convention (see types.ts). All emitted
// Smalltalk is ASCII-only so it compiles on the 3.6.x stones too (a non-ASCII
// byte trips the ComStrmSetCursor bug there).
//
// The 4046 quirk (full-logging stones — our case): on success `restoreFromBackup:`
// does NOT return to the caller. The stone raises error 4046 (RestoreBackupSuccess)
// and auto-logs-out the session, so that error number MEANS success and the caller
// must reconnect (a fresh login) before running `commitRestore`. Because the
// logout tears the session down, this cannot be caught in Smalltalk — the restore
// manager inspects the GCI error number at the transport level. The code below
// appends a marker so the *partial-logging* case (which DOES return normally,
// fully restored, needing no commit step) stays distinguishable from that error.
import { escapeString } from './util';

// Returned only when restoreFromBackup: completes WITHOUT the 4046 auto-logout —
// i.e. a partial-logging backup, which restores fully in a single call. The
// manager keys on this to know no separate commitRestore step is required.
export const RESTORE_NO_LOGOUT_MARKER = 'RESTORE_OK_NO_LOGOUT';

// Smalltalk that restores the repository from a server-side backup file. On a
// full-logging stone this never reaches the marker — the 4046 auto-logout fires
// first and is surfaced to the caller as a GCI error (which the manager treats as
// success). On a partial-logging stone it returns the marker, fully restored.
export function restoreFromBackupCode(serverPath: string): string {
  return `SystemRepository restoreFromBackup: '${escapeString(serverPath)}'.
'${RESTORE_NO_LOGOUT_MARKER}'`;
}

// Finalizes a restore begun with restoreFromBackup:, run after reconnecting past
// the 4046 auto-logout. Makes the stone operational again. Evaluates to 'OK' on
// success so the (reconnected) non-blocking executor has a result to report.
export function commitRestoreCode(): string {
  return `SystemRepository commitRestore.
'OK'`;
}

// A human-readable description of the current restore state (restoreStatusInfo
// already answers a String, so it is fetched verbatim). Used to report progress
// and to confirm the stone is operational after commitRestore.
export function restoreStatusInfoCode(): string {
  return 'SystemRepository restoreStatusInfo';
}
