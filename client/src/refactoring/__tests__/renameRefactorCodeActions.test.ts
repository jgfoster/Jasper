import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
import * as vscode from 'vscode';
import { RefactorCodeActionProvider } from '../renameRefactorCodeActions';

function docWith(line: string): vscode.TextDocument {
  return {
    getWordRangeAtPosition: (pos: vscode.Position, re: RegExp) => {
      const m = re.exec(line.slice(pos.character));
      return m && m.index === 0
        ? new vscode.Range(pos, new vscode.Position(pos.line, pos.character + m[0].length))
        : undefined;
    },
  } as unknown as vscode.TextDocument;
}

describe('refactor code actions', () => {
  const provider = new RefactorCodeActionProvider();

  it('offers all four rename refactorings when the cursor is on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const actions = provider.provideCodeActions(docWith('total'), range);

    expect(actions.map((a) => a.command?.command)).toEqual([
      'gemstone.renameTemporary',
      'gemstone.renameInstVarAtCursor',
      'gemstone.renameClassVarAtCursor',
      'gemstone.renameMethodInEditor',
    ]);
    for (const action of actions) {
      expect(action.kind?.value).toBe(vscode.CodeActionKind.Refactor.value);
    }
    // Every action carries the exact position it was offered at — the variable
    // renames target the token there, and the method rename targets a sent
    // selector there (falling back to the edited method).
    for (const action of actions) {
      expect(action.command?.arguments?.[0]).toBe(range.start);
    }
  });

  it('offers only the method rename when the cursor is not on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const actions = provider.provideCodeActions(docWith('  + 1'), range);

    expect(actions.map((a) => a.command?.command)).toEqual(['gemstone.renameMethodInEditor']);
  });

  it('advertises the Refactor code-action kind', () => {
    expect(RefactorCodeActionProvider.providedCodeActionKinds).toContain(
      vscode.CodeActionKind.Refactor,
    );
  });
});
