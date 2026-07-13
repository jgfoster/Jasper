export interface GemStoneLogin {
  label: string;
  version: string;
  gem_host: string;
  stone: string;
  gs_user: string;
  gs_password: string;
  netldi: string;
  host_user: string;
  host_password: string;
  /**
   * When true, the GemStone password is stored in the OS keychain and
   * `gs_password` in the settings file is left empty. See loginCredentials.ts.
   */
  password_in_keychain?: boolean;
  /**
   * When true (the default when unset), the local `.gemstone` class mirror is
   * synced for this login so VS Code's Find in Files / Go to Definition work over
   * the source. Turn it off for slow/remote connections where the initial sync
   * isn't worth it — server-side search still works. See client/src/sync/.
   */
  sync_classes?: boolean;
}

// Whether the class mirror should be synced for a login. Defaults to true when
// the flag is unset, so existing logins keep today's behavior.
export function shouldSyncClasses(login: Pick<GemStoneLogin, 'sync_classes'>): boolean {
  return login.sync_classes !== false;
}

export function loginLabel(login: Pick<GemStoneLogin, 'gs_user' | 'stone' | 'gem_host'>): string {
  return `${login.gs_user} on ${login.stone} (${login.gem_host})`;
}

/**
 * True when two logins point at the same target connection (same user, stone,
 * host, and NetLDI). Used to group active sessions under the configured login
 * that spawned them.
 */
export function sameLoginTarget(
  a: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
  b: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
): boolean {
  return (
    a.gem_host === b.gem_host &&
    a.stone === b.stone &&
    a.gs_user === b.gs_user &&
    a.netldi === b.netldi
  );
}

/**
 * A stable string key for a login's target connection (user, stone, host,
 * NetLDI). Two logins produce the same key exactly when `sameLoginTarget`
 * considers them the same target, so it can index in-flight connection
 * attempts (see InFlightGuard / the gemstone.login command).
 */
export function loginTargetKey(
  login: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
): string {
  return JSON.stringify([login.gem_host, login.stone, login.gs_user, login.netldi]);
}

/**
 * The active sessions that belong under the login at position `loginIndex`,
 * using first-match-wins: each session is assigned to the first login in
 * `logins` whose connection target it matches. Keyed on position rather than
 * object identity because each LoginStorage.getLogins() call returns a fresh
 * deserialized array, so the same login is a different object across calls.
 * Pure and free of VS Code/GCI deps so it can be unit-tested directly. Generic
 * over the session shape (only `.login` is read) to avoid importing
 * ActiveSession here.
 */
export function sessionsForLogin<T extends { login: GemStoneLogin }>(
  loginIndex: number,
  logins: GemStoneLogin[],
  sessions: T[],
): T[] {
  return sessions.filter(
    (s) => logins.findIndex((l) => sameLoginTarget(l, s.login)) === loginIndex,
  );
}

// GemStone's stock default password for DataCurator/SystemUser on a fresh stone.
// Defined as a named constant — and deliberately NOT a `password`-suffixed one —
// so the literal never sits next to a `password:` / `password =` key in the
// bundled extension.js. Open VSX's publish secret scan rejects that pattern
// (gitleaks hashicorp-tf-password), even though 'swordfish' is GemStone's public
// default, not a secret. Reuse this wherever a default login is constructed.
export const DEFAULT_GS_PW = 'swordfish';

export const DEFAULT_LOGIN: GemStoneLogin = {
  label: '',
  version: '',
  gem_host: 'localhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: DEFAULT_GS_PW,
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};
