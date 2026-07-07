import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { SessionManager } from '../sessionManager';
import { SystemBrowser } from '../systemBrowser';
import { buildMethodUri } from '../gemstoneFileSystemProvider';

interface ClassPickItem extends vscode.QuickPickItem {
  entry: queries.ClassNameEntry;
}

/**
 * Run `fn` behind a modal progress notification, surfacing any thrown error as
 * an error message. Returns `undefined` when the work failed. `fn` may be
 * synchronous — the notification still shows for the duration of the call.
 */
async function withLoadingProgress<T>(
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
 * Command handler for "Find Method in Class". Always shows a filterable class
 * picker — pre-highlighting the System Browser's current selection when there
 * is one, so a single Enter reproduces the scoped-to-selection behavior while
 * the list stays right there to pick a different class. Then lets the user
 * pick a method via quick-pick and navigates the browser to it — falling back
 * to opening the `gemstone://` virtual document if no browser is open for the
 * session.
 */
export async function findMethodInClass(sessionManager: SessionManager): Promise<void> {
  const session = await sessionManager.resolveSession();
  if (!session) return;

  const current = SystemBrowser.getSelectedClassName(session.id);

  const entries = await withLoadingProgress(
    'Loading class list…',
    'Failed to load classes',
    () => queries.getAllClassNames(session),
  );
  if (!entries) return;

  const classItems: ClassPickItem[] = entries.map(e => ({
    label: e.className,
    description: e.dictName,
    entry: e,
  }));

  // createQuickPick (not showQuickPick) so the selected class can be
  // pre-highlighted via activeItems without also filtering the list.
  const pickedClass = await new Promise<ClassPickItem | undefined>(resolve => {
    const qp = vscode.window.createQuickPick<ClassPickItem>();
    qp.items = classItems;
    qp.matchOnDescription = true;
    qp.placeholder = 'Type to find a class…';
    if (current) {
      const preselected = classItems.find(
        i => i.entry.className === current.className && i.entry.dictName === current.dictName,
      );
      if (preselected) qp.activeItems = [preselected];
    }
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]);
      qp.dispose();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
  if (!pickedClass) return;

  const { className, dictName } = pickedClass.entry;

  const methods = await withLoadingProgress(
    `Loading methods for ${className}…`,
    'Failed to load methods',
    () => queries.getMethodList(session, className),
  );
  if (!methods) return;

  if (methods.length === 0) {
    vscode.window.showInformationMessage(`No methods found for ${className}.`);
    return;
  }

  const items = methods.map(m => ({
    label: `${m.isMeta ? '(class) ' : ''}${m.selector}`,
    description: m.category,
    method: m,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Type to find a method in ${className}…`,
    matchOnDescription: true,
  });
  if (!picked) return;

  const result: queries.MethodSearchResult = { dictName, className, ...picked.method };

  if (!SystemBrowser.navigateTo(session.id, result)) {
    const uri = buildMethodUri({ kind: 'method', sessionId: session.id, ...result, environmentId: 0 });
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }
}
