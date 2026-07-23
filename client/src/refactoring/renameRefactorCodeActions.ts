/**
 * The Refactor code actions hosted under VS Code's native "Refactor…" editor menu
 * (`editor.action.refactor`) in a GemStone method editor: Rename
 * Temporary/Argument, Rename Instance Variable, Rename Class Variable (each on
 * the identifier at the cursor), and Rename Method (the method being edited).
 * That built-in menu item is always present in a text editor and is otherwise
 * empty for GemStone methods; this populates it (the idiomatic home for
 * refactorings) rather than adding separate top-level context-menu entries. Each
 * action invokes its command, which resolves the target at the cursor and
 * declines with a reason (pointing at the right rename) when it doesn't apply.
 */
import * as vscode from 'vscode';

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

export class RefactorCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    // "Rename Method…" targets the method being edited, so it is offered anywhere
    // in the editor; the three variable renames need an identifier under the
    // cursor. The variable renames are offered without knowing what the identifier
    // IS (that needs the stone); whichever one doesn't apply declines with a
    // reason pointing at the right one — simple but polite.
    const method = new vscode.CodeAction('Rename Method…', vscode.CodeActionKind.Refactor);
    method.command = {
      command: 'gemstone.renameMethodInEditor',
      title: 'Rename Method…',
      // The position steers the target: a sent selector here renames that
      // selector; the header or a non-send position renames the edited method.
      arguments: [range.start],
    };
    if (!document.getWordRangeAtPosition(range.start, IDENTIFIER)) return [method];
    const temp = new vscode.CodeAction(
      'Rename Temporary/Argument…',
      vscode.CodeActionKind.Refactor,
    );
    temp.command = {
      command: 'gemstone.renameTemporary',
      title: 'Rename Temporary/Argument…',
      // Pass the exact position the action was offered at, so the command renames
      // the token here rather than wherever the editor selection happens to be.
      arguments: [range.start],
    };
    const ivar = new vscode.CodeAction('Rename Instance Variable…', vscode.CodeActionKind.Refactor);
    ivar.command = {
      command: 'gemstone.renameInstVarAtCursor',
      title: 'Rename Instance Variable…',
      arguments: [range.start],
    };
    const classVar = new vscode.CodeAction(
      'Rename Class Variable…',
      vscode.CodeActionKind.Refactor,
    );
    classVar.command = {
      command: 'gemstone.renameClassVarAtCursor',
      title: 'Rename Class Variable…',
      arguments: [range.start],
    };
    return [temp, ivar, classVar, method];
  }
}
