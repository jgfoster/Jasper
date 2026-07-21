import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode'));
import * as vscode from 'vscode';
import { RenameTemporaryCodeActionProvider } from '../renameTemporaryCodeAction';

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

describe('rename-temporary code action', () => {
  const provider = new RenameTemporaryCodeActionProvider();

  it('offers a Refactor action to rename when the cursor is on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const actions = provider.provideCodeActions(docWith('total'), range);

    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain('Rename Temporary/Argument');
    expect(actions[0].kind?.value).toBe(vscode.CodeActionKind.Refactor.value);
    expect(actions[0].command?.command).toBe('gemstone.renameTemporary');
  });

  it('offers nothing when the cursor is not on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    expect(provider.provideCodeActions(docWith('  + 1'), range)).toHaveLength(0);
  });

  it('advertises the Refactor code-action kind', () => {
    expect(RenameTemporaryCodeActionProvider.providedCodeActionKinds).toContain(
      vscode.CodeActionKind.Refactor,
    );
  });
});
