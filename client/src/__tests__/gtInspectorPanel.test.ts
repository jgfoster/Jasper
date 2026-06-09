import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  ViewColumn: { Beside: 2 },
}));

vi.mock('../debugQueries', () => ({
  fetchPrintString: vi.fn(),
  getObjectClassName: vi.fn(),
  fetchFullPrintString: vi.fn(),
}));

vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
}));

vi.mock('../queries/getGtViewSpecs', () => ({
  getGtViewSpecs: vi.fn(),
  fetchObjectMeta: vi.fn(),
  fetchGtPrintTabData: vi.fn(),
  fetchGtTextData: vi.fn(),
  fetchGtListData: vi.fn(),
  fetchGtForwardListData: vi.fn(),
  fetchGtForwardListTotal: vi.fn(),
  fetchGtListTotal: vi.fn(),
  fetchGtRowOop: vi.fn(),
  fetchGtForwardRowOop: vi.fn(),
  fetchGtTreeChildren: vi.fn(),
  fetchMethodSource: vi.fn(),
  fetchMethodBrowseLocation: vi.fn(),
}));

vi.mock('../systemBrowser', () => ({
  SystemBrowser: { navigateBeside: vi.fn() },
}));

import * as vscode from 'vscode';
import * as debug from '../debugQueries';
import * as queries from '../queries/getGtViewSpecs';
import { SystemBrowser } from '../systemBrowser';
import { GtInspector } from '../gtInspector';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';

// ── Mock panel factory ─────────────────────────────────────────────────────
// Each panel is self-contained: its own postMessage, title, and sendMessage.

function makeMockPanel() {
  const postMessage = vi.fn();
  let title = '';
  let messageHandler: ((msg: any) => void) | undefined;

  const panel = {
    webview: {
      set html(_: string) {},
      postMessage,
      onDidReceiveMessage(cb: (msg: any) => void) {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    },
    get title() { return title; },
    set title(v: string) { title = v; },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };

  return {
    panel,
    get postMessage() { return postMessage; },
    get title() { return title; },
    sendMessage(msg: any) { messageHandler!(msg); },
  };
}

function createMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

// ── Shared state ───────────────────────────────────────────────────────────

let session: ActiveSession;
let mock: ReturnType<typeof makeMockPanel>;

function setup(oop = 1000n, label = 'test') {
  GtInspector.create(session, oop, label);
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  session = createMockSession();
  mock = makeMockPanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mock.panel as any);
  vi.mocked(debug.fetchPrintString).mockReturnValue({ value: 'an Object', truncated: false });
  vi.mocked(debug.getObjectClassName).mockReturnValue('Object');
  vi.mocked(queries.getGtViewSpecs).mockReturnValue([]);
  vi.mocked(queries.fetchObjectMeta).mockReturnValue('{}');
});

afterEach(() => {
  GtInspector.disposeForSession(session.id);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GtInspector', () => {
  describe('A — panel lifecycle', () => {
    it('create() opens the panel with ViewColumn.Beside', () => {
      expect.assertions(1);
      GtInspector.create(session, 1000n, 'test');
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneSuperInspector',
        'Inspector',
        vscode.ViewColumn.Beside,
        expect.any(Object),
      );
    });

    it('disposeForSession() disposes all panels registered to a session', () => {
      expect.assertions(2);
      const mock2 = makeMockPanel();
      vi.mocked(vscode.window.createWebviewPanel)
        .mockReturnValueOnce(mock.panel as any)
        .mockReturnValueOnce(mock2.panel as any);
      GtInspector.create(session, 1000n, 'first');
      GtInspector.create(session, 2000n, 'second');
      GtInspector.disposeForSession(session.id);
      expect(mock.panel.dispose).toHaveBeenCalled();
      expect(mock2.panel.dispose).toHaveBeenCalled();
    });

    it('disposeForSession() is a no-op for an unknown session id', () => {
      expect.assertions(1);
      expect(() => GtInspector.disposeForSession(9999)).not.toThrow();
    });
  });

  describe('B — ready: panel title', () => {
    it('sets title from fetchPrintString when not truncated', () => {
      expect.assertions(1);
      vi.mocked(debug.fetchPrintString).mockReturnValue({ value: 'an Array(3)', truncated: false });
      setup();
      mock.sendMessage({ command: 'ready' });
      expect(mock.title).toBe('an Array(3)');
    });

    it('appends ellipsis to title when print string is truncated', () => {
      expect.assertions(1);
      vi.mocked(debug.fetchPrintString).mockReturnValue({ value: 'a very long string', truncated: true });
      setup();
      mock.sendMessage({ command: 'ready' });
      expect(mock.title).toBe('a very long string…');
    });

    it('calls fetchPrintString with the inspector oop and a limit of 40', () => {
      expect.assertions(2);
      setup(5555n);
      mock.sendMessage({ command: 'ready' });
      const [, oop, limit] = vi.mocked(debug.fetchPrintString).mock.calls[0];
      expect(oop).toBe(5555n);
      expect(limit).toBe(40);
    });
  });

  describe('C — ready: gtViewSpecs message', () => {
    it('always includes meta in the gtViewSpecs message', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchObjectMeta).mockReturnValue('{"className":"Array"}');
      setup();
      mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'gtViewSpecs', meta: '{"className":"Array"}' }),
      );
    });

    it('passes specs through in the gtViewSpecs message even when null', () => {
      expect.assertions(1);
      vi.mocked(queries.getGtViewSpecs).mockReturnValue(null);
      setup();
      mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'gtViewSpecs', specs: null }),
      );
    });

    it('includes className from getObjectClassName in the gtViewSpecs message', () => {
      expect.assertions(1);
      vi.mocked(debug.getObjectClassName).mockReturnValue('OrderedCollection');
      setup();
      mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'gtViewSpecs', className: 'OrderedCollection' }),
      );
    });
  });

  describe('D — fetchGtViewData routing', () => {
    it('routes gtPrintFor: + text editor view to fetchGtPrintTabData', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtPrintTabData).mockReturnValue({ data: '{}', truncated: false });
      setup();
      mock.sendMessage({ command: 'fetchGtViewData', oop: '1000', methodSelector: 'gtPrintFor:', viewName: 'GtPhlowTextEditorViewSpecification' });
      expect(queries.fetchGtPrintTabData).toHaveBeenCalled();
    });

    it('routes text view to fetchGtTextData', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtTextData).mockReturnValue('{}');
      setup();
      mock.sendMessage({ command: 'fetchGtViewData', oop: '1000', methodSelector: 'gtTextFor:', viewName: 'GtPhlowTextViewSpecification' });
      expect(queries.fetchGtTextData).toHaveBeenCalled();
    });

    it('routes list view to fetchGtListData', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtListData).mockReturnValue('[]');
      setup();
      mock.sendMessage({ command: 'fetchGtViewData', oop: '1000', methodSelector: 'gtItemsFor:', viewName: 'GtPhlowListViewSpecification' });
      expect(queries.fetchGtListData).toHaveBeenCalled();
    });
  });

  describe('E — fetchGtViewTotal routing', () => {
    it('routes forward view to fetchGtForwardListTotal', () => {
      expect.assertions(2);
      vi.mocked(queries.fetchGtForwardListTotal).mockReturnValue(42);
      setup();
      mock.sendMessage({ command: 'fetchGtViewTotal', oop: '1000', methodSelector: 'gtForwardFor:', viewName: 'GtPhlowForwardViewSpecification' });
      expect(queries.fetchGtForwardListTotal).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'gtViewTotal', total: 42 }),
      );
    });

    it('routes non-forward view to fetchGtListTotal', () => {
      expect.assertions(2);
      vi.mocked(queries.fetchGtListTotal).mockReturnValue(10);
      setup();
      mock.sendMessage({ command: 'fetchGtViewTotal', oop: '1000', methodSelector: 'gtItemsFor:', viewName: 'GtPhlowListViewSpecification' });
      expect(queries.fetchGtListTotal).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'gtViewTotal', total: 10 }),
      );
    });
  });

  describe('F — gtInspectRow: double-click opens new inspector', () => {
    it('opens a new panel with ViewColumn.Beside when a row is double-clicked', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtRowOop).mockReturnValue(9999n);
      setup();
      const newMock = makeMockPanel();
      vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(newMock.panel as any);
      mock.sendMessage({ command: 'gtInspectRow', itemOop: '1000', methodSelector: 'gtItemsFor:', nodeId: 3, viewName: 'GtPhlowListViewSpecification' });
      expect(vscode.window.createWebviewPanel).toHaveBeenLastCalledWith(
        'gemstoneSuperInspector',
        'Inspector',
        vscode.ViewColumn.Beside,
        expect.any(Object),
      );
    });

    it('uses fetchGtForwardRowOop for double-click on a forward view row', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtForwardRowOop).mockReturnValue(8888n);
      setup();
      const newMock = makeMockPanel();
      vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(newMock.panel as any);
      mock.sendMessage({ command: 'gtInspectRow', itemOop: '1000', methodSelector: 'gtForwardFor:', nodeId: 2, viewName: 'GtPhlowForwardViewSpecification' });
      expect(queries.fetchGtForwardRowOop).toHaveBeenCalled();
    });

    it('does not open a new inspector when row OOP is null', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchGtRowOop).mockReturnValue(null);
      setup();
      const callsBefore = vi.mocked(vscode.window.createWebviewPanel).mock.calls.length;
      mock.sendMessage({ command: 'gtInspectRow', itemOop: '1000', methodSelector: 'gtItemsFor:', nodeId: 3, viewName: 'GtPhlowListViewSpecification' });
      expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(callsBefore);
    });
  });

  describe('G — browseMethod', () => {
    it('calls SystemBrowser.navigateBeside when location is found', () => {
      expect.assertions(1);
      vi.mocked(queries.fetchMethodBrowseLocation).mockReturnValue({ dictName: 'Globals', className: 'Array', category: 'accessing' });
      setup();
      mock.sendMessage({ command: 'browseMethod', oop: '1000', methodSelector: 'size', isClassSide: false });
      expect(SystemBrowser.navigateBeside).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ className: 'Array', selector: 'size' }),
      );
    });

    it('shows a warning and does not navigate when location is null', () => {
      expect.assertions(2);
      vi.mocked(queries.fetchMethodBrowseLocation).mockReturnValue(null);
      setup();
      mock.sendMessage({ command: 'browseMethod', oop: '1000', methodSelector: 'size', isClassSide: false });
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      expect(SystemBrowser.navigateBeside).not.toHaveBeenCalled();
    });
  });
});
