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
  clearStack: vi.fn(),
}));

import * as vscode from 'vscode';
import * as debug from '../debugQueries';
import {
  DebuggerPanel, formatFrameLabel, formatFramePosition,
  formatFrameForClipboard, formatStackForClipboard,
} from '../debuggerPanel';
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

  it('terminates the suspended gsProcess (via clearStack) when the panel window is closed', () => {
    DebuggerPanel.create(session, GS_PROCESS, ERROR_MSG);
    const panel = lastPanel();

    expect(debug.clearStack).not.toHaveBeenCalled();
    closePanel(panel);
    expect(debug.clearStack).toHaveBeenCalledWith(session, GS_PROCESS);
  });
});
