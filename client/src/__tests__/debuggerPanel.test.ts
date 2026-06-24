import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  // Source offsets fetched straight from a method OOP (read-only doit / non-
  // symbol-list method). Same 1-based shape as browserQueries.getSourceOffsets.
  getSourceOffsetsForMethod: vi.fn(() => [1, 8, 26]),
  getMethodSource: vi.fn(() => '| t | t := 6 * 7. t halt'),
  getObjectPrintString: vi.fn((_s: unknown, oop: bigint) => `<print ${oop}>`),
  getInstVarNames: vi.fn(() => [] as string[]),
  getNamedInstVarOops: vi.fn(() => [] as bigint[]),
  evaluateInFrame: vi.fn(() => '42'),
  continueExecution: vi.fn(() => ({ completed: true })),
  stepOver: vi.fn(() => ({ completed: false })),
  stepInto: vi.fn(() => ({ completed: false })),
  stepOut: vi.fn(() => ({ completed: false })),
  // Non-blocking variants the webview panel now uses (resolve async).
  stepOverNb: vi.fn(async () => ({ completed: false })),
  stepIntoNb: vi.fn(async () => ({ completed: false })),
  stepThruNb: vi.fn(async () => ({ completed: false })),
  trimStackToLevel: vi.fn(),
  trimStackToLevelNb: vi.fn(async () => {}),
  clearStack: vi.fn(),
  acquireStepping: vi.fn(),
  releaseStepping: vi.fn(),
  // Create-method-from-DNU detection — defaults to "not a DNU" (no Create button).
  getDoesNotUnderstandInfo: vi.fn(() => undefined),
}));

// Clicking a variable row opens a GT Inspector — stub the static entry point.
// create() returns a closable handle so the debugger can close it on dispose.
vi.mock('../gtInspector', () => ({ GtInspector: { create: vi.fn(() => ({ close: vi.fn() })) } }));

// Source offsets for the step-point highlight. These are GemStone `_sourceOffsets`,
// which are 1-BASED (index i = offset of step point i+1); the panel must convert
// them to 0-based for doc.positionAt.
vi.mock('../browserQueries', () => ({
  getSourceOffsets: vi.fn(() => [1, 8, 26]),
}));

import * as vscode from 'vscode';
import * as debug from '../debugQueries';
import {
  DebuggerPanel, formatFrameLabel, formatFramePosition, buildMethodStub,
  formatFrameForClipboard, formatStackForClipboard, buildMethodSourceUri,
  filterStack, isExceptionMachinery, RawFrame,
  flattenLayoutLeaves, sourceRatioFromLayout, setSourceRatioInLayout, EditorGroupLayout,
} from '../debuggerPanel';
import { wrapWithTranscriptCapture } from '../transcriptCapture';
import { GtInspector } from '../gtInspector';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';

const GS_PROCESS = 0x123n;
const ERROR_MSG = 'a UndefinedObject does not understand #foo';

// The static step-point highlight decoration is built once, at module import —
// i.e. BEFORE the beforeEach vi.clearAllMocks() below wipes the mock's call
// record. Snapshot the options it was created with here, at top level, so the
// guard test (see "step-point highlight decoration") can still see them.
// Identify it by its themed base `backgroundColor` (unique to this decoration).
const stepPointDecorationOptions = vi
  .mocked(vscode.window.createTextEditorDecorationType)
  .mock.calls.map((c) => c[0] as vscode.DecorationRenderOptions)
  .find(
    (opts) =>
      opts?.backgroundColor instanceof vscode.ThemeColor &&
      (opts.backgroundColor as vscode.ThemeColor).id ===
        'editor.focusedStackFrameHighlightBackground',
  );

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

/**
 * Yield to the microtask/timer queue so an async panel handler (step / restart /
 * edit-and-continue now route through the awaited non-blocking Nb variants) can
 * settle before assertions. The mocked Nb fns resolve immediately, so one tick
 * is enough.
 */
const tick = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));

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

describe('buildMethodStub', () => {
  it('builds a keyword signature pairing each keyword with a generated arg', () => {
    expect(buildMethodStub('fourtyTwo:bar:', 2)).toMatch(/^fourtyTwo: arg1 bar: arg2\n/);
  });

  it('builds a binary signature with one argument', () => {
    expect(buildMethodStub('+', 1)).toMatch(/^\+ arg1\n/);
  });

  it('builds a bare unary signature', () => {
    expect(buildMethodStub('makeWidget', 0)).toMatch(/^makeWidget\n/);
  });

  it('includes a placeholder body so the method compiles as-is', () => {
    expect(buildMethodStub('foo', 0)).toContain('^nil');
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

    it('renders labelled, splittable Call Stack / Variables panes', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      expect(html).toContain('>Call Stack<');     // pane title
      expect(html).toContain('>Variables<');       // pane title
      expect(html).toContain('id="splitter"');     // draggable column divider
      expect(html).toContain('id="hsplitter"');     // draggable panes-vs-eval divider
      expect(html).toMatch(/--stack-basis:\s*60%/); // default split, injected from the saved static
      expect(html).toMatch(/--eval-height:\s*4rem/); // default eval-bar height, injected from the saved static
    });

    it('renders the toolbar as DAP-style icon buttons (codicon SVGs), not text labels', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const html = lastPanel().webview.html;

      // Each control keeps its data-cmd (wiring) but now carries an inline SVG glyph.
      for (const cmd of ['resume', 'stepOver', 'stepInto', 'stepThrough', 'restartFrame', 'terminate']) {
        expect(html).toMatch(new RegExp(`data-cmd="${cmd}"[^>]*>\\s*<svg`));
      }
      // The old text labels are gone (names live in title/aria-label tooltips).
      expect(html).toContain('aria-label="Resume execution"');
      expect(html).not.toMatch(/data-cmd="resume"[^>]*>Resume</);
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
      // …then shrink that 50/50 source group toward ~1/3 (item #2). Guards the
      // resize from being silently dropped — exact ratio is tuned by step count.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.decreaseViewHeight');

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
      // stashReadOnlySource keys each method distinct via the query (session + oop).
      expect(openUri.query).toMatch(/session=\d+&method=\d+/);
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

    it('highlights a read-only frame whose source matches the server source 1:1', async () => {
      // A non-symbol-list method (or a raw Debug It doit) is shown unmodified —
      // nothing was unwrapped — so the server step-point offsets map onto the
      // displayed source directly and the step point IS highlighted.
      const panel = openPanelWithStack(); // frame 3 → read-only, source has no wrapper
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      const editor = await shownEditor();
      // step point 2 → getSourceOffsetsForMethod()[1] === 8 (1-based) → positionAt(7) → (0, 7).
      const range = vi.mocked(editor.setDecorations).mock.calls[0][1][0] as vscode.Range;
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(7);
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('highlights a read-only BLOCK frame from its HOME method, not the block method', async () => {
      // Regression: a block's own GsNMethod carries a SHORT _sourceOffsets (its
      // own step points only), but _stepPointAt: reports the frame's step point
      // in HOME-method numbering. Pairing a home step point with the block's
      // short offsets overruns the array → undefined → highlight collapses to the
      // line. Source AND offsets must come from the home method. Here the block's
      // method (frame 3 → 3n) differs from its home (999n).
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodBlockInfo).mockReturnValueOnce({ isBlock: true, homeMethodOop: 999n });
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      expect(debug.getMethodSource).toHaveBeenCalledWith(session, 999n);
      expect(debug.getSourceOffsetsForMethod).toHaveBeenCalledWith(session, 999n);
    });

    it('does NOT highlight a read-only frame whose source was unwrapped', async () => {
      // A true doit whose stored source is the transcript-capture-wrapped form:
      // the panel unwraps it for display, so the server's offsets refer to the
      // wrapped source and no longer line up — highlighting stays off.
      const panel = openPanelWithStack();
      vi.mocked(debug.getMethodInfo).mockImplementationOnce(() => { throw new Error('doit: nil inClass'); });
      vi.mocked(debug.getMethodSource).mockReturnValueOnce(
        wrapWithTranscriptCapture('JasperDebugDemo new run').wrappedCode,
      );
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

    it('closes the source editor AND every GT Inspector it opened, together, on close', async () => {
      const panel = openPanelWithStack();
      // A real gemstone:// method source, shown in source column 9.
      vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(9) as never);
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();

      // GT Inspect two variables → two inspectors, each a closable handle.
      sendMessage(panel, { command: 'inspectVariable', oop: '300', name: 'self' });
      sendMessage(panel, { command: 'inspectVariable', oop: '901', name: 'total' });
      const inspectorCloses = vi.mocked(GtInspector.create).mock.results
        .map((r) => (r.value as { close: ReturnType<typeof vi.fn> }).close);
      expect(inspectorCloses).toHaveLength(2);

      const uri = (vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri).toString();
      const sourceTab = { label: 'source', input: new vscode.TabInputText(vscode.Uri.parse(uri)) };
      const groups = vscode.window.tabGroups.all as unknown as { viewColumn: number; tabs: unknown[] }[];
      groups.push({ viewColumn: 9, tabs: [sourceTab] });

      closePanel(panel);

      // The companion source tab is closed…
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(sourceTab);
      // …and BOTH inspectors are closed alongside it.
      for (const close of inspectorCloses) expect(close).toHaveBeenCalledTimes(1);
    });

    it('sizes the new source group via setEditorLayout to the saved/default ratio (#3)', async () => {
      // getEditorLayout reports code(1) | debugger(2) / source(3). The source
      // editor opens in column 3, so it maps to the 99-tall leaf.
      const layout = { orientation: 0, groups: [{ size: 636 }, { size: 877, groups: [{ size: 749 }, { size: 99 }] }] };
      // Route getEditorLayout to our sample; everything else returns undefined.
      // mockImplementation persists past clearAllMocks, so restore it in finally.
      vi.mocked(vscode.commands.executeCommand).mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'vscode.getEditorLayout' ? layout : undefined) as never);
      try {
        const panel = openPanelWithStack();
        vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(columnedEditor(3) as never);
        vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO);
        sendMessage(panel, { command: 'selectFrame', level: 3 });
        await flush();

        // Used the precise layout API, not the imprecise step-based fallback.
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.setEditorLayout', layout);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.decreaseViewHeight');
        // Source (col 3) resized to ~1/3 of its 848-tall column; sibling gets the rest.
        const column = layout.groups[1].groups!;
        expect(column[1].size).toBe(Math.round(848 * 0.33));
        expect(column[0].size).toBe(848 - Math.round(848 * 0.33));
      } finally {
        vi.mocked(vscode.commands.executeCommand).mockReset();
      }
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

    it('posts the selected frame variables, grouped (Receiver + Arguments & Temps with oops) on selectFrame', () => {
      // Only server level 2 carries temps; other frames keep the base shape so the
      // 5-frame stack still renders and level 2 survives filtering (mid-stack).
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) =>
        level === 2
          ? { methodOop: 2n, ipOffset: 5, receiverOop: 300n, argAndTempNames: ['amount', 'total'], argAndTempOops: [11n, 22n] }
          : { methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100), argAndTempNames: [], argAndTempOops: [] });
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      const receiver = groups.find((g: { kind: string }) => g.kind === 'receiver');
      expect(receiver.vars[0]).toEqual({ name: 'self', value: '<print 300>', oop: '300' });
      const argtemps = groups.find((g: { kind: string }) => g.kind === 'argtemps');
      expect(argtemps.vars).toEqual([
        { name: 'amount', value: '<print 11>', oop: '11' },
        { name: 'total', value: '<print 22>', oop: '22' },
      ]);
    });

    it('splits named temps from the synthetic .tN eval-stack temps into a separate group', () => {
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) =>
        level === 2
          ? { methodOop: 2n, ipOffset: 5, receiverOop: 300n, argAndTempNames: ['amount', '.t1'], argAndTempOops: [11n, 99n] }
          : { methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100), argAndTempNames: [], argAndTempOops: [] });
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      expect(groups.find((g: { kind: string }) => g.kind === 'argtemps').vars)
        .toEqual([{ name: 'amount', value: '<print 11>', oop: '11' }]);
      const stack = groups.find((g: { kind: string }) => g.kind === 'stacktemps');
      expect(stack.collapsed).toBe(true);
      expect(stack.vars).toEqual([{ name: '.t1', value: '<print 99>', oop: '99' }]);
    });

    it('hides the __vsc transcript-capture glue temps from an executed-code frame', () => {
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) =>
        level === 2
          ? { methodOop: 2n, ipOffset: 5, receiverOop: 300n,
            argAndTempNames: ['__vscCapture', '__vscResult', 'amount'], argAndTempOops: [1n, 2n, 11n] }
          : { methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100), argAndTempNames: [], argAndTempOops: [] });
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 2 });

      const groups = lastPosted(panel, 'variables').groups;
      const argtemps = groups.find((g: { kind: string }) => g.kind === 'argtemps');
      expect(argtemps.vars).toEqual([{ name: 'amount', value: '<print 11>', oop: '11' }]);
      // None of the glue names leak into any group.
      const allNames = groups.flatMap((g: { vars: { name: string }[] }) => g.vars.map(v => v.name));
      expect(allNames.some((n: string) => n.startsWith('__vsc'))).toBe(false);
    });

    it('includes the receiver instance variables as their own group', () => {
      vi.mocked(debug.getInstVarNames).mockReturnValueOnce(['count', 'sum']);
      vi.mocked(debug.getNamedInstVarOops).mockReturnValueOnce([7n, 8n]);
      const panel = openPanel();
      sendMessage(panel, { command: 'selectFrame', level: 3 });

      const groups = lastPosted(panel, 'variables').groups;
      expect(groups.find((g: { kind: string }) => g.kind === 'instvars').vars).toEqual([
        { name: 'count', value: '<print 7>', oop: '7' },
        { name: 'sum', value: '<print 8>', oop: '8' },
      ]);
    });

    it('opens a GT Inspector for a clicked variable via inspectVariable', () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'inspectVariable', oop: '300', name: 'self' });
      expect(GtInspector.create).toHaveBeenCalledWith(session, 300n, 'self');
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

    it('Step Over steps (non-blocking) from the selected user frame and refreshes, clearing the error banner', async () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'stepOver', level: 3 }); // display 3 → server level 3
      await tick();

      expect(debug.stepOverNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(posted(panel, 'init').length).toBe(before + 1);
      expect(lastPosted(panel, 'init').errorMessage).toBe('');
      expect(panel.dispose).not.toHaveBeenCalled();
    });

    it('surfaces a clear message when a step hits native-code (error 6014), without disposing', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorMessage: 'a ImproperOperation occurred (error 6014), Breakpoint and single-step not supported in native code',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/native code/i);
    });

    it('guides the user (no dispose, no refresh) when a step hits an unhandled halt (error 6011)', async () => {
      // Stepping OVER an unhandled halt drives the signal to _uncontinuableError
      // (rtErrUncontinuable = 6011). The process is dead-ended: don't refresh into
      // that machinery wall — keep the pre-step stack and steer to Terminate.
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false,
        errorNumber: 6011,
        errorMessage: 'a UncontinuableError occurred (error 6011), reason:rtErrUncontinuable',
      });
      const panel = openPanel();
      vi.mocked(debug.getStackDepth).mockClear(); // refresh() re-walks the stack via fetchStack
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/Terminate/i);
      expect(debug.getStackDepth).not.toHaveBeenCalled(); // did NOT refresh into the new stack
    });

    it('once uncontinuable (6011), refuses a later Resume and Step with NO further GCI call (no growing message)', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false, errorNumber: 6011, errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 }); // sets the uncontinuable flag
      await tick();

      // A retry must NOT hit the server again — that's what grows GemStone's
      // accumulating exception-chain message that Eric saw.
      vi.mocked(debug.continueExecution).mockClear();
      vi.mocked(debug.stepOverNb).mockClear();
      sendMessage(panel, { command: 'resume' });
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(debug.stepOverNb).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
    });

    it('Resume that hits 6011 shows the Terminate-only banner without refreshing', () => {
      vi.mocked(debug.continueExecution).mockReturnValueOnce({
        completed: false, errorNumber: 6011, errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'resume' });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before + 1); // postInit, not a stack refresh
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/uncontinuable/i);
    });

    it('re-enables Resume after an uncontinuable (6011) once a deeper frame is restarted', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({
        completed: false, errorNumber: 6011, errorMessage: 'a UncontinuableError occurred (error 6011)',
      });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 1 }); // → uncontinuable
      await tick();
      sendMessage(panel, { command: 'restartFrame', level: 2 }); // deeper trim clears the flag
      await tick();
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 2);
      expect(debug.continueExecution).toHaveBeenCalled(); // no longer guarded
    });

    it('Step disposes the panel when the step completes the process', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({ completed: true });
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('"Into" maps to gciStepInto (debugQueries.stepIntoNb), from the selected user frame', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepInto', level: 3 }); // display 3 → server level 3
      await tick();

      expect(debug.stepIntoNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
    });

    it('"Through" maps to gciStepThru (debugQueries.stepThruNb), from the selected user frame', async () => {
      const panel = openPanel();
      sendMessage(panel, { command: 'stepThrough', level: 4 }); // display 4 → server level 4
      await tick();

      expect(debug.stepThruNb).toHaveBeenCalledWith(session, GS_PROCESS, 4);
    });

    it('Restart Frame trims the stack (non-blocking) to the selected (deeper) frame and refreshes', async () => {
      const panel = openPanel();
      const before = posted(panel, 'init').length;
      sendMessage(panel, { command: 'restartFrame', level: 2 });
      await tick();

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 2);
      expect(posted(panel, 'init').length).toBe(before + 1);
    });

    it('Restart Frame on the top frame shows an in-panel notice and does not trim (GemStone cannot reset the TOS IP)', async () => {
      const panel = openPanel();
      vi.mocked(debug.trimStackToLevelNb).mockClear();
      sendMessage(panel, { command: 'restartFrame', level: 1 }); // display 1 → server level 1 (top)
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/top frame/i);
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

    it('hands the completed result to onComplete on step-to-completion', async () => {
      vi.mocked(debug.stepOverNb).mockResolvedValueOnce({ completed: true, resultOop: 0x66n });
      const onComplete = vi.fn();
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG, onComplete);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

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

    it('does NOT silently drop a second op while one is in flight — it posts a busy notice', async () => {
      let release: (r: debug.StepResult) => void = () => {};
      vi.mocked(debug.stepOverNb).mockReturnValueOnce(new Promise<debug.StepResult>(res => { release = res; }));
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 }); // starts, stays pending
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(1);

      sendMessage(panel, { command: 'stepOver', level: 3 }); // while the first is in flight
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(1);                 // not started again
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/still running/i); // user is told

      release({ completed: false }); // let the first finish so the panel settles
      await tick();
    });

    it('releases the in-flight guard after a FAILED op so the next op still runs (no permanent wedge)', async () => {
      vi.mocked(debug.stepOverNb).mockRejectedValueOnce(new Error('boom'));
      const panel = openPanel();
      sendMessage(panel, { command: 'stepOver', level: 3 });
      await tick();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/failed/i);

      sendMessage(panel, { command: 'stepOver', level: 3 }); // guard must be released
      await tick();
      expect(debug.stepOverNb).toHaveBeenCalledTimes(2);
    });
  });

  describe('edit-and-continue (save companion source)', () => {
    // Let revealFrameSource's awaited openTextDocument/showTextDocument settle so
    // editableSourceUri is set before we fire the save.
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    const URI_INFO = {
      dictName: 'UserGlobals', className: 'JasperDebugDemo', isMeta: false,
      category: 'accessing', selector: 'accumulateFrom:to:',
    };

    beforeEach(() => {
      // Restore the base getFrameInfo (mockImplementation leaks past clearAllMocks).
      vi.mocked(debug.getFrameInfo).mockImplementation((_s: unknown, _p: unknown, level: number) => ({
        methodOop: BigInt(level), ipOffset: 5, receiverOop: BigInt(level * 100),
        argAndTempNames: [], argAndTempOops: [],
      }));
    });

    /** The save listener the panel registered in its constructor. */
    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    /**
     * Open a panel, load the 5-frame stack, and select `displayLevel` as an
     * EDITABLE gemstone:// frame (URI_INFO supplied to the single reveal). Returns
     * the panel and the source URI the panel opened (== the doc the user saves).
     */
    async function openWithEditableFrame(displayLevel: number) {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel); // fetchStack uses the base (undefined URI) mocks
      vi.mocked(debug.getMethodUriInfo).mockReturnValueOnce(URI_INFO); // for the reveal only
      sendMessage(panel, { command: 'selectFrame', level: displayLevel });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      return { panel, uri };
    }

    it('re-enters the selected (deeper) frame when its source is saved and recompiled', async () => {
      const { panel, uri } = await openWithEditableFrame(3); // display 3 → server level 3
      const before = posted(panel, 'init').length;
      saveListener()({ uri } as vscode.TextDocument);
      await tick(); // editAndContinue awaits the non-blocking trim

      // trimStackToLevel installs the recompiled method + resets the frame to its
      // first instruction (the old activation held the pre-edit GsNMethod).
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(posted(panel, 'init').length).toBe(before + 1); // refreshed
    });

    it('does NOT re-enter when the recompile failed (GemStone error diagnostic on the URI)', async () => {
      const { panel, uri } = await openWithEditableFrame(3);
      // getDiagnostics is overloaded ([Uri, Diagnostic[]][] | Diagnostic[]); cast
      // past the union to the single-URI Diagnostic[] shape the panel calls with.
      vi.mocked(vscode.languages.getDiagnostics).mockReturnValueOnce(
        [{ severity: vscode.DiagnosticSeverity.Error }] as never,
      );
      const before = posted(panel, 'init').length;
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before); // no refresh
    });

    it('ignores a save of some OTHER document (not the selected frame source)', async () => {
      const { panel } = await openWithEditableFrame(3);
      const before = posted(panel, 'init').length;
      saveListener()({ uri: vscode.Uri.parse('gemstone://1/Other/Foo/instance/x/bar') } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(posted(panel, 'init').length).toBe(before);
    });

    it('ignores a save when the selected frame is read-only (no editable gemstone:// source)', async () => {
      // Frame 3 with the base (undefined URI) mocks resolves read-only.
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'selectFrame', level: 3 });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
    });

    it('shows an in-panel notice and does NOT trim when the edited frame is the top frame', async () => {
      const { panel, uri } = await openWithEditableFrame(1); // display 1 → server level 1 (top)
      saveListener()({ uri } as vscode.TextDocument);
      await tick();

      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/top frame/i);
    });

    it('BLOCKS Resume after a top-frame recompile (continuing the stale activation would hang the gem)', async () => {
      const { panel, uri } = await openWithEditableFrame(1); // top frame → stale activation
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/recompiled/i);
    });

    it('BLOCKS Step after a top-frame recompile', async () => {
      const { panel, uri } = await openWithEditableFrame(1);
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      vi.mocked(debug.stepOverNb).mockClear();
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();

      expect(debug.stepOverNb).not.toHaveBeenCalled();
    });

    it('re-enables Resume once a deeper frame is restarted (the trim discards the stale activation)', async () => {
      const { panel, uri } = await openWithEditableFrame(1);
      saveListener()({ uri } as vscode.TextDocument);        // stale top activation (sync guard)
      await tick();
      sendMessage(panel, { command: 'restartFrame', level: 2 }); // deeper trim clears it
      await tick();                                              // let the async trim settle
      vi.mocked(debug.continueExecution).mockClear();
      sendMessage(panel, { command: 'resume' });

      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 2);
      expect(debug.continueExecution).toHaveBeenCalled(); // no longer blocked
    });
  });

  describe('create-method-from-DNU', () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    const DNU = {
      className: 'JasperDebugDemo', isMeta: false, dictName: 'UserGlobals',
      selector: 'fourtyTwo:bar:', argCount: 2,
    };

    // getDoesNotUnderstandInfo's mockReturnValue persists past clearAllMocks, so
    // restore "not a DNU" afterwards to keep later describes isolated.
    afterEach(() => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
      // getMethodInfo overrides below leak past clearAllMocks — restore the base.
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'JasperDebugDemo', selector: 'finish' };
        if (oop === 2n) return { className: 'Object', selector: 'halt' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
    });

    /**
     * Open a panel parked on a doesNotUnderstand:. By default the top two frames
     * are DNU machinery (defaultAction, doesNotUnderstand:) so they're trimmed and
     * the topmost DISPLAYED frame — the re-enterable sender — is server level 3.
     */
    function openWithDnu() {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(DNU);
      vi.mocked(debug.getMethodInfo).mockImplementation((_s: unknown, oop: bigint) => {
        if (oop === 1n) return { className: 'MessageNotUnderstood', selector: 'defaultAction' };
        if (oop === 2n) return { className: 'Object', selector: 'doesNotUnderstand:' };
        return { className: 'JasperDebugDemo', selector: 'accumulateFrom:to:' };
      });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      return panel;
    }

    function saveListener(): (doc: vscode.TextDocument) => void {
      return vi.mocked(vscode.workspace.onDidSaveTextDocument).mock.calls[0][0];
    }

    it('includes the DNU info in the init payload when parked on a doesNotUnderstand:', () => {
      const panel = openWithDnu();
      expect(initPayload(panel).dnu).toEqual({
        selector: 'fourtyTwo:bar:', className: 'JasperDebugDemo', isMeta: false,
      });
    });

    it('omits dnu from the init payload when not a DNU', () => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(undefined);
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      expect(initPayload(panel).dnu).toBeUndefined();
    });

    it('opens a pre-filled new-method template BELOW the panel and hints to fill+save', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();

      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;
      // gemstone:// new-method URI for the receiver's class/dict (the FS provider
      // serves the template; the selector is parsed from the saved source).
      expect(uri.toString()).toContain('/UserGlobals/JasperDebugDemo/instance/');
      expect(uri.toString()).toContain('new-method');
      // Docked BELOW the panel (not Beside) like the companion source.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.newGroupBelow');
      // The generic template was replaced with the real signature + body stub.
      const editor = await vi.mocked(vscode.window.showTextDocument).mock.results.at(-1)!.value;
      expect(editor.edit).toHaveBeenCalled();
      // A lightweight banner update (NOT a full init, which would re-select the top
      // frame and steal focus from the new-method editor) tells the user to fill in
      // + save (Ctrl+S). The Create button is gone (no init re-render needed).
      expect(lastPosted(panel, 'banner').text).toMatch(/save.*Ctrl/i);
      expect(posted(panel, 'init').length).toBe(1); // only the original ready init
    });

    it('re-enters the sender frame (trim, NOT resume) on a clean compile, leaving Resume to the user', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      // Trim re-enters the sender (server level 3, below the trimmed DNU machinery)
      // so the user's next Resume re-runs the send. We must NOT auto-resume — the
      // blocking continueExecution of a parked DNU hung the gem and crashed the host.
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
      expect(debug.continueExecution).not.toHaveBeenCalled();
      expect(panel.dispose).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/resume/i);
    });

    it('closes the created method tab on debugger close (FS-provider URI form, : not %3A)', async () => {
      const panel = openWithDnu();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      // The FS provider swaps the template tab to this real method URI on save —
      // built via vscode.Uri.from (keyword ':' left un-encoded). closeSourceEditors
      // must match THIS form; buildMethodSourceUri's %3A encoding would not, and the
      // tab would linger ("stuck around"). Guards that regression.
      const compiledUri = vscode.Uri.from({
        scheme: 'gemstone', authority: '1',
        path: '/UserGlobals/JasperDebugDemo/instance/as yet unclassified/fourtyTwo:bar:',
      });
      const methodTab = { label: 'fourtyTwo:bar:', input: new vscode.TabInputText(compiledUri) };
      const groups = vscode.window.tabGroups.all as unknown as { viewColumn: number; tabs: unknown[] }[];
      groups.push({ viewColumn: 9, tabs: [methodTab] });

      closePanel(panel);
      expect(vi.mocked(vscode.window.tabGroups.close)).toHaveBeenCalledWith(methodTab);
    });

    it('does NOT trim (and keeps the template pending) when the compile fails', async () => {
      const panel = openWithDnu();
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      vi.mocked(vscode.languages.getDiagnostics).mockReturnValueOnce(
        [{ severity: vscode.DiagnosticSeverity.Error }] as never,
      );
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();

      // Re-save after fixing (clean diagnostics) — the pending state survived.
      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).toHaveBeenCalledWith(session, GS_PROCESS, 3);
    });

    it('does NOT trim a workspace/Executed Code sender — tells the user to re-run', async () => {
      // All frames resolve as Executed Code (no class) → the sender can't be
      // re-entered (kernel trim sends compiledMethodAt: to nil); never attempt it.
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue(DNU);
      vi.mocked(debug.getMethodInfo).mockImplementation(() => { throw new Error('doit: no class'); });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      const uri = vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0] as vscode.Uri;

      saveListener()({ uri } as vscode.TextDocument);
      await tick();
      expect(debug.trimStackToLevelNb).not.toHaveBeenCalled();
      expect(debug.continueExecution).not.toHaveBeenCalled();
      // Doesn't trim, but DOES tell the user to Resume (manual Resume works — the
      // kernel's defaultAction re-performs the send). Must NOT auto-resume.
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/resume/i);
    });

    it('refuses to create when the class has no home dictionary (not in the symbol list)', async () => {
      vi.mocked(debug.getDoesNotUnderstandInfo).mockReturnValue({ ...DNU, dictName: '' });
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      const panel = lastPanel();
      sendReady(panel);
      vi.mocked(vscode.workspace.openTextDocument).mockClear();
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();

      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(lastPosted(panel, 'init').errorMessage).toMatch(/symbol list/i);
    });

    it('keeps the Create button suppressed once a create is underway (re-detect returns it)', async () => {
      const panel = openWithDnu();
      expect(initPayload(panel).dnu).toBeTruthy(); // shown initially
      sendMessage(panel, { command: 'createDnuMethod' });
      await flush();
      // A refresh while editing must NOT re-offer the button (method-in-progress).
      sendMessage(panel, { command: 'stepOver', level: 1 });
      await tick();
      expect(lastPosted(panel, 'init').dnu).toBeUndefined();
    });
  });

  describe('layout persistence', () => {
    it('remembers a saved split so the next panel opens with it', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      sendMessage(lastPanel(), { command: 'saveLayout', stackBasis: '42%' });

      // A freshly created panel injects the remembered basis into its HTML.
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      expect(lastPanel().webview.html).toMatch(/--stack-basis:\s*42%/);

      // Restore the default so later tests see the standard 60% split.
      sendMessage(lastPanel(), { command: 'saveLayout', stackBasis: '60%' });
    });

    it('remembers a saved eval-bar height for the next panel', () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      sendMessage(lastPanel(), { command: 'saveLayout', evalHeight: '160px' });

      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      expect(lastPanel().webview.html).toMatch(/--eval-height:\s*160px/);

      // Restore the default so later tests see the standard 4rem height.
      sendMessage(lastPanel(), { command: 'saveLayout', evalHeight: '4rem' });
    });

    it('widens the Beside split toward ~60% on create (item #2)', async () => {
      DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
      await tick(); // the widen runs in a fire-and-forget async IIFE
      // Best-effort nudge; guards the resize from being silently dropped.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.increaseViewWidth');
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

  // The real parked doesNotUnderstand: stack (captured live, error 2010): under
  // GCI debug it parks in the unhandled-error path, so the TOP frame is
  // MessageNotUnderstood>>defaultAction (NOT signal) — which must still be trimmed
  // so the debugger opens on the user's frame (here, Executed Code).
  const DNU_STACK: RawFrame[] = [
    raw({ serverLevel: 1, label: 'MessageNotUnderstood>>#defaultAction', definingClassName: 'MessageNotUnderstood', selector: 'defaultAction' }),
    raw({ serverLevel: 2, label: 'MessageNotUnderstood (AbstractException)>>#_defaultAction', definingClassName: 'AbstractException', selector: '_defaultAction' }),
    raw({ serverLevel: 3, label: 'MessageNotUnderstood (AbstractException)>>#_signal', definingClassName: 'AbstractException', selector: '_signal' }),
    raw({ serverLevel: 4, label: 'MessageNotUnderstood (AbstractException)>>#signal', definingClassName: 'AbstractException', selector: 'signal' }),
    raw({ serverLevel: 5, label: 'SmallInteger (Object)>>#doesNotUnderstand:', definingClassName: 'Object', selector: 'doesNotUnderstand:' }),
    raw({ serverLevel: 6, label: 'SmallInteger (Object)>>#_doesNotUnderstand:args:envId:reason:', definingClassName: 'Object', selector: '_doesNotUnderstand:args:envId:reason:' }),
    raw({ serverLevel: 7, label: 'Executed Code', methodOop: DOIT, homeMethodOop: DOIT, isExecutedCode: true }),
  ];

  it('trims the doesNotUnderstand: machinery (incl. defaultAction) down to the user frame', () => {
    const kept = filterStack(DNU_STACK);
    expect(kept.map(f => f.serverLevel)).toEqual([7]); // just the Executed Code sender
    expect(kept[0].label).toBe('Executed Code');
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

describe('source-pane layout persistence (#3)', () => {
  // A real `vscode.getEditorLayout` result Eric captured: code | (debugger / source).
  // Leaf order = ViewColumn order, so code=1, debugger=2, source=3.
  const sample = (): EditorGroupLayout => ({
    orientation: 0,
    groups: [
      { size: 636 },
      { size: 877, groups: [{ size: 749 }, { size: 99 }] },
    ],
  });

  it('flattens leaves in ViewColumn order (depth-first, left-to-right)', () => {
    const leaves = flattenLayoutLeaves(sample());
    expect(leaves.map(l => l.node.size)).toEqual([636, 749, 99]);
  });

  it('reads the source group ratio from its containing column', () => {
    // Source is ViewColumn 3 → 99 of the 877-wide column's 848 (749+99).
    expect(sourceRatioFromLayout(sample(), 3)).toBeCloseTo(99 / 848, 5);
  });

  it('returns undefined when the column is missing or unmeasurable', () => {
    expect(sourceRatioFromLayout(sample(), 9)).toBeUndefined(); // column past the end
    expect(sourceRatioFromLayout(undefined, 3)).toBeUndefined(); // no layout
    expect(sourceRatioFromLayout(sample(), undefined)).toBeUndefined(); // no column
  });

  it('rewrites the source/sibling sizes to a ratio, preserving their sum and other groups', () => {
    const layout = sample();
    expect(setSourceRatioInLayout(layout, 3, 0.5)).toBe(true);
    const column = layout.groups[1].groups!;
    expect(column[1].size).toBe(424); // source: round(848 * 0.5)
    expect(column[0].size).toBe(424); // sibling (debugger): the rest
    expect(layout.groups[0].size).toBe(636); // code column untouched
  });

  it('clamps a degenerate ratio so a pane can never collapse', () => {
    const layout = sample();
    setSourceRatioInLayout(layout, 3, 0.99);
    const column = layout.groups[1].groups!;
    expect(column[1].size).toBe(Math.round(848 * 0.9)); // clamped to 0.9
  });

  it('refuses to rewrite when the source is not a clean two-way split', () => {
    // A 3-way column isn't the pair we create (debugger / source), so leave it be.
    const threeWay: EditorGroupLayout = {
      orientation: 0,
      groups: [{ size: 636 }, { size: 877, groups: [{ size: 300 }, { size: 300 }, { size: 200 }] }],
    };
    // Leaves: code=1, then 300=2, 300=3, 200=4 → source col 4's parent has 3 kids.
    expect(setSourceRatioInLayout(threeWay, 4, 0.33)).toBe(false);
    expect(threeWay.groups[1].groups!.map(g => g.size)).toEqual([300, 300, 200]); // untouched
  });
});

describe('step-point highlight decoration', () => {
  // Guards item #5: light themes render `editor.focusedStackFrameHighlightBackground`
  // as a near-invisible translucent yellow, and we mark only the step-point token
  // (not the whole line), so the bare default was almost unreadable. The decoration
  // therefore carries a `light` override with a stronger fill + solid border. If
  // someone strips that override (back to the faint default), these fail.
  it('was created (snapshot captured at import time)', () => {
    expect(stepPointDecorationOptions).toBeDefined();
  });

  it('overrides light themes with a stronger fill and a solid (non-themed) border', () => {
    const light = stepPointDecorationOptions?.light;
    expect(light).toBeDefined();
    // A solid colour string, NOT a ThemeColor pointing back at the faint default.
    expect(typeof light?.backgroundColor).toBe('string');
    expect(typeof light?.borderColor).toBe('string');
    expect(light?.borderColor).not.toBeInstanceOf(vscode.ThemeColor);
    // The fill must be appreciably opaque (the faint default sits near ~0.2 alpha).
    const alpha = Number(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(String(light?.backgroundColor))?.[1] ?? '1');
    expect(alpha).toBeGreaterThanOrEqual(0.4);
  });
});
