import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ActiveSession } from '../sessionManager';

export interface ClassPickItem extends vscode.QuickPickItem {
  entry: queries.ClassNameEntry;
}

/**
 * Run `fn` behind a modal progress notification, surfacing any thrown error as
 * an error message. Returns `undefined` when the work failed. `fn` may be
 * synchronous — the notification still shows for the duration of the call.
 */
export async function withLoadingProgress<T>(
  title: string,
  failLabel: string,
  fn: () => T,
): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      () => Promise.resolve(fn()),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`${failLabel}: ${msg}`);
    return undefined;
  }
}

/**
 * Load the full class list behind a progress notification and map it to
 * quick-pick items. Returns `undefined` when the load failed (the error is
 * already surfaced to the user).
 */
export async function loadClassPickItems(
  session: ActiveSession,
): Promise<ClassPickItem[] | undefined> {
  const entries = await withLoadingProgress(
    'Loading class list…',
    'Failed to load classes',
    () => queries.getAllClassNames(session),
  );
  if (!entries) return undefined;

  return entries.map(e => ({
    label: e.className,
    description: e.dictName,
    entry: e,
  }));
}
