import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { SessionManager } from '../sessionManager';
import { SystemBrowser } from '../systemBrowser';

interface ClassPickItem extends vscode.QuickPickItem {
  entry: queries.ClassNameEntry;
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

  let entries: queries.ClassNameEntry[];
  try {
    entries = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading class list…',
        cancellable: false,
      },
      () => Promise.resolve(queries.getAllClassNames(session)),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`Failed to load classes: ${msg}`);
    return;
  }

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

  const className = pickedClass.entry.className;
  const dictName = pickedClass.entry.dictName;

  let methods: queries.MethodEntry[];
  try {
    methods = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading methods for ${className}…`,
        cancellable: false,
      },
      () => Promise.resolve(queries.getMethodList(session, className)),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`Failed to load methods: ${msg}`);
    return;
  }

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

  const result: queries.MethodSearchResult = {
    dictName,
    className,
    isMeta: picked.method.isMeta,
    selector: picked.method.selector,
    category: picked.method.category,
  };

  if (!SystemBrowser.navigateTo(session.id, result)) {
    const side = result.isMeta ? 'class' : 'instance';
    const uri = vscode.Uri.parse(
      `gemstone://${session.id}` +
      `/${encodeURIComponent(result.dictName)}` +
      `/${encodeURIComponent(result.className)}` +
      `/${side}` +
      `/${encodeURIComponent(result.category)}` +
      `/${encodeURIComponent(result.selector)}`
    );
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }
}
