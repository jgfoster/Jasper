/**
 * The Rename Temporary/Argument (R5) command. Unlike the tree-triggered rename
 * refactorings, R5 is driven from the METHOD SOURCE EDITOR: the user puts the
 * cursor on a temporary or argument and invokes the command. It resolves the
 * class/selector/side from the gemstone: method URI, the name + source offset from
 * the cursor, previews the (single-method) rename server-side, shows the standard
 * preview panel, applies (recompile in the stone, no commit), then reloads and
 * re-focuses the method editor so it shows the saved, recompiled source.
 *
 * The method must be saved first: the engine rewrites the STORED source at the
 * given offset, so a dirty buffer's offsets would not line up. A dirty editor is
 * saved (its own normal recompile-on-save) before the rename runs.
 */
import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { parseUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewTemporaryName,
} from './renameTemporaryPreview';
import { showRenameTemporaryPanel } from './renameTemporaryPanel';

// A Smalltalk local identifier at the cursor: letter/underscore then word chars.
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

/** Run the rename-temporary flow for the active method editor. */
export async function renameTemporaryCommand(sessions: SessionManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'gemstone') {
    void vscode.window.showInformationMessage(
      'Open a GemStone method and place the cursor on a temporary or argument to rename it.',
    );
    return;
  }

  let parsed;
  try {
    parsed = parseUri(editor.document.uri);
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed.kind !== 'method') {
    void vscode.window.showInformationMessage(
      'Rename Temporary/Argument works in a method source editor.',
    );
    return;
  }

  const session = sessions.getSession(parsed.sessionId);
  if (!session) {
    void vscode.window.showWarningMessage('No GemStone session for this editor.');
    return;
  }
  if (!(await ensureRbSupport(session.rbSupportAvailable))) return;

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, IDENTIFIER);
  if (!wordRange) {
    void vscode.window.showInformationMessage(
      'Place the cursor on a temporary or argument name to rename it.',
    );
    return;
  }
  const oldName = editor.document.getText(wordRange);
  // 1-based source offset (the engine indexes the stored source from 1).
  const offset = editor.document.offsetAt(wordRange.start) + 1;

  const focusEditor = (): void => {
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  };

  // The engine rewrites the STORED method source, so a dirty buffer must be saved
  // first or the offset would not match what the stone compiled.
  if (editor.document.isDirty) {
    const saved = await editor.document.save();
    if (!saved) {
      void vscode.window.showWarningMessage('Save the method before renaming.');
      return;
    }
  }

  // Refuse up front, with a specific reason, if the cursor is not on a renamable
  // temporary/argument (an instance variable, an inherited one, a class variable,
  // a global, a pseudo-variable, or a message selector) — so the user is told why
  // before being asked for a new name. Offsets match the just-saved stored source.
  try {
    const reason = (
      await queries.renameTemporaryDeclineReason(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        oldName,
        offset,
        parsed.dictIndex ?? parsed.dictName,
      )
    ).trim();
    if (reason.length > 0) {
      void vscode.window.showWarningMessage(reason);
      focusEditor();
      return;
    }
  } catch {
    // Non-fatal: fall through — startPreview still guards decline/collision.
  }

  const entered = await vscode.window.showInputBox({
    title: 'Rename Temporary/Argument',
    prompt: `Rename '${oldName}' in ${parsed.className}${parsed.isMeta ? ' class' : ''}>>${parsed.selector}.`,
    value: oldName,
    valueSelection: [0, oldName.length],
    validateInput: (v) => validateNewTemporaryName(v, oldName),
  });
  if (entered === undefined) {
    focusEditor();
    return;
  }
  const newName = entered.trim();
  if (newName === oldName) {
    focusEditor();
    return;
  }

  const token = `rtmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearRenameTemporaryPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    const json = await queries.startRenameTemporaryPreview(
      session,
      parsed.className,
      parsed.selector,
      parsed.isMeta,
      oldName,
      newName,
      offset,
      token,
      PREVIEW_PAGE_BYTES,
      parsed.dictIndex ?? parsed.dictName,
    );
    start = parseStartPreview(json);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
    safeClear();
    focusEditor();
    return;
  }

  // A decline (the target is not a renamable local) or a collision (the new name
  // is already taken) is refused up front — we never open the panel or apply, so a
  // shadowing rename cannot slip through.
  if (start.outOfScope.decline) {
    void vscode.window.showWarningMessage(start.outOfScope.decline);
    safeClear();
    focusEditor();
    return;
  }
  if (start.outOfScope.collision) {
    void vscode.window.showWarningMessage(
      `Cannot rename to '${newName}': ${start.outOfScope.collision}.`,
    );
    safeClear();
    focusEditor();
    return;
  }
  if (start.total === 0) {
    void vscode.window.showInformationMessage(`No occurrences of '${oldName}' to rename.`);
    safeClear();
    focusEditor();
    return;
  }

  const result = await showRenameTemporaryPanel(oldName, newName, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageRenameTemporaryPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async () => parseApplyResult(await queries.applyRenameTemporary(session, token)),
    cleanup: safeClear,
  });
  if (!result) {
    focusEditor();
    return;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Rename failed: ${first.label}: ${first.error}`);
    focusEditor();
    return;
  }

  // The method was recompiled server-side (no commit). Reload the editor from the
  // stone so it shows the saved, renamed source, and re-focus it (Eric: the method
  // is selected after the refactoring).
  await reloadAndFocus(editor.document);
  void vscode.window.setStatusBarMessage(`Renamed '${oldName}' → '${newName}'`, 4000);
}

/** Gate on the refactoring engine being loaded; offer to install it if not. */
async function ensureRbSupport(available: boolean | undefined): Promise<boolean> {
  if (available) return true;
  const LOAD = 'Install GemStone Support…';
  const choice = await vscode.window.showInformationMessage(
    "Renaming a temporary needs the GemStone refactoring engine, which isn't loaded in this stone yet.",
    LOAD,
  );
  if (choice !== LOAD) return false;
  await vscode.commands.executeCommand('gemstone.installServerSupport');
  return true;
}

/** Reload the method editor from the provider (post server-side recompile) and
 *  focus it, so the just-refactored method is shown selected with its saved
 *  source. */
async function reloadAndFocus(document: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(document, { preserveFocus: false });
  try {
    await vscode.commands.executeCommand('workbench.action.files.revert');
  } catch {
    /* best-effort: the editor is focused even if revert is unavailable */
  }
}
