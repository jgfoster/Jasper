import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';
import { logError } from './gciLog';

/**
 * Jasper Debugger — a roomy, Smalltalk-style debugger rendered as a VS Code
 * webview, offered *alongside* the existing DAP debugger. Whichever entry point
 * the user picks (DAP "Debug" vs. this "Enhanced Debug") owns the suspended
 * `gsProcess` for that error, so the two never coexist on the same process.
 * Closing the panel releases (terminates) that suspended process.
 *
 * This panel is a SECOND consumer of the DAP-free data layer in
 * `debugQueries.ts` (the DAP `GemStoneDebugSession` is the first). It mirrors
 * the webview wiring conventions established in `gtInspector.ts`
 * (createWebviewPanel + enableScripts + retainContextWhenHidden +
 * postMessage/onDidReceiveMessage).
 *
 * Stage 0: foundation only — panel lifecycle + a message-handler skeleton that
 * proves the data-layer pipe end-to-end by listing the stack. The real
 * show-everything layout (source / variables / eval / toolbar) lands in Stage 1.
 */

/** Messages the webview sends to the extension host. */
type DebuggerInbound =
  | { command: 'ready' }
  | { command: 'copyStack' }
  | { command: 'copyFrame'; level: number };

/** Resolved pieces of a frame label, before formatting. */
export interface FrameLabelParts {
  /** True when the frame's method is a block method. */
  isBlock: boolean;
  /** Class that defines the (home) method, e.g. "Object" or "Foo class". */
  definingClass: string;
  /** The (home) method's selector. */
  selector: string;
  /** Class of the frame's receiver, when available. */
  receiverClass?: string;
}

/**
 * Format a frame label, mirroring GsNMethod>>_descrForStackPadTo:rcvr:
 *   - block frames are prefixed `[] in ` and named by their home method;
 *   - for non-block frames whose receiver's class differs from the class that
 *     defines the method, the receiver is disambiguated as
 *     `ReceiverClass (DefiningClass)` (the standard Smalltalk convention);
 *   - block frames are NOT receiver-disambiguated (the home receiver may not
 *     correspond to the block's defining class).
 */
export function formatFrameLabel(p: FrameLabelParts): string {
  const prefix = p.isBlock ? '[] in ' : '';
  let classPart = p.definingClass;
  if (!p.isBlock && p.receiverClass && p.receiverClass !== p.definingClass) {
    classPart = `${p.receiverClass} (${p.definingClass})`;
  }
  return `${prefix}${classPart}>>#${p.selector}`;
}

/**
 * Format a frame's position annotation as `@<stepPoint> line <line>` — e.g.
 * `@2 line 12`. Either part is omitted when unavailable; returns '' when both
 * are missing. Kept pure (no `debug`/webview dependency) so it is unit-testable
 * and shared by the data layer rather than reimplemented in the webview script.
 */
export function formatFramePosition(stepPoint?: number, line?: number): string {
  const parts: string[] = [];
  if (stepPoint != null) parts.push(`@${stepPoint}`);
  // A line of 0 means the IP has no source mapping — omit it (don't show "line 0").
  if (line) parts.push(`line ${line}`);
  return parts.join(' ');
}

/** Minimal HTML-escape for interpolating session text into the page. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A single stack frame summary sent to the webview. */
interface FrameSummary {
  /** 1-based frame number (1 = top), shown so frames are easy to refer to. */
  level: number;
  label: string;
  /** Pre-formatted `@<stepPoint> line <line>` annotation; '' when unavailable. */
  position: string;
}

/**
 * Render a single frame for the clipboard — `<label>  <position>` (no leading
 * frame number, since a lone frame has no stack context). Pure/exported for
 * unit-testing and reuse by formatStackForClipboard.
 */
export function formatFrameForClipboard(frame: FrameSummary): string {
  return frame.position ? `${frame.label}  ${frame.position}` : frame.label;
}

/**
 * Render the whole stack as plain text for the clipboard — one frame per line,
 * `<n>. <label>  <position>`, preceded by the error message. Pure and
 * exported so the copy format is unit-testable.
 */
export function formatStackForClipboard(errorMessage: string, frames: FrameSummary[]): string {
  const lines: string[] = [];
  if (errorMessage) lines.push(`GemStone error: ${errorMessage}`, '');
  for (const f of frames) lines.push(`${f.level}. ${formatFrameForClipboard(f)}`);
  return lines.join('\n');
}

export class DebuggerPanel {
  private static panels = new Map<number, Set<DebuggerPanel>>();
  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  /** Last fetched stack, cached so 'copyStack' need not re-query the server. */
  private frames: FrameSummary[] = [];

  static create(session: ActiveSession, gsProcess: bigint, errorMessage: string): void {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneEnhancedDebugger',
      'Jasper Debugger',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    const debugger_ = new DebuggerPanel(panel, session, gsProcess, errorMessage);
    if (!DebuggerPanel.panels.has(session.id)) {
      DebuggerPanel.panels.set(session.id, new Set());
    }
    DebuggerPanel.panels.get(session.id)!.add(debugger_);
  }

  static disposeForSession(sessionId: number): void {
    const set = DebuggerPanel.panels.get(sessionId);
    if (set) {
      for (const dbg of set) dbg.panel.dispose();
      DebuggerPanel.panels.delete(sessionId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    private readonly gsProcess: bigint,
    private readonly errorMessage: string,
  ) {
    this.panel = panel;
    this.sessionId = session.id;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: DebuggerInbound) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private handleMessage(msg: DebuggerInbound): void {
    switch (msg.command) {
      case 'ready': {
        this.frames = this.fetchStack();
        this.panel.webview.postMessage({
          command: 'init',
          errorMessage: this.errorMessage,
          stack: this.frames,
        });
        return;
      }
      case 'copyStack': {
        void vscode.env.clipboard.writeText(
          formatStackForClipboard(this.errorMessage, this.frames),
        );
        return;
      }
      case 'copyFrame': {
        const frame = this.frames.find(f => f.level === msg.level);
        if (frame) void vscode.env.clipboard.writeText(formatFrameForClipboard(frame));
        return;
      }
    }
  }

  /**
   * Walk the suspended process's stack and build a label per frame. The naming
   * logic deliberately mirrors the DAP `stackTraceRequest`
   * (gemstoneDebugSession.ts) so the Enhanced Debugger's stack matches the Run
   * and Debug Call Stack frame-for-frame. Proves the `debugQueries` pipe works
   * from this second consumer before Stage 1 builds the real layout on top.
   */
  private fetchStack(): FrameSummary[] {
    const frames: FrameSummary[] = [];
    try {
      const depth = debug.getStackDepth(this.session, this.gsProcess);
      for (let level = 1; level <= depth; level++) {
        frames.push(this.buildFrame(level));
      }
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
    return frames;
  }

  /**
   * Build a single frame summary: a `Class[ class]>>#selector` label plus the
   * step point and source line. The label logic mirrors the DAP path exactly
   * — only frames whose contents can't be fetched are `<frame N>`; a valid
   * frame with no introspectable method (e.g. an executed-code or block
   * context) is `Executed Code`, NOT "unavailable". Step point / line are
   * best-effort and simply omitted when unavailable.
   */
  private buildFrame(level: number): FrameSummary {
    let info: debug.FrameInfo;
    try {
      info = debug.getFrameInfo(this.session, this.gsProcess, level);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return { level, label: `<frame ${level}>`, position: '' };
    }

    let label: string;
    try {
      // For a block frame, name the enclosing (home) method and prefix `[] in `,
      // matching GsNMethod>>printOn:. homeMethodOop == methodOop for non-blocks.
      const { isBlock, homeMethodOop } = debug.getMethodBlockInfo(this.session, info.methodOop);

      // Defining class + selector come from the home method.
      let definingClass: string;
      let selector: string;
      const uriInfo = debug.getMethodUriInfo(this.session, homeMethodOop);
      if (uriInfo && uriInfo.dictName) {
        definingClass = `${uriInfo.className}${uriInfo.isMeta ? ' class' : ''}`;
        selector = uriInfo.selector;
      } else {
        const methodInfo = debug.getMethodInfo(this.session, homeMethodOop);
        definingClass = methodInfo.className;
        selector = methodInfo.selector;
      }

      // Receiver class drives the `Receiver (Defining)` disambiguation for
      // inherited methods (non-block frames only — see formatFrameLabel).
      let receiverClass: string | undefined;
      if (!isBlock) {
        try {
          receiverClass = debug.getObjectClassName(this.session, info.receiverOop);
        } catch { /* best-effort; fall back to defining class only */ }
      }

      label = formatFrameLabel({ isBlock, definingClass, selector, receiverClass });
    } catch {
      label = 'Executed Code';
    }

    let line: number | undefined;
    try {
      line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset);
    } catch { /* best-effort */ }

    let stepPoint: number | undefined;
    try {
      stepPoint = debug.getStepPoint(this.session, this.gsProcess, level);
    } catch { /* best-effort */ }

    return { level, label, position: formatFramePosition(stepPoint, line) };
  }

  /** Dimmed "For <user> on <stone> @ <host>" subtitle from the login. */
  private sessionSubtitle(): string {
    const { gs_user, stone, gem_host } = this.session.login;
    const parts: string[] = [];
    if (gs_user) parts.push(`For ${gs_user}`);
    if (stone) parts.push(`on ${stone}`);
    if (gem_host) parts.push(`@ ${gem_host}`);
    return parts.join(' ');
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const subtitle = escapeHtml(this.sessionSubtitle());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 0.75rem 1rem;
    }
    /* Suppress text selection / the default Cut-Copy-Paste affordances; the
       Copy button is the supported way to copy the stack. */
    body { user-select: none; -webkit-user-select: none; }
    .titlebar { display: flex; align-items: baseline; gap: 0.6rem; margin: 0 0 0.25rem; flex-wrap: wrap; }
    h1 { font-size: 1.3rem; margin: 0; }
    .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
    .copy-btn {
      margin-left: auto;
      align-self: center;
      font-family: var(--vscode-font-family);
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      border: none;
      padding: 0.2rem 0.7rem;
      border-radius: 2px;
      cursor: pointer;
    }
    .copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .error {
      color: var(--vscode-errorForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      margin-bottom: 1rem;
    }
    .stack { list-style: none; margin: 0; padding: 0; }
    .frame {
      font-family: var(--vscode-editor-font-family, monospace);
      padding: 0.2rem 0.4rem;
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      cursor: context-menu;
    }
    .frame:hover { background: var(--vscode-list-hoverBackground); }
    .frame.selected { background: var(--vscode-list-activeSelectionBackground); }
    /* Custom right-click menu (the default Cut/Copy/Paste menu is suppressed). */
    .ctx-menu {
      position: fixed; display: none; z-index: 10; min-width: 120px; padding: 0.2rem 0;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border, transparent));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
    }
    .ctx-menu.show { display: block; }
    .ctx-item { padding: 0.25rem 1rem; cursor: pointer; white-space: nowrap; }
    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground);
      color: var(--vscode-menu-selectionForeground);
    }
    .frame .level { color: var(--vscode-descriptionForeground); margin-right: 0.6rem; }
    .frame .pos { color: var(--vscode-descriptionForeground); margin-left: 0.6rem; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  </style>
</head>
<body>
  <div class="titlebar">
    <h1>Jasper Debugger</h1>
    <span class="subtitle">${subtitle}</span>
    <button id="copyBtn" class="copy-btn" title="Copy the whole stack to the clipboard">Copy Stack</button>
  </div>
  <div class="error" id="error"></div>
  <ul class="stack" id="stack"></ul>
  <div id="ctxmenu" class="ctx-menu" role="menu">
    <div class="ctx-item" id="copyFrameItem" role="menuitem">Copy Frame</div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'init') {
        document.getElementById('error').textContent = msg.errorMessage || '';
        const list = document.getElementById('stack');
        list.innerHTML = '';
        if (!msg.stack || msg.stack.length === 0) {
          const li = document.createElement('li');
          li.className = 'empty';
          li.textContent = 'No stack frames available.';
          list.appendChild(li);
          return;
        }
        for (const frame of msg.stack) {
          const li = document.createElement('li');
          li.className = 'frame';
          li.title = 'Right-click to copy this frame';
          li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectFrame(li, frame.level);
            showMenu(e.clientX, e.clientY);
          });
          const lvl = document.createElement('span');
          lvl.className = 'level';
          lvl.textContent = frame.level;
          const lbl = document.createElement('span');
          lbl.textContent = frame.label;
          li.appendChild(lvl);
          li.appendChild(lbl);
          if (frame.position) {
            const pos = document.createElement('span');
            pos.className = 'pos';
            pos.textContent = frame.position;
            li.appendChild(pos);
          }
          list.appendChild(li);
        }
      }
    });

    // ── Custom right-click menu (Copy Frame) ──────────────────────────
    // The default Cut/Copy/Paste menu is suppressed, so copy lives here.
    const menu = document.getElementById('ctxmenu');
    let selectedLevel = null;
    let selectedLi = null;

    function selectFrame(li, level) {
      if (selectedLi) selectedLi.classList.remove('selected');
      selectedLi = li;
      selectedLevel = level;
      li.classList.add('selected');
    }
    function showMenu(x, y) {
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.add('show');
    }
    function hideMenu() { menu.classList.remove('show'); }

    document.getElementById('copyFrameItem').addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedLevel != null) vscode.postMessage({ command: 'copyFrame', level: selectedLevel });
      hideMenu();
    });

    // Suppress the native context menu everywhere; close ours on any dismiss gesture.
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    document.addEventListener('click', hideMenu);
    window.addEventListener('scroll', hideMenu, true);
    window.addEventListener('blur', hideMenu);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });

    // Copy the whole stack to the clipboard (host-side write), with a brief flash.
    const copyBtn = document.getElementById('copyBtn');
    copyBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyStack' });
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    });
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    DebuggerPanel.panels.get(this.sessionId)?.delete(this);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    // Closing the panel implicitly terminates the suspended process it owned,
    // releasing the stalled GsProcess on the server (same as dismissing the
    // error notifier). clearStack is best-effort: the session may already be gone.
    debug.clearStack(this.session, this.gsProcess);
  }
}
