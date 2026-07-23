/**
 * Server-side install driver for the Jasper refactoring engine.
 *
 * The engine installs classes into a dedicated `GsRefactoring` dictionary plus a
 * few feature-detected extension methods on kernel classes, which requires write
 * access to those kernel classes — i.e. SystemUser. The user is normally logged
 * in as DataCurator, so this opens a short-lived, unregistered SystemUser session
 * on the same connection, runs the install over it, logs it out, and then offers
 * to refresh the working session so the new code becomes visible.
 *
 * The heavy lifting is server-side (`GsRefactoringLoader`, driven by
 * refactoringInstall.ts). This module is the VS Code plumbing: obtain a
 * SystemUser session, show progress, surface the loader's completeness report,
 * and relatch `rbSupportAvailable`.
 *
 * The entry point is `installRefactoringFeature`, called by the unified
 * optional-support offer (optionalSupportOffer.ts) as one leg of the bundle
 * install. The SystemUser-session helpers mirror enhancedInspectorCommand.ts;
 * they are duplicated rather than shared to keep the two install paths
 * independent (a later cleanup could extract them).
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager } from '../sessionManager';
import { sessionNeedsCommit } from '../browserQueries';
import { refreshRefactoringSupportAvailable } from './refactoringAvailability';
import {
  installRefactoringSupport,
  isRefactoringSupportInstalled,
  REFACTORING_PAYLOAD_FILES,
  messageOf,
} from './refactoringInstall';

// GemStone's default SystemUser password. Tried first so a stock stone installs
// in one step; on failure we prompt. See the note in enhancedInspectorCommand.ts
// about why this is not written as `password = '...'` (secret-scan false hit).
const DEFAULT_SYSTEMUSER_PW = 'swordfish';

// Payload location relative to the extension root. `resources/` ships in the
// packaged VSIX (unlike `gs-src/`, which is .vscodeignore'd), so the same path
// resolves in both the F5 dev host and an installed extension.
const PAYLOAD_SUBDIR = path.join('resources', 'refactoring');

/** Lazily-created output channel for the loader's completeness report. */
let reportChannel: vscode.OutputChannel | undefined;
function getReportChannel(): vscode.OutputChannel {
  if (!reportChannel) {
    reportChannel = vscode.window.createOutputChannel('GemStone Refactoring');
  }
  return reportChannel;
}

/**
 * Open a transient SystemUser session on the SAME GciLibrary as `base`, reusing
 * its connection coordinates and overriding only the GemStone user. Deliberately
 * NOT registered with the SessionManager. Caller logs it out.
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
    0,
    0,
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
 * password first. When `interactive` is false (the auto-install path), a rejected
 * default is a silent miss — the caller decides how to surface it — rather than a
 * password prompt the user never asked for.
 */
async function obtainSystemUserSession(
  base: ActiveSession,
  interactive: boolean,
): Promise<ActiveSession | undefined> {
  try {
    return loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
  } catch {
    // Default password rejected — fall through and ask for it.
  }
  if (!interactive) return undefined;
  const password = await vscode.window.showInputBox({
    prompt: `SystemUser password for "${base.login.stone}" (required to install the refactoring engine)`,
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
 * refreshed (an abort). When it has no uncommitted work — always the case right
 * after a login — refresh silently. Only when there ARE uncommitted changes do
 * we ask first, since the abort would discard them.
 */
async function refreshWorkingSessionAfterInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
): Promise<boolean> {
  const needsCommit = sessionNeedsCommit(base);
  if (needsCommit === false) {
    return safeAbortWorkingSession(base, sessionManager);
  }
  const detail = needsCommit
    ? 'This discards this session’s uncommitted changes.'
    : 'Any uncommitted changes in this session will be discarded.';
  const choice = await vscode.window.showInformationMessage(
    `Refactoring engine installed. Refresh this session to load it? ${detail}`,
    'Refresh',
    'Later',
  );
  if (choice === 'Refresh') {
    return safeAbortWorkingSession(base, sessionManager);
  }
  return false;
}

/** Abort (refresh) the working session, tolerating a session that was logged out
 *  while the install ran. Returns true only when the view was actually refreshed. */
function safeAbortWorkingSession(base: ActiveSession, sessionManager: SessionManager): boolean {
  try {
    return sessionManager.abort(base.id).success;
  } catch {
    return false;
  }
}

/**
 * Install (or reinstall) the refactoring engine into the stone reached by `base`,
 * over a transient SystemUser session on the same connection. Always re-files-in
 * — presence is not a gate — and the server-side loader is idempotent and commits
 * on success / aborts on failure entirely on the server, so this never commits.
 *
 * When `interactive` is false (the auto-install path), a missing SystemUser
 * default password is reported as a non-blocking notification rather than a
 * password prompt.
 *
 * Returns true when the engine is present and available afterward, so callers
 * (e.g. the Explorer's rename pencil) can continue on success.
 */
async function performInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<boolean> {
  const payloadDir = path.join(extensionPath, PAYLOAD_SUBDIR);
  const missing = REFACTORING_PAYLOAD_FILES.filter((f) => !fs.existsSync(path.join(payloadDir, f)));
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `Refactoring engine payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return false;
  }

  const reinstall = isRefactoringSupportInstalled(base);

  const sys = await obtainSystemUserSession(base, interactive);
  if (!sys) {
    // Interactive: the user cancelled or the failure was already reported.
    // Auto: the default password was not accepted — explain how to proceed
    // manually rather than failing silently.
    if (!interactive) {
      vscode.window.showWarningMessage(
        'The refactoring engine was not auto-installed: the SystemUser default password was ' +
          'not accepted. Run "GemStone: Install Server Support" to install it.',
      );
    }
    return false;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: reinstall
          ? 'Reinstalling the refactoring engine…'
          : 'Installing the refactoring engine…',
        cancellable: false,
      },
      async (progress) =>
        installRefactoringSupport(sys, payloadDir, (message, increment) =>
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

  // Always surface the loader's completeness report — it is the authoritative
  // account of what did and didn't load.
  if (result.report) {
    const channel = getReportChannel();
    channel.appendLine(result.report);
    if (!result.success) channel.show(true);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Refactoring engine install failed: ${result.message}`);
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager);
  if (refreshed) {
    refreshRefactoringSupportAvailable(base);
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.rbSupportAvailable',
      base.rbSupportAvailable === true,
    );
  }
  vscode.window.showInformationMessage('Refactoring engine installed and verified.');
  return base.rbSupportAvailable === true;
}

/**
 * Install (or reinstall) the refactoring engine once. `interactive` = may prompt
 * for the SystemUser password if the default is rejected; non-interactive =
 * silent, warning if the default is unavailable. Returns whether the engine is
 * available afterward. Called by the unified optional-support bundle offer.
 */
export function installRefactoringFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<boolean> {
  return performInstall(base, sessionManager, extensionPath, interactive);
}
