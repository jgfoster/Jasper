import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// Following a definition onto another class resolves its dictionary's position; nothing else
// these tests reach touches the stone.
vi.mock('../../browserQueries', () => ({ getDictionaryNames: () => ['UserGlobals'] }));

import type * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import { window, workspace } from '../../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION = { id: 1 } as ActiveSession;
const openTextDocument = workspace.openTextDocument as ReturnType<typeof vi.fn>;

function makeController(): ExplorerController {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

function spyRevealClass(ctl: ExplorerController) {
  return vi
    .spyOn(ctl as unknown as { revealClass: () => Promise<void> }, 'revealClass')
    .mockResolvedValue(undefined);
}

/** The URI a click on Array's definition opens, read off a throwaway controller. */
async function arrayDefinitionUri(): Promise<vscode.Uri> {
  await makeController().openClassDefinition();
  const uri = openTextDocument.mock.calls[0][0] as vscode.Uri;
  vi.clearAllMocks();
  return uri;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.tabGroups.all = [];
  window.activeTextEditor = undefined;
});

describe("the Explorer's own class-definition opens", () => {
  it('ignores the focus event of a definition it opened itself', async () => {
    const ctl = makeController();
    const revealClass = spyRevealClass(ctl);
    await ctl.openClassDefinition();
    const opened = openTextDocument.mock.calls[0][0] as vscode.Uri;
    ctl.state.className = 'Set';

    await ctl.syncToEditor(opened);

    expect(revealClass).not.toHaveBeenCalled();
  });

  it('follows a later open of a definition that was already the active editor', async () => {
    // Clicking a class whose definition tab is focused fires no active-editor change, so a
    // mark left by that click would swallow the next open of the same definition from
    // elsewhere -- a GemStone Search double-click -- leaving the Explorer on another class.
    const built = await arrayDefinitionUri();
    const ctl = makeController();
    const revealClass = spyRevealClass(ctl);
    window.activeTextEditor = { document: { uri: built } };
    await ctl.openClassDefinition();
    ctl.state.className = 'Set';

    await ctl.syncToEditor(built);

    expect(revealClass).toHaveBeenCalledWith('UserGlobals', 1, 'Array', expect.anything());
  });
});
