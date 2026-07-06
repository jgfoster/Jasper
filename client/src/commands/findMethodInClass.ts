import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { SessionManager } from '../sessionManager';
import { SystemBrowser } from '../systemBrowser';

/**
 * Command handler for "Find Method in Class". Resolves the target class (the
 * System Browser's current selection, or a manually entered name), lets the
 * user pick a method via quick-pick, and navigates the browser to it —
 * falling back to opening the `gemstone://` virtual document if no browser
 * is open for the session.
 */
export async function findMethodInClass(sessionManager: SessionManager): Promise<void> {
  const session = await sessionManager.resolveSession();
  if (!session) return;

  let className: string | undefined;
  let dictName: string | undefined;

  const current = SystemBrowser.getSelectedClassName(session.id);
  if (current) {
    className = current.className;
    dictName = current.dictName;
  } else {
    className = await vscode.window.showInputBox({
      prompt: 'Enter class name',
      placeHolder: 'e.g. Array',
    });
    if (!className) return;
  }

  let methods: queries.MethodEntry[];
  try {
    methods = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading methods for ${className}…`,
        cancellable: false,
      },
      () => Promise.resolve(queries.getMethodList(session, className!)),
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
    dictName: dictName || '',
    className: className!,
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
