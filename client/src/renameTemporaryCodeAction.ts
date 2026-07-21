/**
 * A Refactor code action that hosts "Rename Temporary/Argument…" under VS Code's
 * native "Refactor…" editor menu (`editor.action.refactor`). That built-in menu
 * item is always present in a text editor and is otherwise empty for GemStone
 * methods; this populates it (and is the idiomatic home for a refactoring) rather
 * than adding a separate top-level context-menu entry. The action just invokes the
 * `gemstone.renameTemporary` command, which resolves the variable at the cursor and
 * declines (with a reason) if it is not a temporary or argument.
 */
import * as vscode from 'vscode';

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

export class RenameTemporaryCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    // Only offer it when the cursor sits on an identifier — otherwise "Refactor…"
    // would list a rename with nothing to rename.
    if (!document.getWordRangeAtPosition(range.start, IDENTIFIER)) return [];
    const action = new vscode.CodeAction(
      'Rename Temporary/Argument…',
      vscode.CodeActionKind.Refactor,
    );
    action.command = {
      command: 'gemstone.renameTemporary',
      title: 'Rename Temporary/Argument…',
    };
    return [action];
  }
}
