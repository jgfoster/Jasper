import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the restore message → handler wiring can be
// driven, plus a showWarningMessage that returns whatever the test queues.
const confirmQueue: Array<string | undefined> = [];
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
    showWarningMessage: vi.fn(() => Promise.resolve(confirmQueue.shift())),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { showClassHistoryPanel } from '../classHistoryPanel';
import { ClassVersion } from '../classHistoryModel';

const versions: ClassVersion[] = [
  {
    index: 2,
    name: 'Bar',
    oop: 2,
    timeStamp: 't2',
    userId: 'u',
    isCurrent: true,
    definition: "Object subclass: 'Bar'",
    changedMethods: [],
  },
  {
    index: 1,
    name: 'Foo',
    oop: 1,
    timeStamp: 't1',
    userId: 'u',
    isCurrent: false,
    definition: "Object subclass: 'Foo'",
    changedMethods: [],
  },
];

interface MockPanel {
  __emit: (m: unknown) => void;
  webview: { postMessage: ReturnType<typeof vi.fn> };
}
function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

beforeEach(() => {
  confirmQueue.length = 0;
  vi.clearAllMocks();
});

const noopRemove = vi.fn(async (index: number) => ({
  result: { removed: true, index, remaining: 1 },
  versions,
}));

describe('showClassHistoryPanel restore wiring', () => {
  it('confirms, calls the restore handler with the clicked index, and refreshes the list', async () => {
    confirmQueue.push('Restore');
    const restore = vi.fn(async (index: number) => ({
      result: { reverted: true, index, newIndex: 3 },
      versions,
    }));

    showClassHistoryPanel('Bar', versions, { restore, remove: noopRemove });
    lastPanel().__emit({ command: 'restore', index: 1 });
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(1));

    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'refresh' }),
      ),
    );
  });

  it('does not restore when the confirmation is dismissed', async () => {
    confirmQueue.push(undefined);
    const restore = vi.fn();

    showClassHistoryPanel('Bar', versions, { restore, remove: noopRemove });
    lastPanel().__emit({ command: 'restore', index: 1 });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(restore).not.toHaveBeenCalled();
  });

  it('confirms and calls the remove handler for a remove message', async () => {
    confirmQueue.push('Remove');
    const remove = vi.fn(async (index: number) => ({
      result: { removed: true, index, remaining: 1 },
      versions,
    }));

    showClassHistoryPanel('Bar', versions, { restore: vi.fn(), remove });
    lastPanel().__emit({ command: 'remove', index: 1 });

    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(1));
  });
});
