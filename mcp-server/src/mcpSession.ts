import { GciLibrary, GciError } from '../../client/src/gciLibrary';
import { OOP_NIL, OOP_ILLEGAL } from '../../client/src/gciConstants';

const MAX_RESULT = 256 * 1024;

export interface McpSessionConfig {
  libraryPath: string;
  stoneNrs: string;
  gemNrs: string;
  gsUser: string;
  gsPassword: string;
  hostUser?: string;
  hostPassword?: string;
  /**
   * Smalltalk source replayed after every login — including reconnects after
   * the gem dies. Use for deterministic session setup (e.g. importlib
   * grailDir:, CPythonShim libraryPath:) that the user otherwise has to
   * re-paste manually after every crash.
   */
  initScripts?: string[];
}

/**
 * Thrown when an in-flight call detected a dead session, transparently
 * relogged in, and replayed the configured init scripts. The caller (or the
 * agent reading the tool error) should retry the request — any per-session
 * state set up beyond the init scripts is gone.
 */
export class SessionRestartedError extends Error {
  readonly previousStateLost = true;
  constructor(public readonly underlying: string) {
    super(
      `session died, restarted: ${underlying}. ` +
      'Previous session state was lost; init scripts were replayed. ' +
      'Retry your request.',
    );
    this.name = 'SessionRestartedError';
  }
}

// Detect a GCI error that means the gem is gone — broken pipe, fatal error,
// or one of the textual markers GCI surfaces when the netConnection is dead.
// We're deliberately liberal: false positives just trigger a fresh login,
// which is cheap relative to the alternative of surfacing an unrecoverable
// error to the agent.
const DEAD_SESSION_MARKERS = /netConnection|GemFatal|gem ?process|session ?not ?valid|not ?logged ?in/i;

export function isDeadSessionError(err: GciError): boolean {
  if (err.fatal !== 0) return true;
  return DEAD_SESSION_MARKERS.test(err.message || '');
}

export class McpSession {
  private gci: GciLibrary;
  private handle: unknown;
  private classUtf8Oop: bigint | undefined;

  constructor(private readonly config: McpSessionConfig) {
    this.gci = new GciLibrary(config.libraryPath);
    this.login();
  }

  // Perform a fresh login and (re)run init scripts. Called from the
  // constructor and from executeFetchString on a detected dead session.
  // Throws on login failure; the caller decides how to surface that.
  private login(): void {
    const { config } = this;
    const result = this.gci.GciTsLogin(
      config.stoneNrs,
      config.hostUser || null,
      config.hostPassword || null,
      false,
      config.gemNrs,
      config.gsUser,
      config.gsPassword,
      0, 0,
    );
    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }
    this.handle = result.session;
    // Utf8 OOPs are session-scoped — invalidate the cache so the next call
    // re-resolves against the new gem.
    this.classUtf8Oop = undefined;
    this.runInitScripts();
  }

  private runInitScripts(): void {
    const scripts = this.config.initScripts ?? [];
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      const oop = this.resolveClassUtf8OrThrow();
      const { err } = this.gci.GciTsExecuteFetchBytes(
        this.handle, script, -1, oop, OOP_ILLEGAL, OOP_NIL, MAX_RESULT,
      );
      if (err.number !== 0) {
        throw new Error(`init script ${i + 1} failed: ${err.message || `GCI error ${err.number}`}`);
      }
    }
  }

  private resolveClassUtf8OrThrow(): bigint {
    if (this.classUtf8Oop !== undefined) return this.classUtf8Oop;
    const { result, err } = this.gci.GciTsResolveSymbol(this.handle, 'Utf8', OOP_NIL);
    if (err.number !== 0) {
      throw new Error(err.message || 'Cannot resolve Utf8 class');
    }
    this.classUtf8Oop = result;
    return result;
  }

  executeFetchString(code: string): string {
    // Lazy-resolve the Utf8 class OOP; cached across calls and cleared on
    // reconnect. Surface dead-session errors from the resolve step the same
    // way as from execute.
    if (this.classUtf8Oop === undefined) {
      const r = this.gci.GciTsResolveSymbol(this.handle, 'Utf8', OOP_NIL);
      if (r.err.number !== 0 || r.err.fatal !== 0) this.handleErrOrReconnect(r.err);
      this.classUtf8Oop = r.result;
    }
    const { data, err } = this.gci.GciTsExecuteFetchBytes(
      this.handle, code, -1, this.classUtf8Oop, OOP_ILLEGAL, OOP_NIL, MAX_RESULT,
    );
    // Check fatal in addition to number — a broken-pipe / dead-gem signal can
    // arrive with fatal=1 and number=0 (transport-level failure, not a
    // Smalltalk error). Skipping fatal here would mask the very condition we
    // need to detect for auto-reconnect.
    if (err.number !== 0 || err.fatal !== 0) this.handleErrOrReconnect(err);
    return data;
  }

  // Either throw a plain error for normal GCI failures (MNU, ZeroDivide,
  // etc.) or, when the error indicates the gem is gone, transparently
  // relog in and throw SessionRestartedError so the caller can retry.
  private handleErrOrReconnect(err: GciError): never {
    if (isDeadSessionError(err)) {
      const original = err.message || `GCI error ${err.number}`;
      try {
        this.login();
      } catch (loginErr) {
        throw new Error(
          `session died (${original}); reconnect failed: ${(loginErr as Error).message}`,
        );
      }
      throw new SessionRestartedError(original);
    }
    throw new Error(err.message || `GCI error ${err.number}`);
  }

  logout(): void {
    try {
      this.gci.GciTsLogout(this.handle);
    } catch {
      // Session may already be dead
    }
  }
}
