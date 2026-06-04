import * as vscode from 'vscode';
import { logInfo } from './gciLog';

const MOD_KEY = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

export const WORKSPACE_TEMPLATE =
    `"Workspace\nPlace cursor anywhere on a line with code\nand press [<${MOD_KEY}>+<K> followed by <D>]\n(note that this is a two-keypress chord) to display"\n6 * 7\n`;

export async function openWorkspace(): Promise<void> {
  logInfo('[Workspace] opening new workspace document');
  try {
    const workspaceDocument = await vscode.workspace.openTextDocument({content: WORKSPACE_TEMPLATE, language: 'gemstone-smalltalk' });
    await vscode.window.showTextDocument(workspaceDocument, { preview: false });
    logInfo('[Workspace] opened successfully');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`[Workspace] ERROR: ${msg}`);
  }
}
