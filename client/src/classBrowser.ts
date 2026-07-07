import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';

// ── ClassBrowser panel ─────────────────────────────────────

/**
 * Opens class definitions as regular gemstone:// documents in the editor.
 *
 * These tabs are closed by closeGemstoneTabsForSession when the owning browser
 * closes (SystemBrowser.dispose) or the session logs out (the extension logout
 * flow), so no explicit cleanup is needed here.
 */
export class ClassBrowser {
  static async showOrUpdate(
    session: ActiveSession,
    dictionaries: string[],
    dictIndex: number,
    className: string | null,
  ): Promise<void> {
    if (!className) return;

    const dictName = dictionaries[dictIndex - 1];
    if (!dictName) return;

    // ?dict=<index> scopes the definition lookup to this exact dictionary (by its
    // 1-based SymbolList position), so the same key in two dictionaries — which
    // can even share a name — resolves to the class the user actually selected.
    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(dictName)}/${encodeURIComponent(className)}/definition?dict=${dictIndex}`,
    );

    // Don't re-fetch and re-open if the tab is already present anywhere
    const uriString = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri?.toString() === uriString) return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Two,
      preview: true,
      preserveFocus: true,
    });
  }
}
