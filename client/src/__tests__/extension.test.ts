import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('vscode-languageclient/node', () => ({
  LanguageClient: class {
    start() {}
    stop() {
      return Promise.resolve();
    }
    sendRequest() {
      return Promise.resolve(null);
    }
  },
  TransportKind: { ipc: 0 },
}));

vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
  compileMethod: vi.fn(() => 'Compiled: Array >> foo'),
}));

import * as vscode from 'vscode';
import * as extension from '../extension';
import { GemStoneFileSystemProvider } from '../gemstoneFileSystemProvider';
import type { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';

describe('openTextEditorOn', () => {
  const uri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.workspace.openTextDocument).mockReset();
    vi.mocked(vscode.window.showTextDocument).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  });

  it('opens and shows the document with preview disabled, without logging an error', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(document, { preview: false });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('logs an error when openTextDocument fails and does not call showTextDocument', async () => {
    const error = new Error('open failed');
    vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(error);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to open text editor on ${uri.toString()}`,
      'Show Details',
    );
  });

  it('logs an error when showTextDocument fails after openTextDocument succeeds', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    const error = new Error('show failed');
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockRejectedValue(error);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(document, { preview: false });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to open text editor on ${uri.toString()}`,
      'Show Details',
    );
  });
});

describe('closeTextEditorOn', () => {
  const targetUri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');
  const otherUri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:put:');

  const makeTextTab = (uri: vscode.Uri): vscode.Tab => ({
    input: new vscode.TabInputText(uri),
  } as unknown as vscode.Tab);

  beforeEach(() => {
    vi.restoreAllMocks();
    (vscode.window.tabGroups as any).all = [];
    vi.mocked(vscode.window.tabGroups.close).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  });

  it('does nothing when no tabs are opened for the given uri', async () => {
    (vscode.window.tabGroups as any).all = [{ tabs: [] }];

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('closes one matching opened tab (happy path)', async () => {
    const tab = makeTextTab(targetUri);
    (vscode.window.tabGroups as any).all = [{ tabs: [tab] }];
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(tab);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('logs error when closing one matching opened tab fails', async () => {
    const tab = makeTextTab(targetUri);
    const error = new Error('close failed');
    (vscode.window.tabGroups as any).all = [{ tabs: [tab] }];
    vi.mocked(vscode.window.tabGroups.close).mockRejectedValue(error);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to close text editor on ${targetUri.toString()}`,
      'Show Details',
    );
  });

  it('closes both tabs when more than one matching tab is opened (happy path)', async () => {
    const tab1 = makeTextTab(targetUri);
    const tab2 = makeTextTab(targetUri);
    (vscode.window.tabGroups as any).all = [{ tabs: [tab1, tab2] }];
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(1, tab1);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(2, tab2);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('handles per-tab failure: first fails and second still closes', async () => {
    const tab1 = makeTextTab(targetUri);
    const tab2 = makeTextTab(targetUri);
    const error = new Error('first close failed');
    (vscode.window.tabGroups as any).all = [{ tabs: [tab1, tab2] }];
    vi.mocked(vscode.window.tabGroups.close)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(1, tab1);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(2, tab2);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to close text editor on ${targetUri.toString()}`,
      'Show Details',
    );
  });

  it('does not close tabs for different uris', async () => {
    const matching = makeTextTab(targetUri);
    const different = makeTextTab(otherUri);
    const notText = { input: { uri: targetUri } } as unknown as vscode.Tab;
    (vscode.window.tabGroups as any).all = [{ tabs: [matching, different, notText] }];
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(matching);
  });
});

describe('handleMethodCompiled', () => {
  const uri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');
  const previousUri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:put:');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.workspace.openTextDocument).mockReset();
    vi.mocked(vscode.window.showTextDocument).mockReset();
    vi.mocked(vscode.window.tabGroups.close).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    (vscode.window.tabGroups as any).all = [];
  });

  it('opens the new uri and then closes the previous uri when isNewMethod is true', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);
    const previousTab = { input: new vscode.TabInputText(previousUri) } as unknown as vscode.Tab;
    (vscode.window.tabGroups as any).all = [{ tabs: [previousTab] }];
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.handleMethodCompiled({ uri, previousUri, isNewMethod: true });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(previousTab);
    expect(vi.mocked(vscode.workspace.openTextDocument).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(vscode.window.tabGroups.close).mock.invocationCallOrder[0]);
  });

  it('does nothing when uri equals previousUri (selector unchanged)', async () => {
    (vscode.window.tabGroups as any).all = [];

    await extension.handleMethodCompiled({ uri, previousUri: uri, isNewMethod: false });

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('opens the new uri but does not close the previous tab when isNewMethod is false (selector changed)', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);
    const previousTab = { input: new vscode.TabInputText(previousUri) } as unknown as vscode.Tab;
    (vscode.window.tabGroups as any).all = [{ tabs: [previousTab] }];

    await extension.handleMethodCompiled({ uri, previousUri, isNewMethod: false });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });
});

describe('onMethodCompiled event subscription (functional)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleMethodCompiled is invoked when new-method is compiled', async () => {
    vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');

    const makeSession = (id = 1) => ({
      id,
      gci: {},
      handle: {},
      login: { label: 'Test', gs_user: 'DataCurator' },
      stoneVersion: '3.7.2',
    });

    const sessionManager = {
      getSessions: vi.fn(() => [makeSession(1)]),
      getSession: vi.fn((id: number) => (id === 1 ? makeSession(1) : undefined)),
    } as unknown as SessionManager;

    const provider = new GemStoneFileSystemProvider(sessionManager);
    const handler = vi.spyOn(extension, 'handleMethodCompiled');

    provider.onMethodCompiled(handler);

    const newMethodUri = vscode.Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
    const source = 'foo\n  ^42';

    provider.writeFile(newMethodUri, new TextEncoder().encode(source), { create: true, overwrite: true });
    await new Promise(resolve => setImmediate(resolve));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.previousUri.toString()).toBe(newMethodUri.toString());
    expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
    expect(event.isNewMethod).toBe(true);
  });
});

