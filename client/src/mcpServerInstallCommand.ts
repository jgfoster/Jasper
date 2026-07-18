/**
 * Command Palette + at-connect entry points for installing the native GemStone
 * MCP server.
 *
 * Unlike the Enhanced Inspector installer, the `GsMcp*` payload adds only new
 * classes (no kernel-class extensions), so it needs no SystemUser — the install
 * runs over a short-lived session for the connection's OWN user on the same
 * connection, isolating its commit from the working session's uncommitted work.
 * After a successful install the working session is refreshed (so the classes
 * become visible) and the caller-supplied `launchServer` callback can boot the
 * managed server gem.
 *
 * The Command Palette entry (`runInstallMcpServer`) installs into the currently
 * selected session; the at-connect offer (`maybeOfferMcpServerInstall`) is driven
 * by the `gemstone.mcpServer.autoInstall` tri-state setting and shares the same
 * pipeline.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager } from './sessionManager';
import { refreshWorkingSession } from './systemUserSession';
import {
  installMcpServer,
  isMcpServerInstalled,
  supportsMcpServer,
  MCP_SERVER_FILES,
  MCP_SERVER_MIN_VERSION,
  messageOf,
} from './mcpServerInstall';

/** The `gemstone.mcpServer.autoInstall` setting values. */
export type AutoInstallMode = 'ask' | 'always' | 'never';

const AUTO_INSTALL_SETTING = 'mcpServer.autoInstall';

/** Boots the managed server gem after a successful install. Supplied by the
 *  caller (extension.ts), which resolves the GemStone install path and global
 *  dir; given the same password the install used, so the user isn't re-prompted. */
export type LaunchServerFn = (session: ActiveSession, password: string) => Promise<void>;

// Payload location relative to the extension root. `resources/` ships in the
// packaged VSIX, so this path resolves in both the F5 dev host and an installed
// extension.
const PAYLOAD_SUBDIR = path.join('resources', 'mcp-server');

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

/**
 * Open a transient session for `base`'s OWN user on the SAME GciLibrary,
 * reusing its connection coordinates and supplying `password`. Deliberately NOT
 * registered with the SessionManager: it bypasses the single-session policy and
 * never shows in the session UI. Caller logs it out.
 */
function loginAsCurrentUser(base: ActiveSession, password: string): ActiveSession {
  const { login } = base;
  const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
  const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;
  const result = base.gci.GciTsLogin(
    stoneNrs,
    login.host_user || null,
    login.host_password || null,
    false,
    gemNrs,
    login.gs_user,
    password,
    0,
    0,
  );
  if (!result.session) {
    throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
  }
  return {
    id: -1,
    gci: base.gci,
    handle: result.session,
    login: { ...login, gs_password: password },
    stoneVersion: base.stoneVersion,
  };
}

/**
 * Resolve the GemStone password for the install/launch. Uses the session's
 * stored password when present; otherwise, only when `interactive`, prompts for
 * it. Auto (non-interactive) with no stored password returns undefined so the
 * caller can explain the manual path rather than prompting unbidden.
 */
async function resolvePassword(
  base: ActiveSession,
  interactive: boolean,
): Promise<string | undefined> {
  if (base.login.gs_password) return base.login.gs_password;
  if (!interactive) return undefined;
  return vscode.window.showInputBox({
    prompt:
      `GemStone password for "${base.login.gs_user}" on "${base.login.stone}" ` +
      '(required to install the MCP server)',
    password: true,
    ignoreFocusOut: true,
  });
}

/**
 * Install (or reinstall) the native MCP server into the stone reached by `base`,
 * over a transient same-user session on the same connection. On success, offers
 * (interactive) or performs (auto) the server launch via `launchServer`.
 */
async function performInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
  launchServer: LaunchServerFn,
): Promise<void> {
  const payloadDir = path.join(extensionPath, PAYLOAD_SUBDIR);
  const missing = MCP_SERVER_FILES.filter((f) => !fs.existsSync(path.join(payloadDir, f)));
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `MCP server payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return;
  }

  const password = await resolvePassword(base, interactive);
  if (password === undefined) {
    // Interactive: user cancelled. Auto: no stored password — explain the manual
    // path rather than failing silently.
    if (!interactive) {
      vscode.window.showWarningMessage(
        'The native MCP server was not auto-installed: no stored GemStone password for this ' +
          'connection. Run "GemStone: Install Native MCP Server" to install it.',
      );
    }
    return;
  }

  let installSession: ActiveSession;
  try {
    installSession = loginAsCurrentUser(base, password);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Could not open an install session: ${messageOf(e)}`);
    return;
  }

  const reinstall = isMcpServerInstalled(base);
  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: reinstall
          ? 'Reinstalling the native MCP server…'
          : 'Installing the native MCP server…',
        cancellable: false,
      },
      async (progress) =>
        installMcpServer(installSession, payloadDir, (message, increment) =>
          progress.report({ message, increment }),
        ),
    );
  } finally {
    try {
      base.gci.GciTsLogout(installSession.handle);
    } catch {
      // The transient session is being discarded regardless.
    }
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`MCP server install failed: ${result.message}`);
    return;
  }

  await refreshWorkingSession(base, sessionManager, 'Native MCP server installed.');

  // Boot the managed gem. Auto mode starts it directly; interactive offers first.
  if (!interactive) {
    await launchServer(base, password);
    return;
  }
  const START = 'Start Server';
  const choice = await vscode.window.showInformationMessage(
    `${result.message} Start the MCP server now?`,
    START,
    'Later',
  );
  if (choice === START) await launchServer(base, password);
}

/**
 * Command Palette entry point: install into the currently selected session,
 * prompting for the password if none is stored, then offer to start the server.
 */
export async function runInstallMcpServer(
  sessionManager: SessionManager,
  extensionPath: string,
  launchServer: LaunchServerFn,
): Promise<void> {
  const base = sessionManager.getSelectedSession();
  if (!base) {
    vscode.window.showErrorMessage('No active GemStone session — connect to a stone first.');
    return;
  }
  if (!supportsMcpServer(base.stoneVersion)) {
    vscode.window.showErrorMessage(
      `The native MCP server requires GemStone ${MCP_SERVER_MIN_VERSION} or later. ` +
        `The stone "${base.login.stone}" is ${base.stoneVersion}.`,
    );
    return;
  }
  await performInstall(base, sessionManager, extensionPath, true, launchServer);
}

/**
 * Called when a session connects to a stone that lacks the native MCP server.
 * Consults `gemstone.mcpServer.autoInstall`:
 *  - `never`  → do nothing.
 *  - `always` → install automatically without prompting (reports a notification
 *               if no password is stored), then start the server.
 *  - `ask`    → offer to install. The buttons set the setting for next time:
 *               "Always"/"Never" persist that choice; "Install" installs once
 *               (leaving the setting at `ask`); dismissing does nothing.
 */
export async function maybeOfferMcpServerInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  launchServer: LaunchServerFn,
): Promise<void> {
  if (!supportsMcpServer(base.stoneVersion)) return;

  const mode = getAutoInstallMode();
  if (mode === 'never') return;
  if (mode === 'always') {
    await performInstall(base, sessionManager, extensionPath, false, launchServer);
    return;
  }

  const INSTALL = 'Install';
  const ALWAYS = 'Always';
  const NEVER = 'Never';
  const choice = await vscode.window.showInformationMessage(
    `Install the native GemStone MCP server on "${base.login.stone}"?`,
    {
      modal: true,
      detail:
        'Runs a Model Context Protocol server inside the image so AI clients can reach GemStone ' +
        'over plain HTTP — no Node.js bridge.\n\n' +
        'Installing commits the supporting classes to the database; the server then runs in its ' +
        'own gem.\n' +
        'Choose "Always" or "Never" to remember your choice for stones without it.',
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
    await performInstall(base, sessionManager, extensionPath, true, launchServer);
  }
  // Cancelled/dismissed — leave the setting at `ask` and do nothing.
}

// Human-readable label for each mode, reused by the picker.
const AUTO_INSTALL_MODES: { mode: AutoInstallMode; label: string; detail: string }[] = [
  {
    mode: 'ask',
    label: 'Ask on connect',
    detail: 'Offer to install when you connect to a stone that lacks it (default).',
  },
  {
    mode: 'always',
    label: 'Always install',
    detail:
      'Install automatically on connect when a stone lacks it, then start the server. Uses the ' +
      'connection\'s stored password; if none is stored, use "Ask" or the install command.',
  },
  {
    mode: 'never',
    label: 'Never',
    detail: 'Do not offer or install.',
  },
];

interface AutoInstallPick extends vscode.QuickPickItem {
  mode: AutoInstallMode;
}

// How long the confirmed selection stays visible in the picker before it closes.
const SELECTION_FLASH_MS = 900;

function autoInstallItems(selected: AutoInstallMode): AutoInstallPick[] {
  return AUTO_INSTALL_MODES.map((m) => ({
    label: m.mode === selected ? `$(check) ${m.label}` : m.label,
    detail: m.detail,
    mode: m.mode,
  }));
}

/**
 * Command Palette entry point: set the `gemstone.mcpServer.autoInstall`
 * preference from anywhere. Needs no session — it only writes a preference — so
 * it works before login too. Mirrors the enhanced inspector's picker: the chosen
 * mode is confirmed in place and lingers briefly, giving visible feedback even
 * where notification toasts are suppressed.
 */
export async function configureMcpServerAutoInstall(): Promise<void> {
  const current = getAutoInstallMode();
  const qp = vscode.window.createQuickPick<AutoInstallPick>();
  qp.title = 'Native MCP server: install automatically on connect?';
  qp.placeholder = 'Installing commits the supporting classes to the database.';
  qp.items = autoInstallItems(current);

  let settled = false;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  await new Promise<void>((resolve) => {
    qp.onDidAccept(async () => {
      if (settled) return;
      const picked = qp.selectedItems[0];
      if (!picked) {
        qp.hide();
        return;
      }
      settled = true;
      if (picked.mode !== current) {
        try {
          await setAutoInstallMode(picked.mode);
        } catch (e: unknown) {
          vscode.window.showErrorMessage(
            `Could not save the MCP server auto-install setting: ${messageOf(e)}`,
          );
          qp.hide();
          return;
        }
      }
      const label = AUTO_INSTALL_MODES.find((m) => m.mode === picked.mode)?.label ?? picked.mode;
      const confirmedItems = autoInstallItems(picked.mode);
      qp.items = confirmedItems;
      qp.activeItems = confirmedItems.filter((i) => i.mode === picked.mode);
      qp.title = `MCP server auto-install set to: ${label}`;
      qp.enabled = false;
      qp.busy = true;
      flashTimer = setTimeout(() => qp.hide(), SELECTION_FLASH_MS);
    });
    qp.onDidHide(() => {
      if (flashTimer) clearTimeout(flashTimer);
      qp.dispose();
      resolve();
    });
    qp.show();
  });
}
