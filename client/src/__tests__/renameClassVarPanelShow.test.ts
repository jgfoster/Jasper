import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the paginated preview panel's message wiring
// (loadMore / loadAll / apply / cancel) can be driven.
vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: vi.fn(() => {
      const messageCbs: Array<(m: unknown) => void> = [];
      const disposeCbs: Array<() => void> = [];
      return {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: (cb: (m: unknown) => void) => {
            messageCbs.push(cb);
            return { dispose() {} };
          },
        },
        onDidDispose: (cb: () => void) => {
          disposeCbs.push(cb);
          return { dispose() {} };
        },
        dispose: () => disposeCbs.forEach((c) => c()),
        __emit: (m: unknown) => messageCbs.forEach((c) => c(m)),
      };
    }),
    showErrorMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { showRenameClassVarPanel } from '../renameClassVarPanel';
import { StartClassVarPreview } from '../renameClassVarPreview';

interface MockPanel {
  __emit: (m: unknown) => void;
  dispose: () => void;
  webview: { postMessage: ReturnType<typeof vi.fn> };
}
function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

const start: StartClassVarPreview = {
  token: 'tok',
  total: 2,
  oldName: 'Rate',
  newName: 'Multiplier',
  outOfScope: { references: 0, skipped: 0, collision: null },
  skippedMethods: [],
  page: {
    changes: [
      {
        id: '1',
        kind: 'classDefinitionEdit',
        dictName: 'UserGlobals',
        className: 'Account',
        isMeta: false,
        selector: null,
        category: null,
        oldSource: 'a',
        newSource: 'b',
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('showRenameClassVarPanel', () => {
  it('applies with an EMPTY deselected set even when the webview reports one (all-or-nothing)', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 2, failed: [] })),
      cleanup: vi.fn(),
    };

    const result = showRenameClassVarPanel('Rate', 'Multiplier', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: ['1', '2'] });

    expect(await result).toEqual({ applied: 2, failed: [] });
    expect(handlers.apply).toHaveBeenCalledWith([]);
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up exactly once on cancel', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showRenameClassVarPanel('Rate', 'Multiplier', start, handlers);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up exactly once when the panel is disposed', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showRenameClassVarPanel('Rate', 'Multiplier', start, handlers);
    lastPanel().dispose();

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fetches the next page when asked for more', async () => {
    const handlers = {
      loadPage: vi.fn(async () => ({ changes: [], nextOffset: 3, done: true })),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    showRenameClassVarPanel('Rate', 'Multiplier', start, handlers);
    lastPanel().__emit({ command: 'loadMore' });

    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledWith(2));
  });

  it('drains every remaining page on load-all', async () => {
    // Two more pages after the first: offset 2 (not done) then offset 3 (done).
    const handlers = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce({ changes: [], nextOffset: 3, done: false })
        .mockResolvedValueOnce({ changes: [], nextOffset: 4, done: true }),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    showRenameClassVarPanel('Rate', 'Multiplier', start, handlers);
    lastPanel().__emit({ command: 'loadAll' });

    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledTimes(2));
    expect(handlers.loadPage).toHaveBeenNthCalledWith(1, 2);
    expect(handlers.loadPage).toHaveBeenNthCalledWith(2, 3);
  });
});
