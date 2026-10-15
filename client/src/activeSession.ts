// Must stay free of `vscode` so the server-plugin scripts in `client/bin/`,
// which run under `tsx` outside the extension host with only a minimal
// `vscode` stub (see `install-server-plugin.mjs`), can import it.

import type { GciError, GciLibrary } from './gciLibrary';
import { GemStoneLogin, gemNrsFor, stoneNrsFor } from './loginTypes';
import type { TransactionMode } from './queries/transactionMode';

export class ActiveSession {
  enhancedInspectorAvailable?: boolean;
  /** Whether the server-side refactoring engine (GsRenameInstanceVariableRefactoring)
   *  is resolvable in this session's stone. Drives the `gemstone.rbSupportAvailable`
   *  context key and the Explorer's rename-instance-variable command. Latched at
   *  login (and re-probed after an install) — see refactoringAvailability.ts. */
  rbSupportAvailable?: boolean;
  /** `System myUserProfile symbolList`, memoized on first use — see
   *  `sessionSymbolListOop` in debugQueries.ts, which owns this field. */
  symbolListOop?: bigint;
  /** The session's GemStone transaction mode, as last read from the stone, or
   *  `undefined` when it has not been read (or could not be). Never assumed:
   *  `STN_GEM_INITIAL_TRANSACTION_MODE` lets a stone hand out any of the three
   *  at login. Owned by `SessionManager.refreshTransactionState`. */
  transactionMode?: TransactionMode;
  /** Whether the session was inside a transaction when the state was last read.
   *  This — not the mode — decides whether a commit can land. Owned by
   *  `SessionManager.refreshTransactionState`. */
  inTransaction?: boolean;
  /** Whether `GemAutoServiceSigAbort` has been armed on this session — set only
   *  once arming succeeds, so a failed attempt is retried on the next read that
   *  finds the session in `manualBegin`. Owned by `SessionManager`. */
  sigAbortArmed?: boolean;

  constructor(
    public id: number,
    public gci: GciLibrary,
    public handle: unknown,
    public login: GemStoneLogin,
    public stoneVersion: string,
  ) {}

  /**
   * Open a new GemStone login, as `login` describes, on this session's GCI
   * library. The library outlives its sessions' logouts, so this session may
   * already be logged out.
   *
   * Answers the new session, which has id -1 and is not registered anywhere,
   * or no session and GemStone's error when the login is refused. The caller
   * owns the new session and must log it out.
   */
  transientLogin(login: GemStoneLogin): { session: ActiveSession | undefined; err: GciError } {
    const result = this.gci.GciTsLogin(
      stoneNrsFor(login),
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrsFor(login),
      login.gs_user,
      login.gs_password,
      0,
      0,
    );
    if (!result.session) return { session: undefined, err: result.err };
    return {
      session: new ActiveSession(-1, this.gci, result.session, login, this.stoneVersion),
      err: result.err,
    };
  }

  GciTsLogout() {
    return this.gci.GciTsLogout(this.handle);
  }
}
