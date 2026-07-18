// Orchestrates a logical (object) backup of a running stone: pre-flight checks,
// destination selection, and running Repository>>fullBackupTo: via a
// non-blocking executor (which keeps VS Code responsive and shows its own
// cancellable progress notification for the long-running call).
//
// Session acquisition (matching the active session to the target stone) and the
// executor wiring live in the command handler; this module takes the executors
// as dependencies so it stays unit-testable without a live GCI session.
import * as vscode from 'vscode';
import * as path from 'path';
import { QueryExecutor } from './queries/types';
import * as backup from './queries/backup';
import { wslExistsSync, wslMkdirSync } from './wslFs';

export interface LogicalBackupDeps {
  // Fast, synchronous executor for the pre-flight queries.
  execute: QueryExecutor;
  // Non-blocking executor for the long-running backup itself. Returns the
  // stone's result string ('OK' on success). Should suppress its own progress
  // toast — this module shows a single always-visible progress notification.
  runBackup: (code: string) => Promise<string>;
  // Stone the session is connected to (used for labels and the default filename).
  stoneName: string;
  // Managed database directory, when the session's stone is one we manage
  // locally; the default destination is <dbPath>/backups. Omitted for stones we
  // don't manage — the picker then opens without a pre-filled directory.
  dbPath?: string;
}

const BACKUP_FILTERS: Record<string, string[]> = {
  'GemStone backup': ['dbf'],
  'All files': ['*'],
};

// How long the green success message lingers in the status bar (ms).
const STATUS_SUCCESS_MS = 6000;
// Theme-color ids for the status-bar item (adapt to the active color theme).
const WORKING_COLOR = 'charts.blue';
const SUCCESS_COLOR = 'charts.green';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// A filesystem-safe, sortable timestamp in LOCAL time (YYYY-MM-DD_HH-MM-SS) for
// default names, so they match what the user sees in their file manager (UTC
// from toISOString() looked "off" by the local offset).
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

// Returns true if the backup completed, false if it was cancelled or failed
// (all failure paths surface their own message to the user).
export async function runLogicalBackup(deps: LogicalBackupDeps): Promise<boolean> {
  let hasPrivilege: boolean;
  try {
    hasPrivilege = backup.hasFileControlPrivilege(deps.execute);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not check backup privileges: ${errorMessage(e)}`);
    return false;
  }
  if (!hasPrivilege) {
    vscode.window.showErrorMessage(
      'A full logical backup requires the FileControl privilege. Connect as a user that has it ' +
        '(for example DataCurator or SystemUser) and try again.',
    );
    return false;
  }

  let needsCommit: boolean;
  try {
    needsCommit = backup.sessionNeedsCommit(deps.execute);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not check the session state: ${errorMessage(e)}`);
    return false;
  }
  if (needsCommit) {
    const proceed = await vscode.window.showWarningMessage(
      `The session connected to "${deps.stoneName}" has uncommitted changes. A full logical backup ` +
        'discards them (it aborts the session). Continue?',
      { modal: true },
      'Discard changes and back up',
    );
    if (proceed !== 'Discard changes and back up') return false;
    try {
      backup.abortTransaction(deps.execute);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not abort the session: ${errorMessage(e)}`);
      return false;
    }
  }

  // Destination is a server-side path. For a local stone the client and server
  // share a filesystem, so the file picker resolves correctly; remote-stone
  // support is deferred (would browse via the GCI session instead).
  const fileName = `${deps.stoneName}_${timestamp()}.dbf`;
  let defaultUri: vscode.Uri | undefined;
  if (deps.dbPath) {
    const defaultDir = path.join(deps.dbPath, 'backups');
    if (!wslExistsSync(defaultDir)) {
      try {
        wslMkdirSync(defaultDir, { recursive: true });
      } catch {
        // Non-fatal: the picker still opens on the parent directory.
      }
    }
    defaultUri = vscode.Uri.file(path.join(defaultDir, fileName));
  }
  const uri = await vscode.window.showSaveDialog({
    title: `Full Logical Backup of ${deps.stoneName}`,
    defaultUri,
    filters: BACKUP_FILTERS,
  });
  if (!uri) return false;
  const destination = uri.fsPath;

  // Colored status-bar item: a blue spinner while the (possibly instant) backup
  // runs, then a green confirmation that lingers ~6s. A fast backup can outrace
  // the progress toast, so this guarantees a visible, unmissable signal — and the
  // color makes "working" vs "done" readable at a glance.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.text = `$(sync~spin) Full logical backup of "${deps.stoneName}"…`;
  status.color = new vscode.ThemeColor(WORKING_COLOR);
  status.show();

  // The progress notification (the nb executor suppresses its own ~2s toast) is
  // the prominent indicator for a genuinely long backup.
  let result: string;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Full logical backup of "${deps.stoneName}"…`,
        cancellable: false,
      },
      async () => (await deps.runBackup(backup.fullBackupCode(destination))).trim(),
    );
  } catch (e) {
    status.dispose();
    vscode.window.showErrorMessage(`Full logical backup failed: ${errorMessage(e)}`);
    return false;
  }
  if (result !== 'OK') {
    status.dispose();
    vscode.window.showErrorMessage(`Full logical backup did not complete: ${result}`);
    return false;
  }

  status.text = `$(check) Full logical backup of "${deps.stoneName}" written`;
  status.color = new vscode.ThemeColor(SUCCESS_COLOR);
  setTimeout(() => status.dispose(), STATUS_SUCCESS_MS);

  // Offer to reveal the file, but only for a locally-managed stone: the path is
  // on the server, and revealing it in the client's file manager only makes
  // sense when client and server share a filesystem (which dbPath implies).
  const reveal = 'Reveal in File Explorer';
  const actions = deps.dbPath ? [reveal] : [];
  const choice = await vscode.window.showInformationMessage(
    `Full logical backup of "${deps.stoneName}" written to ${destination}`,
    ...actions,
  );
  if (choice === reveal) {
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destination));
  }
  return true;
}
