/**
 * "Rename Method…" triggered from the METHOD SOURCE EDITOR (the Refactor… code
 * action / command palette). The target follows the cursor (Eric, 2026-07-21):
 * on a SENT selector in the body (e.g. `runningSum` inside `report`), it renames
 * that sent selector across its implementors and senders; on the method header —
 * or anywhere that is not a message send — it renames the method being edited.
 * The selector under the cursor is resolved by the LSP (`gemstone/
 * selectorAtPosition`, AST-based, so multi-part keyword selectors resolve whole).
 *
 * Either way it runs the existing R2 flow (keyword-part editor → scope →
 * paginated preview panel → server-side apply, no commit) anchored at the
 * editor's class; that flow already reopens any editor that was on a renamed
 * selector under its new name.
 */
import * as vscode from 'vscode';
import { parseUri } from '../gemstoneFileSystemProvider';
import { logInfo } from '../gciLog';

/** What the shared Explorer rename flow needs to start. */
export interface MethodRenameTarget {
  className: string;
  selector: string;
  isMeta: boolean;
  dictIndex?: number;
  dictName?: string;
}

/** Resolves the full selector at a position in a document (LSP-backed), or null
 *  when the position is not on a message send / method pattern. */
export type SelectorAtPosition = (
  document: vscode.TextDocument,
  position: vscode.Position,
) => Promise<string | null>;

function refuse(message: string): void {
  logInfo(`[renameMethod] refused: ${message}`);
  void vscode.window.showWarningMessage(message);
}

/** Run the rename-method flow for the selector at the cursor (a sent message),
 *  falling back to the method open in the active editor. */
export async function renameMethodAtCursorCommand(
  beginRename: (target: MethodRenameTarget) => Promise<boolean>,
  selectorAt: SelectorAtPosition,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[renameMethod] invoked from editor');
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'gemstone') {
    refuse('Open a GemStone method to rename it.');
    return;
  }

  let parsed;
  try {
    parsed = parseUri(editor.document.uri);
  } catch {
    parsed = undefined;
  }
  // A never-saved method has no selector in the stone to rename (its URI parses
  // as the dedicated new-method kind, or — defensively — as the placeholder
  // selector).
  if (
    parsed?.kind === 'new-method' ||
    (parsed?.kind === 'method' && parsed.selector === 'new-method')
  ) {
    refuse('Save the new method first, then rename it.');
    return;
  }
  if (!parsed || parsed.kind !== 'method') {
    refuse('Rename Method works in a method source editor.');
    return;
  }

  // The target follows the cursor: a sent selector in the body renames THAT
  // selector; the header — or any non-send position — resolves to null and renames
  // the method being edited. A THROW means the selector lookup is unavailable (LSP
  // not started / errored); we can't tell a header click from a sent-selector click
  // then, so we abort rather than risk renaming the wrong method.
  let selector = parsed.selector;
  try {
    const at = position ?? editor.selection.active;
    const sent = await selectorAt(editor.document, at);
    if (sent) selector = sent;
  } catch {
    refuse(
      'Selector lookup is not available right now (the language server may still be starting). Try again in a moment.',
    );
    return;
  }
  logInfo(`[renameMethod] target #${selector} (editing ${parsed.className}>>${parsed.selector})`);

  // The shared flow handles everything from here (engine gate, selector editor,
  // scope, preview, apply) and reopens affected editors under the new selector.
  await beginRename({
    className: parsed.className,
    selector,
    isMeta: parsed.isMeta,
    dictIndex: parsed.dictIndex,
    dictName: parsed.dictName,
  });
}
