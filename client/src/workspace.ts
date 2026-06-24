import * as vscode from 'vscode';
import { logInfo } from './gciLog';

const MOD_KEY = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

export const WORKSPACE_TEMPLATE =
    `"Workspace\nPlace cursor anywhere on a line with code\nand press [<${MOD_KEY}>+<K> followed by <D>]\n(note that this is a two-keypress chord) to display"\n6 * 7\n`;

/**
 * Open a GemStone Workspace scratch buffer.
 *
 * It uses the *named* untitled URI `untitled:Workspace` rather than
 * `openTextDocument({content})`. An anonymous untitled doc is titled
 * "Untitled-N" and — because it carries unsaved content — VS Code's hot-exit
 * restores it under a *fresh* number on every window reload, so the buffers
 * pile up (Untitled-1, Untitled-2, …). The named doc keeps the stable title
 * "Workspace" across reloads, and reopening the same URI reuses the one
 * document instead of spawning new ones. (An editable buffer with content is
 * still "dirty" — only a saved file is ever truly clean — but it no longer
 * multiplies or loses its name.)
 */
export async function openWorkspace(): Promise<void> {
  logInfo('[Workspace] opening workspace document');
  try {
    const uri = vscode.Uri.from({ scheme: 'untitled', path: 'Workspace' });
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.languageId !== 'gemstone-smalltalk') {
      await vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
    }
    // Seed the template only into a fresh, empty buffer — never into a doc that
    // hot-exit just restored with the user's own content.
    if (doc.getText().length === 0) {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), WORKSPACE_TEMPLATE);
      await vscode.workspace.applyEdit(edit);
    }
    await vscode.window.showTextDocument(doc, { preview: false });
    logInfo('[Workspace] opened successfully');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`[Workspace] ERROR: ${msg}`);
  }
}
