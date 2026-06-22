import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

// A controlled five-frame stack, modelled on `JasperDebugDemo new run`:
//   level 1 — a block frame in JasperDebugDemo>>finish
//   level 2 — an inherited method: receiver is a SmallInteger, halt is in Object
//   levels 3-5 — plain recursive frames (JasperDebugDemo>>accumulateFrom:to:)
//                which also exercise the repeated-label / deep-stack case.
vi.mock('../debugQueries', () => ({
  getStackDepth: vi.fn(() => 5),
  getFrameInfo: vi.fn((_s: unknown, _p: unknown, level: number) => ({
    methodOop: BigInt(level),
    ipOffset: 5,
    receiverOop: BigInt(level * 100),
    argAndTempNames: [],
    argAndTempOops: [],
  })),
  getMethodBlockInfo: vi.fn((_s: unknown, methodOop: bigint) => ({
    isBlock: methodOop === 1n,
    homeMethodOop: methodOop,
  })),
  getMethodUriInfo: vi.fn(() => undefined),
  getMethodInfo: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
    if (oop === 2n) return { className: 'Object', selector: 'halt' };
    return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
  }),
  getObjectClassName: vi.fn((_s: unknown, receiverOop: bigint) =>
    receiverOop === 200n ? 'SmallInteger' : 'JasperDebugDemo'),
  getLineForIp: vi.fn(() => 12),
  getStepPoint: vi.fn(() => 2),
  getMethodSource: vi.fn(() => '| t | t := 6 * 7. t halt'),
  getObjectPrintString: vi.fn((_s: unknown, oop: bigint) => `<print ${oop}>`),
  evaluateInFrame: vi.fn(() => '42'),
  continueExecution: vi.fn(() => ({ completed: true })),
  stepOver: vi.fn(() => ({ completed: false })),
  stepInto: vi.fn(() => ({ completed: false })),
  stepOut: vi.fn(() => ({ completed: false })),
  trimStackToLevel: vi.fn(),
  clearStack: vi.fn(),
  acquireStepping: vi.fn(),
  releaseStepping: vi.fn(),
}));

// Source offsets for the step-point highlight. These are GemStone `_sourceOffsets`,
// which are 1-BASED (index i = offset of step point i+1); the panel must convert
// them to 0-based for doc.positionAt.
vi.mock('../browserQueries', () => ({
  getSourceOffsets: vi.fn(() => [1, 8, 26]),
}));

import * as vscode from 'vscode';
import * as debug from '../debugQueries';
import {
  DebuggerPanel, formatFrameLabel, formatFramePosition,
  formatFrameForClipboard, formatStackForClipboard, buildMethodSourceUri,
  filterStack, isExceptionMachinery, RawFrame,
} from '../debuggerPanel';
import { wrapWithTranscriptCapture } from '../transcriptCapture';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';

const GS_PROCESS = 0x123n;
const ERROR_MSG = 'a UndefinedObject does not understand #foo';

function makeSession(): ActiveSession {
  return {
    id: 1,
    handle: { h: 1 },
    login: {
      label: 'Test', gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'devhost',
    } as GemStoneLogin,
    stoneVersion: '3.7.2',
    gci: { GciTsClearStack: vi.fn() } as unknown as ActiveSession['gci'],
  } as ActiveSession;
}

/** The most recently created webview panel mock. */
function lastPanel() {
  const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return results[results.length - 1].value;
}

/** Invoke the panel's webview message handler with an arbitrary message. */
function sendMessage(panel: ReturnType<typeof lastPanel>, msg: unknown) {
  panel.webview.onDidReceiveMessage.mock.calls[0][0](msg);
}

/** Simulate the webview finishing load and requesting data. */
function sendReady(panel: ReturnType<typeof lastPanel>) {
  sendMessage(panel, { command: 'ready' });
}

/** Simulate the user closing the panel window. */
function closePanel(panel: ReturnType<typeof lastPanel>) {
  const handler = panel.onDidDispose.mock.calls[0][0];
  handler();
}

/** The `init` payload the panel posts back to the webview after `ready`. */
function initPayload(panel: ReturnType<typeof lastPanel>) {
  const call = panel.webview.postMessage.mock.calls
    .find((c: unknown[]) => (c[0] as { command: string }).command === 'init');
  return call?.[0];
}

/** All payloads the panel posted to the webview with the given command. */
function posted(panel: ReturnType<typeof lastPanel>, command: string) {
  return panel.webview.postMessage.mock.calls
    .map((c: unknown[]) => c[0] as { command: string })
    .filter((m: { command: string }) => m.command === command);
}
/** The most recent payload posted with the given command (or undefined). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastPosted(panel: ReturnType<typeof lastPanel>, command: string): any {
  const all = posted(panel, command);
  return all[all.length - 1];
}

describe('formatFrameLabel', () => {
  it('names a plain frame `Class>>#selector` when receiver matches the defining class', () => {
    expect(formatFrameLabel({
      isBlock: false, definingClass: 'JasperDebugDemo', selector: 'finish',
      receiverClass: 'JasperDebugDemo',
    })).toBe('JasperDebugDemo>>#finish');
  });

  it('disambiguates an inherited method as `Receiver (Defining)>>#selector`', () => {
    expect(formatFrameLabel({
      isBlock: false, definingClass: 'Object', selector: 'printString',
      receiverClass: 'Array',
    })).toBe('Array (Object)>>#printString');
  });

  it('omits disambiguation when the receiver class is unavailable', () => {
    expect(formatFrameLabel({
      isBlock: false, definingClass: 'Object', selector: 'printString',
    })).toBe('Object>>#printString');
  });

  it('prefixes a block frame with `[] in ` and never disambiguates the receiver', () => {
    expect(formatFrameLabel({
      isBlock: true, definingClass: 'JasperDebugDemo', selector: 'finish',
      receiverClass: 'SomethingElse',
    })).toBe('[] in JasperDebugDemo>>#finish');
  });

  it('handles inherited class-side methods (metaclass names already include " class")', () => {
    expect(formatFrameLabel({
      isBlock: false, definingClass: 'Object class', selector: 'new',
      receiverClass: 'JasperDebugDemo class',
    })).toBe('JasperDebugDemo class (Object class)>>#new');
  });
});

describe('formatFramePosition', () => {
  it('formats step point and line as `@<step> line <line>`', () => {
    expect(formatFramePosition(2, 12)).toBe('@2 line 12');
  });

  it('shows only the step point when the line is unavailable', () => {
    expect(formatFramePosition(2, undefined)).toBe('@2');
  });

  it('shows only the line when the step point is unavailable', () => {
    expect(formatFramePosition(undefined, 12)).toBe('line 12');
  });

  it('returns an empty string when neither is available', () => {
    expect(formatFramePosition(undefined, undefined)).toBe('');
  });

  it('omits a line of 0 (an unmapped IP has no source line)', () => {
    expect(formatFramePosition(2, 0)).toBe('@2');
    expect(formatFramePosition(undefined, 0)).toBe('');
  });
});

describe('formatFrameForClipboard', () => {
  it('renders `<label>  <position>` with no leading frame number', () => {
    expect(formatFrameForClipboard({ level: 2, label: 'SmallInteger (Object)>>#halt', position: '@2 line 12' }))
      .toBe('SmallInteger (Object)>>#halt  @2 line 12');
  });

  it('omits the position when the frame has none', () => {
    expect(formatFrameForClipboard({ level: 1, label: 'A>>#x', position: '' })).toBe('A>>#x');
  });
});

describe('formatStackForClipboard', () => {
  const frames = [
    { level: 1, label: 'A>>#x', position: '@2 line 3' },
    { level: 2, label: 'B>>#y', position: '' },
  ];

  it('renders an error header followed by numbered frames with positions', () => {
    expect(formatStackForClipboard('boom', frames)).toBe(
      ['GemStone error: boom', '', '1. A>>#x  @2 line 3', '2. B>>#y'].join('\n'),
    );
  });

  it('omits the error header when there is no error message', () => {
    expect(formatStackForClipboard('', frames)).toBe(
      ['1. A>>#x  @2 line 3', '2. B>>#y'].join('\n'),
    );
  });

  it('omits the position when a frame has none', () => {
    expect(formatStackForClipboard('', [{ level: 1, label: 'A>>#x', position: '' }]))
      .toBe('1. A>>#x');
  });
});

describe('DebuggerPanel', () => {
  let session: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    // tabGroups.all is a plain array on the mock, not a vi.fn — reset it so a
    // test that populates it doesn't leak into the next.
    (vscode.window.tabGroups.all as unknown as unknown[]).length = 0;
    session = makeSession();
  });

  it('opens beside the active editor group with the title "Jasper Debugger"', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);

    const call = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
    expect(call[1]).toBe('Jasper Debugger');           // tab title
    expect(call[2]).toBe(vscode.ViewColumn.Beside);    // to the right of the active group
    expect(call[3]).toMatchObject({ enableScripts: true });
  });

  it('shows a dimmed "For <user> on <stone> @ <host>" subtitle from the login', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain('For DataCurator on gs64stone @ devhost');
    // The subtitle uses the dimmed description color.
    expect(html).toMatch(/\.subtitle\s*\{[^}]*--vscode-descriptionForeground/);
  });

  it('HTML-escapes session text so it cannot inject markup into the page', () => {
    session.login = {
      label: 'T', gs_user: '<img src=x>', stone: 's&s', gem_host: 'h"h',
    } as GemStoneLogin;
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain(
      '<span class="subtitle">For &lt;img src=x&gt; on s&amp;s @ h&quot;h</span>',
    );
    expect(html).not.toContain('<img src=x>');   // raw, unescaped tag must not appear
  });

  it('builds a partial subtitle when some login fields are missing', () => {
    session.login = { label: 'T', gs_user: 'solo' } as GemStoneLogin; // no stone / host
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const html = lastPanel().webview.html;

    expect(html).toContain('<span class="subtitle">For solo</span>');
  });

  it('disposeForSession disposes every panel created for the session', () => {
    const s = { ...makeSession(), id: 4242 } as ActiveSession;
    DebuggerPanel.create(s, GS_PROCESS, ERROR_MSG);
    DebuggerPanel.create(s, 0x456n, 'another error');
    const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
    const p1 = results[results.length - 2].value;
    const p2 = results[results.length - 1].value;

    DebuggerPanel.disposeForSession(4242);

    expect(p1.dispose).toHaveBeenCalled();
    expect(p2.dispose).toHaveBeenCalled();
  });

  it('posts the error string back to the webview unchanged', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();
    sendReady(panel);

    expect(initPayload(panel).errorMessage).toBe(ERROR_MSG);
  });

  describe('copy / context menu', () => {
    it('provides a Copy Stack button and a Copy Frame popup item, and suppresses the default menu', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toContain('id="copyBtn"');                    // Copy Stack button
      expect(html).toContain('Copy Stack');
      expect(html).toContain('id="copyFrameItem"');              // Copy Frame popup item
      expect(html).toContain('Copy Frame');
      expect(html).toContain('copyFrame');                       // per-frame copy wiring
      expect(html).toMatch(/addEventListener\(\s*'contextmenu'/); // default menu suppressed + custom menu
      expect(html).toContain('preventDefault');
    });

    it('writes the formatted stack to the clipboard on a copyStack message', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);            // fetches + caches the stack
      sendMessage(panel, { command: 'copyStack' });

      const expected = [
        'GemStone error: a UndefinedObject does not understand #foo',
        '',
        '1. [] in JasperDebugDemo>>#finish  @2 line 12',
        '2. SmallInteger (Object)>>#halt  @2 line 12',
        '3. JasperDebugDemo>>#accumulateFrom:to:  @2 line 12',
        '4. JasperDebugDemo>>#accumulateFrom:to:  @2 line 12',
        '5. JasperDebugDemo>>#accumulateFrom:to:  @2 line 12',
      ].join('\n');
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(expected);
    });

    it('writes a single frame (no leading number) to the clipboard on copyFrame', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyFrame', level: 2 });

      expect(vscode.env.clipboard.writeText)
        .toHaveBeenCalledWith('SmallInteger (Object)>>#halt  @2 line 12');
    });

    it('ignores copyFrame for an unknown level without writing the clipboard', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'copyFrame', level: 999 });

      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('frame list', () => {
    it('renders step point & line in a dimmed `.pos` element', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toMatch(/\.pos\s*\{[^}]*--vscode-descriptionForeground/);
    });

    it('numbers the frames 1..N, strictly ascending, for easy reference', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      const levels = initPayload(panel).stack.map((f: { level: number }) => f.level);
      // A deep stack (>2) so "ascending" is a meaningful assertion, not a coincidence.
      expect(levels.length).toBeGreaterThan(2);
      // Numbered 1..N with no gaps, no duplicates, strictly increasing.
      expect(levels).toEqual(levels.map((_: number, i: number) => i + 1));
    });

    it('builds frame labels with block prefix, receiver disambiguation, and position', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack).toEqual([
        { level: 1, label: '[] in JasperDebugDemo>>#finish', position: '@2 line 12' },
        { level: 2, label: 'SmallInteger (Object)>>#halt', position: '@2 line 12' },
        { level: 3, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
        { level: 4, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
        { level: 5, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '@2 line 12' },
      ]);
    });

    // Ported from the DAP stackTraceRequest "doit frame" test: a valid frame
    // whose method can't be introspected is `Executed Code`, NOT an error.
    it('labels a frame `Executed Code` when its method cannot be resolved', () => {
      // getMethodUriInfo already returns undefined in the base mock; make the
      // getMethodInfo fallback throw for the first frame (as a doit/anon frame).
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => {
        throw new Error('does not understand #inClass');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack[0].label).toBe('Executed Code');
    });

    // The other fallback branch: when the frame contents themselves can't be
    // fetched, the frame is `<frame N>` with no position (vs. "unavailable").
    it('labels a frame `<frame N>` when its contents cannot be fetched', () => {
      vi.mocked(debug.getFrameInfo).mockImplementationOnce(() => {
        throw new Error('cannot fetch frame contents');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack[0]).toEqual({ level: 1, label: '<frame 1>', position: '' });
    });

    // An "unprintable" / unresolvable receiver: getObjectClassName throws. The
    // label must still render (no crash), just without receiver disambiguation.
    it('falls back to the defining class when the receiver class cannot be fetched', () => {
      // First non-block frame (level 2) is the only one that queries the
      // receiver class; make that query throw.
      vi.mocked(debug.getObjectClassName).mockImplementationOnce(() => {
        throw new Error('receiver does not understand #class');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      // Without the receiver class there is no `Receiver (Defining)` form —
      // just the plain defining-class label.
      expect(initPayload(panel).stack[1]).toEqual({
        level: 2, label: 'Object>>#halt', position: '@2 line 12',
      });
    });

    // fetchStack's outer guard: if the stack can't even be measured (e.g. the
    // process died), the panel posts an empty stack rather than throwing.
    it('returns an empty stack when the stack-depth query fails', () => {
      vi.mocked(debug.getStackDepth).mockImplementationOnce(() => {
        throw new Error('process is dead');
      });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);

      expect(initPayload(panel).stack).toEqual([]);
    });
  });

  describe('source pane', () => {
    // Let revealFrameSource's awaited openTextDocument/showTextDocument settle.
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    const URI_INFO = {
      dictName: 'UserGlobals', className: 'JasperDebugDemo', isMeta: false,
      category: 'accessing', selector: 'accumulateFrom:to:',
    };

    // The editor showTextDocument resolved to on the most recent call.
    async function shownEditor() {
      const results = vi.mocked(vscode.window.showTextDocument).mock.results;
      return await results[results.length - 1].value;
    }

    // Open the panel and load the (unfiltered, 5-frame) stack so selectFrame can
    // map a display level back to its server level. Reveal-specific mocks are set
    // AFTER this — fetchStack consumes only the base mocks, never the per-test
    // `…Once` ones, which are then picked up by the single revealFrameSource call.
    function openPanelWithStack() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('builds a gemstone:// URI of the form scheme/dict/class/side/category/selector', () => {
      expect(buildMethodSourceUri(7, URI_INFO))
        .toBe('gemstone://7/UserGlobals/JasperDebugDemo/instance/accessing/accumulateFrom%3Ato%3A');
    });

    it('uses the "class" side for metaclass methods', () => {
      expect(buildMethodSourceUri(7, { ...URI_INFO, isMeta: true }))
        .toContain('/JasperDebugDemo/class/');
    });

    it('opens the method source (gemstone://) in a group BELOW the panel, keeping focus', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // for the reveal of frame 3
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone');
      expect(openUri.toString()).toContain('JasperDebugDemo');

      // Docked below: focus the panel's group, then split a new group beneath it.
      expect(panel.reveal).toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.newGroupBelow');

      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: true, preserveFocus: true }),
      );
    });

    it('highlights the step-point token, converting the 1-based source offset to 0-based', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      // step point 2 → getSourceOffsets()[1] === 8 (1-based) → positionAt(8 - 1) → (0, 7).
      // Regression guard for C1: dropping the "-1" would land the highlight at column 8.
      // No word range in the mock → a one-character marker, NOT the whole line.
      const range = vi.mocked(editor.setDecorations).mock.calls[0][1][0] as vscode.Range;
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(7);          // 8 (1-based) - 1, NOT 8
      expect(range.end.character - range.start.character).toBe(1);
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('shows the executed source read-only, stripped of the Transcript-capture glue', async () => {
      const panel = openPanelWithStack();
      // A true doit frame: no class>>selector at all (getMethodUriInfo AND
      // getMethodInfo both fail to resolve a home class). Its stored source is
      // the wrapped form; the panel must unwrap it.
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => { throw new Error('doit: nil inClass'); });
      vi.mocked(debug.getMethodSource).mockReturnValueOnce(
        wrapWithTranscriptCapture('JasperDebugDemo new run').wrappedCode,
      );
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone-debug');
      expect(openUri.path).toBe('Executed Code');
      expect(debug.getMethodSource).toHaveBeenCalled();

      // The content provider serves the UNWRAPPED user code (read-only, never dirty).
      // (First read-only frame in the suite, so registration happens here.)
      const reg = vi.mocked(vscode.workspace.registerTextDocumentContentProvider).mock.calls[0];
      expect(reg[0]).toBe('gemstone-debug');
      const provider = reg[1] as { provideTextDocumentContent(u: vscode.Uri): string };
      expect(provider.provideTextDocumentContent(openUri)).toBe('JasperDebugDemo new run');
    });

    it('titles a read-only NON-symbol-list method by its method name (C3: never mislabel as Executed Code)', async () => {
      const panel = openPanelWithStack();
      // Frame 3: no dictName (getMethodUriInfo → undefined) but getMethodInfo
      // resolves a real class → a method, NOT executed code. It must open titled
      // by the method, not under "Executed Code".
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const openUri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      expect(openUri.scheme).toBe('gemstone-debug');
      expect(openUri.path).toBe('JasperDebugDemo>>#accumulateFrom:to:');
    });

    it('does NOT highlight a read-only frame (C2 — no reliable IP→source mapping)', async () => {
      // When we add highlighting to the read-only view, THIS test should fail —
      // that's the reminder to add real highlight coverage for it.
      const panel = openPanelWithStack(); // frame 3 → read-only (no gemstone:// URI)
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      expect(vi.mocked(editor.setDecorations).mock.calls[0][1]).toEqual([]); // cleared, not set
      expect(editor.revealRange).not.toHaveBeenCalled();
    });

    it('clears the highlight (no reveal) when there is no step point and no source line', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      vi.mocked(debug.getStepPoint).mockReturnValueOnce(0);   // no step point (reveal)
      vi.mocked(debug.getLineForIp).mockReturnValueOnce(0);   // unmapped IP   (reveal)
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      expect(vi.mocked(editor.setDecorations).mock.calls[0][1]).toEqual([]);
      expect(editor.revealRange).not.toHaveBeenCalled();
    });

    it('clears the step-point highlight when the panel is closed', async () => {
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();
      const editor = await shownEditor();
      vi.mocked(editor.setDecorations).mockClear();

      closePanel(panel);

      expect(editor.setDecorations).toHaveBeenCalledWith(expect.anything(), []);
    });

    // A source editor that reports a real view column (VS Code resolves Active/
    // Beside to one), so the panel can remember and target its source group.
    function columnedEditor(viewColumn: number) {
      return {
        document: {
          languageId: 'gemstone-smalltalk',
          positionAt: (o: number) => new vscode.Position(0, o),
          getWordRangeAtPosition: () => undefined,
          lineAt: () => ({ firstNonWhitespaceCharacterIndex: 0 }),
        },
        viewColumn,
        setDecorations: vi.fn(),
        revealRange: vi.fn(),
      };
    }

    it('closes the companion source editor when the panel is closed', async () => {
      const panel = openPanelWithStack();
      // Set AFTER ready so these apply to the frame-3 reveal (not the stack walk):
      // a real gemstone:// method source, shown in source column 9.
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri).toString();
      // Same method also open in the user's System Browser (column 1) — must NOT
      // close. `label` only distinguishes the (structurally identical) tabs here.
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const browserTab = { label: 'browser', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as { viewColumn: number; tabs: unknown[] }[];
      groups.push({ viewColumn: 1, tabs: [browserTab] }, { viewColumn: 9, tabs: [sourceTab] });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(sourceTab);
    });

    it('closes nothing when the debugger never opened a source editor', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel); // no frame selected → no source opened
      const groups = vscode.window.tabGroups.all as unknown as { viewColumn: number; tabs: unknown[] }[];
      groups.push({ viewColumn: 9, tabs: [{ input: new vscode.TabInputText(vscode.Uri.parse('gemstone://1/x')) }] });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).not.toHaveBeenCalled();
    });

    it('still closes a read-only (gemstone-debug:) source even when the source column is unknown', async () => {
      // Default mock editor has no viewColumn → sourceColumn stays undefined. The
      // read-only scheme is unique to this debugger, so it's safe to close anywhere
      // (a shared gemstone:// would NOT be — see the previous test's column guard).
      const panel = openPanelWithStack(); // frame 3 → read-only (base getMethodUriInfo → undefined)
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const uri = (vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri);
      expect(uri.scheme).toBe('gemstone-debug');
      const tab = { input: new vscode.TabInputText(vscode.Uri.parse(uri.toString())) };
      const groups = vscode.window.tabGroups.all as unknown as { viewColumn: number; tabs: unknown[] }[];
      groups.push({ viewColumn: 1, tabs: [tab] });

      closePanel(panel);

      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(tab);
    });
  });

  it('terminates the suspended gsProcess (via clearStack) when the panel window is closed', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();

    expect(debug.clearStack).not.toHaveBeenCalled();
    closePanel(panel);
    expect(debug.clearStack).toHaveBeenCalledWith(session, GS_PROCESS);
  });

  it('holds native code off for the session: acquires on open, releases on close', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();

    expect(debug.acquireStepping).toHaveBeenCalledWith(session);
    expect(debug.releaseStepping).not.toHaveBeenCalled();
    closePanel(panel);
    expect(debug.releaseStepping).toHaveBeenCalledWith(session);
  });

  describe('variables / eval / toolbar', () => {
    // clearAllMocks() doesn't reset return values/implementations, so restore the
    // base getFrameInfo each test (a test that overrides it would otherwise leak).
    beforeEach(() => {
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) => ({
        methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100),
        argAndTempNames: [], argAndTempOops: [],
      }));
    });

    function openPanel() {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    it('posts the selected frame variables (self first, then args/temps) on selectFrame', () => {
      // Only server level 2 carries temps; other frames keep the base shape so the
      // 5-frame stack still renders and level 2 survives filtering (mid-stack).
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) =>
        level === 2
          ? { methodOop: 2n, ipOffset: 5, receiverOop: 300n, argAndTempNames: ['amount', 'total'], argAndTempOops: [11n, 22n] }
          : { methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100), argAndTempNames: [], argAndTempOops: [] });
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const vars = lastPosted(panel, 'variables').vars;
      expect(vars[0]).toEqual({ name: 'self', value: '<print 300>' });
      expect(vars).toContainEqual({ name: 'amount', value: '<print 11>' });
      expect(vars).toContainEqual({ name: 'total', value: '<print 22>' });
    });

    it('evaluates an expression in the selected frame and posts the result', () => {
      vi.mocked(debug.evaluateInFrame).mockReturnValueOnce('1764');
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: '42 * 42' });

      expect(debug.evaluateInFrame).toHaveBeenCalledWith(session, GS_PROCESS, '42 * 42', 3);
      expect(lastPosted(panel, 'evalResult')).toMatchObject({ value: '1764', isError: false });
    });

    it('reports an eval error without throwing', () => {
      vi.mocked(debug.evaluateInFrame).mockImplementationOnce(() => { throw new Error('doesNotUnderstand'); });
      const panel = openPanel();
      sendMessage(panel, { command: 'evalInFrame', level: 3, expr: 'foo bar' });

      expect(lastPosted(panel, 'evalResult')).toMatchObject({ isError: true });
      expect(lastPosted(panel, 'evalResult').value).toContain('doesNotUnderstand');
    });

    it('Resume disposes the panel when execution completes', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true });
      const panel = openPanel();
      sendMessage(panel, { command: 'resume' });

      expect(debug.continueExecution).toHaveBeenCalledWith(session, GS_PROCESS);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('Resume refreshes with the new error when it hits another stop', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: false, errorMessage: 'next error' });
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'resume' });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before + 1); // refreshed
      expect(lastPosted(panel, 'init').errorMessage).toBe('next error');
    });

    it('Step Over steps from the selected user frame (display level → server level) and refreshes, clearing the error banner', () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'stepOver', level: 3 }); // display 3 → server level 3

      expect(debug.stepOver).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(posted(panel, 'init').length).toBe(before + 1);
      expect(lastPosted(panel, 'init').errorMessage).toBe('');
      expect(panel.dispose).not.toHaveBeenCalled();
    });

    it('surfaces a clear message when a step hits native-code (error 6014), without disposing', () => {
      vi.mocked(debug.stepOver).mockReturnValueOnce({
        completed: false,
        errorMessage: 'a ImproperOperation occurred (error 6014), Breakpoint and single-step not supported in native code',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/native code/i);
    });

    it('Step disposes the panel when the step completes the process', () => {
      vi.mocked(debug.stepOver).mockReturnValueOnce({ completed: true });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('"Through" maps to gciStepThru (debugQueries.stepOut), from the selected user frame', () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepThrough', level: 4 }); // display 4 → server level 4

      expect(debug.stepOut).toHaveBeenCalledWith(session, GS_PROCESS, 4);
    });

    it('Restart Frame trims the stack to the selected frame and refreshes', () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'restartFrame', level: 2 });

      expect(debug.trimStackToLevel).toHaveBeenCalledWith(session, GS_PROCESS, 2);
      expect(posted(panel, 'init').length).toBe(before + 1);
    });

    it('Terminate disposes the panel', () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'terminate' });

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('hands the completed result to onComplete on Resume, then disposes', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: true, resultOop: 0x55n });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'resume' });

      expect(onComplete).toHaveBeenCalledWith(0x55n);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('hands the completed result to onComplete on step-to-completion', () => {
      vi.mocked(debug.stepOver).mockReturnValueOnce({ completed: true, resultOop: 0x66n });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'stepOver', level: 1 });

      expect(onComplete).toHaveBeenCalledWith(0x66n);
      expect(panel.dispose).toHaveBeenCalled();
    });

    it('does NOT call onComplete when Resume hits another error (refreshes instead)', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({ completed: false, errorMessage: 'boom2' });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'resume' });

      expect(onComplete).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
    });
  });
});

// ── Stack filtering ────────────────────────────────────────────────
// Models the real `JasperDebugDemo new run` halt stack (captured live, id 4):
//   top = AbstractException signal machinery + Object>>halt,
//   bottom = the transcript-capture doit + its block/ensure: glue.
const DOIT = 999n;

function raw(p: Partial<RawFrame> & { serverLevel: number; label: string }): RawFrame {
  return {
    methodOop: BigInt(p.serverLevel), homeMethodOop: BigInt(p.serverLevel),
    isBlock: false, definingClassName: '', selector: '', isExecutedCode: false,
    ...p,
  };
}

// level 1 = top.
const HALT_STACK: RawFrame[] = [
  raw({ serverLevel: 1, label: 'AbstractException>>#_signalToDebugger', definingClassName: 'AbstractException', selector: '_signalToDebugger' }),
  raw({ serverLevel: 2, label: 'AbstractException>>#_signal', definingClassName: 'AbstractException', selector: '_signal' }),
  raw({ serverLevel: 3, label: 'AbstractException class>>#signal', definingClassName: 'AbstractException', selector: 'signal' }),
  raw({ serverLevel: 4, label: 'SmallInteger (Object)>>#halt', definingClassName: 'Object', selector: 'halt' }),
  raw({ serverLevel: 5, label: '[] in JasperDebugDemo>>#finish', definingClassName: 'JasperDebugDemo', selector: 'finish', isBlock: true, homeMethodOop: 10n }),
  raw({ serverLevel: 6, label: 'Array (Collection)>>#do:', definingClassName: 'Collection', selector: 'do:' }),
  raw({ serverLevel: 7, label: 'JasperDebugDemo>>#finish', definingClassName: 'JasperDebugDemo', selector: 'finish' }),
  raw({ serverLevel: 8, label: 'JasperDebugDemo>>#accumulateFrom:to:', definingClassName: 'JasperDebugDemo', selector: 'accumulateFrom:to:' }),
  raw({ serverLevel: 9, label: 'JasperDebugDemo>>#run', definingClassName: 'JasperDebugDemo', selector: 'run' }),
  raw({ serverLevel: 10, label: 'Executed Code', isBlock: true, homeMethodOop: DOIT, isExecutedCode: true }),
  raw({ serverLevel: 11, label: 'ExecBlock0 (ExecBlock)>>#ensure:', definingClassName: 'ExecBlock', selector: 'ensure:' }),
  raw({ serverLevel: 12, label: 'Executed Code', isBlock: true, homeMethodOop: DOIT, isExecutedCode: true }),
  raw({ serverLevel: 13, label: 'Executed Code', methodOop: DOIT, homeMethodOop: DOIT, isExecutedCode: true }),
  // GemStone leaves a <Reenter marker> BELOW the doit; getFrameInfo can't resolve
  // it so buildFrame yields a `<frame N>` (not executed-code). It must not block
  // the bottom collapse (the original bug) and must itself be dropped.
  raw({ serverLevel: 14, label: '<frame 14>' }),
];

describe('filterStack', () => {
  it('trims halt machinery off the top and the wrapper glue off the bottom', () => {
    const kept = filterStack(HALT_STACK);
    // Top = the user block where halt was sent; bottom = the doit (kept); the
    // signal frames, the wrapper frames (10, 11, 12) AND the reenter marker (14)
    // are gone. Exactly ONE "Executed Code" frame survives.
    expect(kept.map(f => f.serverLevel)).toEqual([5, 6, 7, 8, 9, 13]);
    expect(kept[0].label).toBe('[] in JasperDebugDemo>>#finish');
    expect(kept[kept.length - 1].label).toBe('Executed Code');
    expect(kept.filter(f => f.label === 'Executed Code')).toHaveLength(1);
    expect(kept.some(f => f.serverLevel === 14)).toBe(false); // reenter marker dropped
  });

  it('collapses the wrapper even when a non-executed-code frame sits below the doit', () => {
    // Regression: the <Reenter marker> at the very bottom used to make the trim
    // gate ("deepest frame is the doit") fail, leaving all the glue frames.
    const kept = filterStack(HALT_STACK);
    expect(kept.filter(f => f.isExecutedCode)).toHaveLength(1);
  });

  it('keeps mid-stack kernel frames (only trims contiguously from each end)', () => {
    // Array>>do: (level 6) sits between user frames and must survive.
    expect(filterStack(HALT_STACK).map(f => f.serverLevel)).toContain(6);
  });

  it('leaves a clean stack untouched (no machinery, no doit)', () => {
    const plain = HALT_STACK.slice(4, 9); // frames 5..9, all user frames
    expect(filterStack(plain)).toEqual(plain);
  });

  it('never trims the whole stack, even if every frame looks like machinery', () => {
    const allMachinery = HALT_STACK.slice(0, 4); // the 4 signal/halt frames
    const kept = filterStack(allMachinery);
    expect(kept.length).toBe(1);            // keeps the last as a floor
    expect(kept[0].serverLevel).toBe(4);
  });

  it('does not trim the bottom when the deepest frame is not a doit', () => {
    const noDoit = HALT_STACK.slice(4, 9); // ends at run, not Executed Code
    expect(filterStack(noDoit).map(f => f.serverLevel)).toEqual([5, 6, 7, 8, 9]);
  });

  it('returns short stacks unchanged', () => {
    expect(filterStack([])).toEqual([]);
    expect(filterStack([HALT_STACK[8]])).toEqual([HALT_STACK[8]]);
  });
});

describe('isExceptionMachinery', () => {
  it('flags AbstractException frames and halt/DNU/signal selectors', () => {
    expect(isExceptionMachinery(HALT_STACK[0])).toBe(true);  // _signalToDebugger
    expect(isExceptionMachinery(HALT_STACK[2])).toBe(true);  // class>>signal
    expect(isExceptionMachinery(HALT_STACK[3])).toBe(true);  // Object>>halt
    expect(isExceptionMachinery(raw({ serverLevel: 1, label: 'x', selector: 'doesNotUnderstand:' }))).toBe(true);
  });

  it('does not flag ordinary user/kernel frames', () => {
    expect(isExceptionMachinery(HALT_STACK[4])).toBe(false); // [] in finish
    expect(isExceptionMachinery(HALT_STACK[6])).toBe(false); // finish
    expect(isExceptionMachinery(HALT_STACK[5])).toBe(false); // Collection>>do:
  });
});
