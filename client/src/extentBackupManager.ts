// Orchestrates an ONLINE EXTENT (snapshot) backup of a running stone: verify
// full logging, resolve the extent files, choose a destination, suspend
// checkpoints, copy the (now frozen) extents on the host, then ALWAYS resume
// checkpoints and check the result.
//
// The GCI calls (suspend/resume/reflection) are fast, so the synchronous
// executor is fine; the file copy happens on the host and is injected so this
// module stays unit-testable and WSL-transparent (the command handler passes
// the wslFs primitives). Mirrors backupManager.ts.
//
// This is deliberately a locally-managed-stone feature: copying live extents
// needs host-filesystem access to them, which the caller guarantees by only
// invoking it for a Jasper-managed database.
import * as vscode from 'vscode';
import * as path from 'path';
import { QueryExecutor } from './queries/types';
import * as extentBackup from './queries/extentBackup';

export interface ExtentBackupDeps {
  // Fast, synchronous executor for the bracketing GCI calls.
  execute: QueryExecutor;
  // Stone the session is connected to (labels + default folder name).
  stoneName: string;
  // Managed database root; the default destination is <dbPath>/backups.
  dbPath: string;
  // <dbPath>/data — scanned for extent*.dbf if the stone query returns nothing.
  dataDir: string;
  // Minutes to suspend checkpoints (safety-net timeout). Default 30.
  suspendMinutes?: number;
  // Host/WSL-aware filesystem primitives (injected for testability).
  listDataFiles: (dir: string) => string[]; // base names in dir
  ensureDir: (dir: string) => void;
  copyFile: (src: string, dst: string) => void;
  fileExists: (p: string) => boolean;
}

// How long the green success message lingers in the status bar (ms).
const STATUS_SUCCESS_MS = 6000;
const WORKING_COLOR = 'charts.blue';
const SUCCESS_COLOR = 'charts.green';
const DEFAULT_SUSPEND_MINUTES = 30;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Filesystem-safe, sortable LOCAL-time stamp (YYYY-MM-DD_HH-MM-SS), matching
// backupManager so both features name things the same way.
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Returns true if the backup completed, false if it was cancelled or failed
// (every failure path surfaces its own message to the user).
export async function runOnlineExtentBackup(deps: ExtentBackupDeps): Promise<boolean> {
  const minutes = deps.suspendMinutes ?? DEFAULT_SUSPEND_MINUTES;

  // Full-logging pre-flight — a clear early error beats a bare suspend failure.
  let logging: boolean | undefined;
  try {
    logging = extentBackup.fullLoggingEnabled(deps.execute);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not read the stone configuration: ${errorMessage(e)}`);
    return false;
  }
  if (logging === false) {
    vscode.window.showErrorMessage(
      'Online extent backup requires full transaction logging (STN_TRAN_FULL_LOGGING = TRUE). '
      + 'Checkpoints cannot be suspended in partial-logging mode.',
    );
    return false;
  }

  // Resolve the extent files: ask the stone first (authoritative — excludes
  // tranlogs and honours custom layouts), else scan <dataDir>/extent*.dbf.
  let extents = extentBackup.extentFileNames(deps.execute).filter(p => deps.fileExists(p));
  if (extents.length === 0) {
    extents = deps.listDataFiles(deps.dataDir)
      .filter(f => /^extent.*\.dbf$/i.test(f))
      .map(f => path.join(deps.dataDir, f))
      .filter(p => deps.fileExists(p));
  }
  if (extents.length === 0) {
    vscode.window.showErrorMessage(`Found no extent files to copy for stone "${deps.stoneName}".`);
    return false;
  }

  // Destination folder: default <dbPath>/backups, into a timestamped subfolder
  // so each snapshot's files are grouped and a prior one is never clobbered.
  const defaultParent = path.join(deps.dbPath, 'backups');
  try {
    deps.ensureDir(defaultParent);
  } catch {
    // Non-fatal: the picker still opens on the parent directory.
  }
  const chosen = await vscode.window.showOpenDialog({
    title: `Online Extent Backup of "${deps.stoneName}"`,
    defaultUri: vscode.Uri.file(defaultParent),
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Back Up Extents Here',
  });
  if (!chosen || chosen.length === 0) return false;
  const destDir = path.join(chosen[0].fsPath, `${deps.stoneName}_extents_${timestamp()}`);
  try {
    deps.ensureDir(destDir);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not create the backup folder: ${errorMessage(e)}`);
    return false;
  }

  // Suspend checkpoints immediately before copying — abort if not suspended.
  let suspended: boolean;
  try {
    suspended = extentBackup.suspendCheckpoints(deps.execute, minutes);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not suspend checkpoints: ${errorMessage(e)}`);
    return false;
  }
  if (!suspended) {
    vscode.window.showErrorMessage(
      'Could not suspend checkpoints (another session may already hold them, or the stone is in '
      + 'partial-logging mode). No backup taken.',
    );
    return false;
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.text = `$(sync~spin) Online extent backup of "${deps.stoneName}"…`;
  status.color = new vscode.ThemeColor(WORKING_COLOR);
  status.show();

  // From here checkpoints are suspended, so resume() MUST run no matter what —
  // hence the finally. A false resume means the copy is unusable.
  let copyError: unknown;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Copying ${extents.length} extent(s) of "${deps.stoneName}"…`,
        cancellable: false,
      },
      async (progress) => {
        for (let i = 0; i < extents.length; i++) {
          const src = extents[i];
          progress.report({ message: `${i + 1}/${extents.length}: ${path.basename(src)}` });
          deps.copyFile(src, path.join(destDir, path.basename(src)));
        }
      },
    );
  } catch (e) {
    copyError = e;
  }

  let resumed: boolean;
  try {
    resumed = extentBackup.resumeCheckpoints(deps.execute);
  } catch (e) {
    status.dispose();
    vscode.window.showErrorMessage(
      'Failed to resume checkpoints after the copy — check the stone immediately '
      + `(checkpoints may still be suspended until the ${minutes}-minute timeout): ${errorMessage(e)}`,
    );
    return false;
  }

  if (copyError) {
    status.dispose();
    vscode.window.showErrorMessage(`Online extent backup failed: ${errorMessage(copyError)}`);
    return false;
  }
  if (!resumed) {
    status.dispose();
    vscode.window.showErrorMessage(
      'Checkpoints resumed before the extent copy completed — the copied extents are NOT usable '
      + `and should be discarded (in ${destDir}). Increase the suspend timeout and retry.`,
    );
    return false;
  }

  status.text = `$(check) Extent backup of "${deps.stoneName}" written`;
  status.color = new vscode.ThemeColor(SUCCESS_COLOR);
  setTimeout(() => status.dispose(), STATUS_SUCCESS_MS);

  // Extents copied while running are "not cleanly shut down", so a restore also
  // needs the stone's transaction logs to recover — flag that here.
  const reveal = 'Reveal in File Explorer';
  const choice = await vscode.window.showInformationMessage(
    `Online extent backup of "${deps.stoneName}" written to ${destDir} (${extents.length} extent(s)). `
    + 'To restore, this snapshot also needs the stone’s transaction logs (the extents were '
    + 'copied while running, so recovery replays them on startup).',
    reveal,
  );
  if (choice === reveal) {
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destDir));
  }
  return true;
}
