import { describe, it, expect, vi } from 'vitest';

// A controllable webview panel so the message → resolve wiring can be driven:
// createWebviewPanel returns a panel whose __emit() delivers a webview message
// and whose dispose() fires the onDidDispose callbacks.
vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: vi.fn(() => {
      const messageCbs: Array<(m: unknown) => void> = [];
      const disposeCbs: Array<() => void> = [];
      return {
        webview: {
          html: '',
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
  },
}));

import * as vscode from 'vscode';
import { showRenameInstVarPanel } from '../renameInstVarPanel';
import { RenameChange } from '../renameInstVarPreview';

const change = (id: string, selector: string): RenameChange => ({
  id,
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector,
  category: 'accessing',
  oldSource: `${selector}\n\t^count`,
  newSource: `${selector}\n\t^tally`,
});

function lastPanel(): { __emit: (m: unknown) => void; dispose: () => void } {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: { __emit: (m: unknown) => void; dispose: () => void } }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

describe('showRenameInstVarPanel', () => {
  it("resolves with the applied ids in the changes' order, not the reported order", async () => {
    const changes = [change('1', 'a'), change('2', 'b'), change('9', 'c')];

    const result = showRenameInstVarPanel('count', 'tally', changes);
    lastPanel().__emit({ command: 'apply', ids: ['9', '1'] });

    expect(await result).toEqual(['1', '9']);
  });

  it('resolves with an empty array when apply reports nothing checked', async () => {
    const result = showRenameInstVarPanel('count', 'tally', [change('1', 'a')]);
    lastPanel().__emit({ command: 'apply', ids: [] });

    expect(await result).toEqual([]);
  });

  it('resolves undefined when the user cancels', async () => {
    const result = showRenameInstVarPanel('count', 'tally', [change('1', 'a')]);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
  });

  it('resolves undefined when the panel is closed', async () => {
    const result = showRenameInstVarPanel('count', 'tally', [change('1', 'a')]);
    lastPanel().dispose();

    expect(await result).toBeUndefined();
  });

  it('ignores further messages once settled', async () => {
    const changes = [change('1', 'a'), change('2', 'b')];

    const result = showRenameInstVarPanel('count', 'tally', changes);
    const panel = lastPanel();
    panel.__emit({ command: 'apply', ids: ['1'] });
    panel.__emit({ command: 'apply', ids: ['1', '2'] });

    expect(await result).toEqual(['1']);
  });
});
