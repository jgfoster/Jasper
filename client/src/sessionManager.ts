import * as vscode from 'vscode';
import { GciLibrary, GciError } from './gciLibrary';
import { OOP_NIL } from './gciConstants';
import { GemStoneLogin, loginLabel } from './loginTypes';
import { logInfo } from './gciLog';
import { wrapWithGtPerfProxy } from './gtPerfTracker';

export interface ActiveSession {
  id: number;
  gci: GciLibrary;
  handle: unknown;
  login: GemStoneLogin;
  stoneVersion: string;
  gtAvailable?: boolean;
}

/**
 * Decide whether a new login may proceed given the current session count.
 * Returns an error message to show the user, or null when the login is allowed.
 *
 * Pure (no VS Code / GCI dependencies) so the policy can be unit-tested directly.
 * Single mode (the default) caps the extension at one session; multiple mode
 * still blocks a second session when a custom export path lacks {session}, since
 * concurrent sessions would otherwise overwrite each other's exported files.
 */
export function evaluateLoginPolicy(
  mode: string,
  existingCount: number,
  exportPath: string,
): string | null {
  if (existingCount === 0) return null;
  if (mode !== 'multiple') {
    return (
      'Only one GemStone session is allowed at a time. Log out of the current session before ' +
      'logging in again. (Set "gemstone.sessionMode": "multiple" to enable concurrent sessions.)'
    );
  }
  if (exportPath && !exportPath.includes('{session}')) {
    return (
      'Only one session is allowed when the export path does not include {session}. ' +
      'Log out of the current session before logging in again, or add {session} to your export path.'
    );
  }
  return null;
}

export class SessionManager {
  private sessions = new Map<number, ActiveSession>();
  private gciInstances = new Map<string, GciLibrary>();
  private nextId = 1;

  private _selectedId: number | null = null;
  private _onDidChangeSelection = new vscode.EventEmitter<number | null>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  get selectedId(): number | null {
    return this._selectedId;
  }

  selectSession(id: number): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    this._selectedId = id;
    this._onDidChangeSelection.fire(id);
    vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', true);
  }

  getSession(id: number): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  getSelectedSession(): ActiveSession | undefined {
    if (this._selectedId !== null) {
      return this.sessions.get(this._selectedId);
    }
    return undefined;
  }

  async resolveSession(): Promise<ActiveSession | undefined> {
    const selected = this.getSelectedSession();
    if (selected) return selected;

    const sessions = this.getSessions();
    if (sessions.length === 0) {
      vscode.window.showErrorMessage('No GemStone sessions are active. Please log in first.');
      return undefined;
    }
    if (sessions.length === 1) {
      this.selectSession(sessions[0].id);
      return sessions[0];
    }

    const items = sessions.map(s => ({
      label: loginLabel(s.login),
      description: `Session ${s.id}`,
      session: s,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a GemStone session for code execution',
    });
    if (!pick) return undefined;
    this.selectSession(pick.session.id);
    return pick.session;
  }

  private getGciLibrary(libraryPath: string): GciLibrary {
    let gci = this.gciInstances.get(libraryPath);
    if (!gci) {
      gci = wrapWithGtPerfProxy(new GciLibrary(libraryPath));
      this.gciInstances.set(libraryPath, gci);
    }
    return gci;
  }

  login(login: GemStoneLogin, libraryPath: string): ActiveSession {
    // Single mode (the default) allows one session at a time; multiple mode still
    // guards against export-path conflicts. See evaluateLoginPolicy.
    const config = vscode.workspace.getConfiguration('gemstone');
    const mode = config.get<string>('sessionMode', 'single');
    const customPath = config.get<string>('exportPath', '').trim();
    const policyError = evaluateLoginPolicy(mode, this.sessions.size, customPath);
    if (policyError) {
      throw new Error(policyError);
    }

    const gci = this.getGciLibrary(libraryPath);

    const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
    const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;

    const result = gci.GciTsLogin(
      stoneNrs,
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrs,
      login.gs_user,
      login.gs_password,
      0, 0,
    );

    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }

    const { version } = gci.GciTsVersion();

    const session: ActiveSession = {
      id: this.nextId++,
      gci,
      handle: result.session,
      login,
      stoneVersion: version,
      gtAvailable: false,
    };

    this.sessions.set(session.id, session);
    logInfo(`[Session ${session.id}] Logged in: ${login.gs_user}@${login.gem_host}/${login.stone} (${version})`);

    // Auto-select when this is the only session
    if (this.sessions.size === 1) {
      this.selectSession(session.id);
    }

    return session;
  }

  logout(id: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    logInfo(`[Session ${id}] Logging out: ${s.login.gs_user}@${s.login.gem_host}/${s.login.stone}`);
    try {
      s.gci.GciTsLogout(s.handle);
    } catch {
      // Session may already be dead — remove it regardless
    }
    this.sessions.delete(id);

    if (this._selectedId === id) {
      this._selectedId = null;
      if (this.sessions.size === 1) {
        const remaining = this.sessions.values().next().value!;
        this.selectSession(remaining.id);
      } else {
        this._onDidChangeSelection.fire(null);
        vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', this.sessions.size > 0);
      }
    }
  }

  commit(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsCommit(s.handle);
  }

  abort(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsAbort(s.handle);
  }

  /**
   * Confirm the session is alive and responsive by forcing a round-trip to the
   * gem without compiling or executing Smalltalk: fetch the instVar count of
   * nil (a low-level GCI call). Returns cleanly when the session responds.
   */
  ping(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    const { err } = s.gci.GciTsFetchSize(s.handle, OOP_NIL);
    return { success: err.number === 0, err };
  }

  getSessions(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      try { s.gci.GciTsLogout(s.handle); } catch { /* ignore */ }
    }
    this.sessions.clear();
    for (const gci of this.gciInstances.values()) {
      try { gci.close(); } catch { /* ignore */ }
    }
    this.gciInstances.clear();
    this._onDidChangeSelection.dispose();
  }
}
