/**
 * Command Palette entry point for installing Enhanced Inspector support.
 *
 * The payload installs persistent classes (into Published) plus extension
 * methods on kernel classes, which requires write access to those kernel
 * classes — i.e. SystemUser. The user is normally logged in as DataCurator, so
 * this command opens a short-lived, unregistered SystemUser session on the same
 * connection, runs the install over it, commits, logs it out, and then offers
 * to refresh the working session so the new code becomes visible.
 *
 * The Command Palette entry (`runInstallEnhancedInspector`) installs into the
 * currently selected session and prompts for the SystemUser password if the
 * default is not accepted. The at-connect offer (`maybeOfferEnhancedInspectorInstall`,
 * Phase 3) is driven by the `gemstone.enhancedInspector.autoInstall` tri-state
 * setting and shares the same install pipeline.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { refreshGtAvailable } from './gtAvailability';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  ENHANCED_INSPECTOR_FILES,
  messageOf,
} from './enhancedInspectorInstall';

/** The `gemstone.enhancedInspector.autoInstall` setting values. */
export type AutoInstallMode = 'ask' | 'always' | 'never';

const AUTO_INSTALL_SETTING = 'enhancedInspector.autoInstall';

function getAutoInstallMode(): AutoInstallMode {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<AutoInstallMode>(AUTO_INSTALL_SETTING, 'ask');
}

function setAutoInstallMode(mode: AutoInstallMode): Thenable<void> {
  return vscode.workspace
    .getConfiguration('gemstone')
    .update(AUTO_INSTALL_SETTING, mode, vscode.ConfigurationTarget.Global);
}

// GemStone's default SystemUser password. Tried first so a stock stone installs
// in one step; on failure we prompt. (Phase 3 may replace this with the
// connection's configured credentials.)
const DEFAULT_SYSTEMUSER_PASSWORD = 'swordfish';

// Payload location relative to the extension root. This resolves under the repo
// in the F5 dev host; shipping the .gs files in a packaged VSIX (docs/** is
// .vscodeignore'd) is a separate, Phase-4 packaging task.
const PAYLOAD_SUBDIR = path.join('docs', 'gtSupport');

/**
 * Open a transient SystemUser session on the SAME GciLibrary as `base`,
 * reusing its connection coordinates and overriding only the GemStone user.
 * Deliberately NOT registered with the SessionManager: it bypasses the
 * single-session policy and never shows in the session UI. Caller logs it out.
 */
function loginAsSystemUser(base: ActiveSession, password: string): ActiveSession {
  const { login } = base;
  const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
  const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;
  const result = base.gci.GciTsLogin(
    stoneNrs,
    login.host_user || null,
    login.host_password || null,
    false,
    gemNrs,
    'SystemUser',
    password,
    0, 0,
  );
  if (!result.session) {
    throw new Error(result.err.message || `SystemUser login failed (error ${result.err.number})`);
  }
  return {
    id: -1,
    gci: base.gci,
    handle: result.session,
    login: { ...login, gs_user: 'SystemUser', gs_password: password },
    stoneVersion: base.stoneVersion,
  };
}

/**
 * Obtain a SystemUser session on `base`'s connection. Tries the stock default
 * password first. When `interactive` is false (the auto-install path, where no
 * user gesture initiated this), a rejected default is a silent miss — the caller
 * decides how to surface it — rather than a password prompt the user never asked
 * for.
 */
async function obtainSystemUserSession(
  base: ActiveSession,
  interactive: boolean,
): Promise<ActiveSession | undefined> {
  try {
    return loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PASSWORD);
  } catch {
    // Default password rejected — fall through and ask for it.
  }
  if (!interactive) return undefined;
  const password = await vscode.window.showInputBox({
    prompt: `SystemUser password for "${base.login.stone}" (required to install enhanced inspector support)`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return undefined; // user cancelled
  try {
    return loginAsSystemUser(base, password);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Could not log in as SystemUser: ${messageOf(e)}`);
    return undefined;
  }
}

/**
 * The working session won't see the newly-committed classes until its view is
 * refreshed (an abort). When the session has no uncommitted work — always the
 * case right after a login, which is when the offer fires — there is nothing to
 * lose, so refresh silently and the installed code appears immediately without a
 * prompt to dismiss. Only when there ARE uncommitted changes (e.g. the install
 * was run by hand mid-session) do we ask first, since the abort would discard
 * them.
 */
async function refreshWorkingSessionAfterInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
): Promise<boolean> {
  // Tri-state: true = pending work, false = clean, undefined = couldn't tell.
  let needsCommit: boolean | undefined;
  try {
    needsCommit =
      executeFetchString(base, 'needsCommit', 'System needsCommit printString').trim() === 'true';
  } catch {
    // The probe failed (e.g. the session is busy). Leave it undefined and
    // prompt below rather than risk a silent abort that discards work.
    needsCommit = undefined;
  }

  // Definitely clean (always the case right after login): refresh silently so
  // the installed code appears immediately.
  if (needsCommit === false) {
    return safeAbortWorkingSession(base, sessionManager);
  }

  // Pending work, or we couldn't tell — ask first, since the abort discards
  // uncommitted changes.
  const detail = needsCommit
    ? 'This discards this session’s uncommitted changes.'
    : 'Any uncommitted changes in this session will be discarded.';
  const choice = await vscode.window.showInformationMessage(
    `Enhanced inspector installed. Refresh this session to load it? ${detail}`,
    'Refresh',
    'Later',
  );
  if (choice === 'Refresh') {
    return safeAbortWorkingSession(base, sessionManager);
  }
  return false;
}

/**
 * Abort (refresh) the working session, tolerating a session that was logged out
 * while the install ran (the progress notification is non-modal). Returns true
 * only when the view was actually refreshed, so the caller relatches
 * `gtAvailable` only on a real refresh.
 */
function safeAbortWorkingSession(base: ActiveSession, sessionManager: SessionManager): boolean {
  try {
    return sessionManager.abort(base.id).success;
  } catch {
    // The session is gone (sessionManager.abort throws for an unknown id) — there
    // is nothing to refresh, and nothing to fail over.
    return false;
  }
}

/**
 * Install (or reinstall) Enhanced Inspector support into the stone reached by
 * `base`, over a transient SystemUser session on the same connection. Always
 * re-files-in — presence is not a gate.
 *
 * When `interactive` is false (the auto-install path), a missing SystemUser
 * default password is reported as a non-blocking notification rather than a
 * password prompt, and the caller is not asked anything it didn't initiate.
 */
async function performInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<void> {
  const payloadDir = path.join(extensionPath, PAYLOAD_SUBDIR);
  const missing = ENHANCED_INSPECTOR_FILES.filter(
    (f) => !fs.existsSync(path.join(payloadDir, f)),
  );
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `Enhanced inspector payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return;
  }

  const reinstall = isEnhancedInspectorInstalled(base);

  const sys = await obtainSystemUserSession(base, interactive);
  if (!sys) {
    // Interactive: the user cancelled or the failure was already reported.
    // Auto: the default password was not accepted — explain how to proceed
    // manually rather than failing silently.
    if (!interactive) {
      vscode.window.showWarningMessage(
        'Enhanced inspector support was not auto-installed: the SystemUser default password was '
          + 'not accepted. Run "GemStone: Install Enhanced Inspector Support" to install it.',
      );
    }
    return;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: reinstall
          ? 'Reinstalling enhanced inspector support…'
          : 'Installing enhanced inspector support…',
        cancellable: false,
      },
      async (progress) =>
        installEnhancedInspectorSupport(sys, payloadDir, (message, increment) =>
          progress.report({ message, increment }),
        ),
    );
  } finally {
    try {
      base.gci.GciTsLogout(sys.handle);
    } catch {
      // The transient session is being discarded regardless.
    }
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Enhanced inspector install failed: ${result.message}`);
    return;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager);
  if (refreshed) refreshGtAvailable(base);
}

/**
 * Command Palette entry point: install into the currently selected session,
 * prompting for the SystemUser password if the default is not accepted.
 */
export async function runInstallEnhancedInspector(
  sessionManager: SessionManager,
  extensionPath: string,
): Promise<void> {
  const base = sessionManager.getSelectedSession();
  if (!base) {
    vscode.window.showErrorMessage('No active GemStone session — connect to a stone first.');
    return;
  }
  await performInstall(base, sessionManager, extensionPath, true);
}

/**
 * Called when a session connects to a stone that lacks Enhanced Inspector
 * support. Consults `gemstone.enhancedInspector.autoInstall`:
 *  - `never`  → do nothing.
 *  - `always` → install automatically, without prompting (a non-interactive
 *               install; reports a notification if SystemUser is unavailable).
 *  - `ask`    → offer to install. The buttons set the setting for next time:
 *               "Always" / "Never" persist that choice; "Install" installs once
 *               (leaving the setting at `ask`); dismissing does nothing.
 */
export async function maybeOfferEnhancedInspectorInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
): Promise<void> {
  const mode = getAutoInstallMode();
  if (mode === 'never') return;
  if (mode === 'always') {
    await performInstall(base, sessionManager, extensionPath, false);
    return;
  }

  const INSTALL = 'Install';
  const ALWAYS = 'Always';
  const NEVER = 'Never';
  // Modal, not a toast: this is a one-time setup decision and a non-modal
  // notification is too easily missed (it auto-hides and is suppressed under
  // Do Not Disturb). "Not now" is the modal's dismiss action.
  const choice = await vscode.window.showInformationMessage(
    `Install enhanced inspector support on "${base.login.stone}"?`,
    {
      modal: true,
      detail:
        'Brings a Smalltalk-style inspector to Jasper — rich, object-specific views instead '
        + 'of a plain list of instance variables, so you can explore more deeply.\n\n'
        + 'Installing requires a SystemUser login and commits the supporting classes to the '
        + 'database.\n'
        + 'Choose "Always" or "Never" to remember your choice for stones without it.',
    },
    INSTALL,
    ALWAYS,
    NEVER,
  );
  if (choice === NEVER) {
    await setAutoInstallMode('never');
    return;
  }
  if (choice === ALWAYS) {
    await setAutoInstallMode('always');
  }
  if (choice === INSTALL || choice === ALWAYS) {
    await performInstall(base, sessionManager, extensionPath, true);
  }
  // Cancelled/dismissed ("not now") — leave the setting at `ask` and do nothing.
}
