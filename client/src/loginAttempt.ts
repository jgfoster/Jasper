import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GemStoneLogin } from './loginTypes';
import type { ActiveSession } from './sessionManager';
import type { LoginOutcome } from './telemetry';
import { bundledWindowsClientGciPath, bundledGciArchSupported } from './bundledGci';
import { showInstallOutcome } from './manager/versionManager';

/** What {@link attemptLogin} needs from the extension's storage, installers and connect UI. */
export interface LoginAttemptDeps {
  keychainPassword(login: GemStoneLogin): Promise<string | undefined>;
  getGciLibraryPath(version: string): string | undefined;
  setGciLibraryPath(version: string, gciPath: string): Promise<void>;
  removeGciLibraryPath(version: string): Promise<void>;
  getGemstonePath(version: string): string | undefined;
  /** The library in the version's client files, if they are on disk. */
  getClientGciPath(version: string): string | undefined;
  getRootPath(): string;
  /** Download just what a login to `version` needs, not the server. */
  downloadAndExtractClient(
    version: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void>;
  refreshVersions(): void;
  /** Undefined when the login failed, after the failure has been shown. */
  connect(login: GemStoneLogin, gciPath: string): Promise<ActiveSession | undefined>;
  connected(login: GemStoneLogin, session: ActiveSession): void;
}

/**
 * The gemstone.login command: collect any missing passwords, find a GCI library
 * for the login's version, then connect. Resolves to the outcome the command
 * reports, so every exit is tied to the outcome it stands for.
 */
export async function attemptLogin(
  original: GemStoneLogin,
  deps: LoginAttemptDeps,
): Promise<LoginOutcome> {
  const login = { ...original };

  // If the login is configured to use the OS keychain, fetch the password
  // from there. Fall through to the prompt if the keychain entry is missing.
  if (login.password_in_keychain && !login.gs_password) {
    const stored = await deps.keychainPassword(login);
    if (stored) {
      login.gs_password = stored;
    }
  }

  if (!login.gs_password) {
    const password = await vscode.window.showInputBox({
      prompt: `GemStone password for ${login.gs_user || 'user'}@${login.gem_host || 'host'}`,
      password: true,
    });
    if (password === undefined) {
      return 'cancelled';
    }
    login.gs_password = password;
  }

  if (!login.host_password && login.host_user) {
    const password = await vscode.window.showInputBox({
      prompt: `Host password for ${login.host_user}@${login.gem_host || 'host'}`,
      password: true,
    });
    if (password === undefined) {
      return 'cancelled';
    }
    login.host_password = password;
  }

  // Ensure GCI library is configured for this version
  let gciPath = deps.getGciLibraryPath(login.version);
  const savedProblem = gciPath ? gciLibraryProblem(gciPath) : undefined;
  let choice: string | undefined;
  // Where the file picker starts: by the broken saved path, if there is one.
  let browseFrom: string | undefined;

  if (gciPath && savedProblem) {
    // The user chose this library, so Jasper never swaps in another one
    // unasked: it says what it found and lets them pick.
    const saved = gciPath;
    gciPath = undefined;
    browseFrom = nearestExistingFolder(saved);
    const found = findGciLibrary(login.version, deps);
    const use = 'Use Suggested Library';
    const edit = 'Edit Setting';
    const answer = await vscode.window.showWarningMessage(
      `The GCI library saved for GemStone ${login.version} ${savedProblem}.`,
      {
        modal: true,
        detail:
          `Saved path: ${saved}\n\n` +
          (found
            ? `Jasper found a GemStone ${login.version} library at:\n${found}`
            : `Jasper found no other GemStone ${login.version} library on this machine.`),
      },
      ...(found ? [use, 'Browse...', edit] : ['Download', 'Browse...', edit]),
    );
    if (!answer) {
      return 'cancelled';
    }
    if (answer === edit) {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'gemstone.gciLibraries');
      return 'cancelled';
    }
    if (found && answer === use) {
      gciPath = found;
      await deps.setGciLibraryPath(login.version, found);
    } else {
      choice = answer;
    }
  } else if (!gciPath) {
    if (
      process.platform === 'win32' &&
      bundledWindowsClientGciPath(login.version) &&
      !bundledGciArchSupported()
    ) {
      // The bundled DLLs are x64; an ARM64 VS Code process cannot load
      // them. Guide the user to the x64 build instead of letting the
      // native loader fail with a cryptic architecture-mismatch error.
      vscode.window.showErrorMessage(
        `The GemStone ${login.version} client library bundled with Jasper is x64, but VS Code is ` +
          `running as ${process.arch}. Install and run the x64 build of VS Code (it runs under ` +
          `emulation on Windows on ARM) to use the bundled library.`,
      );
      return 'noClientLibrary';
    }
    gciPath = findGciLibrary(login.version, deps);

    // Nothing for this version on the machine yet: offer to fetch the few files
    // a login needs before falling back to the manual file picker.
    if (!gciPath) {
      if (!login.version || !login.version.trim()) {
        vscode.window.showErrorMessage(
          'This login has no GemStone version set. Edit the login to choose the version of the stone you are connecting to.',
        );
        return 'noClientLibrary';
      }
      choice = await vscode.window.showInformationMessage(
        `Jasper needs a few files to talk to GemStone ${login.version}. Download them now?`,
        'Download',
        'Browse...',
      );
      if (!choice) {
        return 'noClientLibrary';
      }
    }
  }

  if (choice === 'Download') {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading the files for GemStone ${login.version}...`,
          cancellable: true,
        },
        (progress, token) => deps.downloadAndExtractClient(login.version, progress, token),
      );
      // Not registered: found again through getClientGciPath, so a full install
      // added later still wins and a removed folder is offered for download again.
      gciPath = deps.getClientGciPath(login.version);
      deps.refreshVersions();
    } catch (e) {
      showInstallOutcome(e, `Downloading the files for GemStone ${login.version} failed`);
      return 'noClientLibrary';
    }
    if (savedProblem) {
      // For the same reason, the broken saved path goes rather than being replaced.
      await deps.removeGciLibraryPath(login.version);
    }
  }

  if (!gciPath) {
    const filters: Record<string, string[]> =
      process.platform === 'win32'
        ? { 'DLL files': ['dll'] }
        : process.platform === 'darwin'
          ? { 'Dynamic libraries': ['dylib'] }
          : { 'Shared libraries': ['so'] };

    const ext =
      process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
    const expectedName = `libgcits-${login.version}-64.${ext}`;

    const result = await vscode.window.showOpenDialog({
      title: `Select GCI library (${expectedName}) for GemStone ${login.version}`,
      canSelectMany: false,
      filters,
      defaultUri: browseFrom ? vscode.Uri.file(browseFrom) : undefined,
    });
    if (!result || result.length === 0) {
      return 'noClientLibrary';
    }
    gciPath = result[0].fsPath;

    const selectedName = gciPath.split(/[\\/]/).pop();
    const libPattern = /^libgcits-[\d.]+.*-64\.\w+$/;
    if (!libPattern.test(selectedName || '')) {
      const pick = await vscode.window.showWarningMessage(
        `Selected file "${selectedName}" does not match expected pattern "${expectedName}". Use it anyway?`,
        'Yes',
        'No',
      );
      if (pick !== 'Yes') {
        return 'noClientLibrary';
      }
    }
    await deps.setGciLibraryPath(login.version, gciPath);
  }

  // The in-process GCI library reads GEMSTONE_GLOBAL_DIR to find the
  // NetLDI lock file (which encodes the port it is listening on).
  // Set both variables from sysadminStorage so the login can succeed
  // even though the VSCode/Electron process doesn't inherit them.
  process.env.GEMSTONE_GLOBAL_DIR = deps.getRootPath();
  const gsInstallPath = deps.getGemstonePath(login.version) ?? path.dirname(path.dirname(gciPath));
  process.env.GEMSTONE = gsInstallPath;
  const session = await deps.connect(login, gciPath);
  if (!session) {
    return 'failed';
  }
  deps.connected(login, session);
  return 'connected';
}

/**
 * A library for `version` already on this machine, without asking: the one
 * bundled with Jasper, a full install of the version, or its client files.
 */
function findGciLibrary(version: string, deps: LoginAttemptDeps): string | undefined {
  if (process.platform === 'win32') {
    // Prefer a GCI library bundled with the extension (for secure /
    // air-gapped installs that cannot download from gemtalksystems.com).
    // This must win over the download/file-picker prompts.
    const bundled = bundledWindowsClientGciPath(version);
    if (bundled && bundledGciArchSupported()) {
      return bundled;
    }
  } else {
    // Auto-detect from extracted version's lib/ directory.
    // Skipped on Windows: the product dir is a Linux build (only .so), so
    // the GCI for a Windows host has to come from the Windows client below.
    const gsPath = deps.getGemstonePath(version);
    if (gsPath) {
      const ext = process.platform === 'darwin' ? 'dylib' : 'so';
      const candidate = path.join(gsPath, 'lib', `libgcits-${version}-64.${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  // The version's client files, on any platform: on Windows the Windows
  // client, elsewhere GemTalk's client package, unpacked apart from any full install.
  return deps.getClientGciPath(version);
}

/** The folder holding `file`, or its nearest ancestor that still exists. */
function nearestExistingFolder(file: string): string | undefined {
  let dir = path.dirname(file);
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return dir;
}

const PLATFORM_LIBRARY: Partial<Record<NodeJS.Platform, { name: string; ext: string }>> = {
  win32: { name: 'Windows', ext: '.dll' },
  darwin: { name: 'macOS', ext: '.dylib' },
};

/** Why this machine cannot load the library at `gciPath`, or undefined if it can. */
function gciLibraryProblem(gciPath: string): string | undefined {
  const expected = PLATFORM_LIBRARY[process.platform] ?? { name: 'Linux', ext: '.so' };
  if (!fs.existsSync(gciPath)) {
    return 'is not on disk';
  }
  if (path.extname(gciPath).toLowerCase() !== expected.ext) {
    return `is not a ${expected.name} library (${expected.ext})`;
  }
  return undefined;
}
