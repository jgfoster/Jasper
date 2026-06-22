import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';
import * as queries from './browserQueries';
import { unwrapTranscriptCapture } from './transcriptCapture';
import { logError } from './gciLog';

// The webview's DOM behavior lives in a standalone file (like listFilter.js /
// methodListView.js) so it gets IDE support and can be jsdom-tested in isolation
// instead of being trapped inside the inline <script> template literal. The
// webview needs the raw source text to inject into a <script> tag, so we read it
// at runtime rather than importing it as a compiled module.
const debuggerViewJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'debuggerView.js'), 'utf8');

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
  | { command: 'copyFrame'; level: number }
  | { command: 'selectFrame'; level: number }
  | { command: 'evalInFrame'; level: number; expr: string }
  | { command: 'resume' }
  | { command: 'terminate' }
  | { command: 'stepOver'; level: number }
  | { command: 'stepInto'; level: number }
  | { command: 'stepThrough'; level: number }
  | { command: 'restartFrame'; level: number };

/**
 * Build the `gemstone://` URI for a method's source, in the exact form the
 * GemStoneFileSystemProvider expects — and the same one the DAP
 * `stackTraceRequest` builds for its `Source.path`. Opening this URI gives the
 * companion source editor all the real-editor features (syntax highlight,
 * senders/implementors, breakpoint gutters, compile-on-save).
 *
 * Exported so the URI format is unit-testable independently of the panel.
 * (Sharing this resolution with the DAP path is review #5, a later Stage 1 item.)
 */
export function buildMethodSourceUri(sessionId: number, uriInfo: debug.MethodUriInfo): string {
  const side = uriInfo.isMeta ? 'class' : 'instance';
  return `gemstone://${sessionId}`
    + `/${encodeURIComponent(uriInfo.dictName)}`
    + `/${encodeURIComponent(uriInfo.className)}`
    + `/${side}`
    + `/${encodeURIComponent(uriInfo.category)}`
    + `/${encodeURIComponent(uriInfo.selector)}`;
}

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
  /** 1-based DISPLAY number (1 = top), after filtering; shown to the user. */
  level: number;
  label: string;
  /** Pre-formatted `@<stepPoint> line <line>` annotation; '' when unavailable. */
  position: string;
}

/**
 * Host-side cached frame: a `FrameSummary` plus the real GsProcess frame level.
 * Display levels are renumbered 1..N after filtering, but server queries
 * (`revealFrameSource`, etc.) must use the original level — so we keep both.
 */
interface DisplayFrame extends FrameSummary {
  serverLevel: number;
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

/** Virtual-document scheme for read-only frame source (doits + non-symbol-list methods). */
const READONLY_SOURCE_SCHEME = 'gemstone-debug';

/**
 * A fully-resolved stack frame, before display filtering and renumbering.
 * Carries the classification bits the stack filter needs (which `FrameSummary`,
 * the wire/display shape, deliberately omits).
 */
export interface RawFrame {
  /** Real GsProcess frame level (1 = top); preserved for server queries. */
  serverLevel: number;
  methodOop: bigint;
  /** Home (enclosing) method — equal to methodOop for non-block frames. */
  homeMethodOop: bigint;
  isBlock: boolean;
  /** Defining class name WITHOUT any " class" suffix (for machinery matching). */
  definingClassName: string;
  selector: string;
  /** True for doit / "Executed Code" frames (no resolvable home class). */
  isExecutedCode: boolean;
  label: string;
  line?: number;
  stepPoint?: number;
}

// Exception/halt machinery, trimmed from the TOP of the stack so the debugger
// opens on the user's frame (e.g. `[] in Foo>>bar`) instead of `signal`/`halt`.
// `AbstractException` covers signal/_signal/_signalToDebugger/_executeHandler:
// (instance and class side); the selectors cover Object>>halt and friends.
const MACHINERY_SELECTORS = new Set([
  'halt', 'halt:', 'pause', 'error:', 'signal', 'signal:',
]);
// Kernel block-invocation selectors that appear as transcript-capture-wrapper
// glue at the BOTTOM (the doit evaluates its blocks via these).
const BLOCK_EVAL_SELECTORS = new Set([
  'value', 'value:', 'value:value:', 'value:value:value:', 'ensure:', 'ifCurtailed:', 'on:do:',
]);

/** True when a frame is exception-signalling / halt machinery. */
export function isExceptionMachinery(f: RawFrame): boolean {
  return f.definingClassName === 'AbstractException'
    || f.selector.startsWith('doesNotUnderstand')
    || f.selector.startsWith('_doesNotUnderstand')
    || f.selector.startsWith('_signal')
    || MACHINERY_SELECTORS.has(f.selector);
}

/**
 * Filter a raw stack down to what's worth showing: trim exception/halt
 * machinery from the top, and collapse the whole transcript-capture wrapper at
 * the bottom to the single "Executed Code" doit frame. Mid-stack frames are
 * never removed. Always keeps ≥1 frame.
 *
 * The bottom collapse is *anchored on the deepest `Executed Code` frame* (the
 * doit) rather than on the literal last frame — because GemStone leaves a
 * `<Reenter marker>` (and sometimes other cruft) *below* the doit. We keep that
 * one doit frame, drop everything beneath it, and drop the contiguous glue
 * above it (the doit's own block frames, which also read as "Executed Code",
 * plus block-eval kernel frames like `ensure:`/`value`) up to the first real
 * user frame.
 *
 * Heuristic, and deliberately conservative — it only trims at the two ends, so
 * an unrecognised stack degrades to "shows a couple extra frames", never to
 * dropping real user frames.
 */
export function filterStack(raws: RawFrame[]): RawFrame[] {
  if (raws.length <= 1) return raws;

  // Top: drop a contiguous run of machinery frames (never the whole stack).
  let top = 0;
  while (top < raws.length - 1 && isExceptionMachinery(raws[top])) top++;
  const kept = raws.slice(top);

  // Bottom: find the deepest doit (Executed Code) frame, if any.
  let doitIdx = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i].isExecutedCode) { doitIdx = i; break; }
  }
  if (doitIdx === -1) return kept; // no wrapper (e.g. a breakpoint in a method)

  // Walk up over the contiguous wrapper glue (doit's block frames + block-eval
  // kernel frames) to the first real user frame; keep [user…] + the one doit.
  let u = doitIdx - 1;
  while (u >= 0 && (kept[u].isExecutedCode || BLOCK_EVAL_SELECTORS.has(kept[u].selector))) u--;
  return [...kept.slice(0, u + 1), kept[doitIdx]];
}

export class DebuggerPanel {
  private static panels = new Map<number, Set<DebuggerPanel>>();
  /**
   * Highlight for the selected frame's current step point in the companion
   * source editor — the standard debugger "focused stack frame" colour, boxed
   * and on the overview ruler. It marks just the step-point token (NOT the whole
   * line), so a line with several sends shows exactly where execution paused.
   * One type shared by all panels (a decoration type is a style, not per-editor).
   */
  private static readonly stepPointDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    borderRadius: '2px',
    overviewRulerColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });

  // ── Read-only source for frames with no gemstone:// editor ──────────
  // "Executed Code" doits (no class at all) and methods whose class isn't in the
  // session's symbol list (so no dictName → no gemstone:// URI) are served
  // read-only through a content provider (never dirty, no "Untitled-N" pileup)
  // keyed by a per-session+method virtual URI.
  private static readOnlySources = new Map<string, string>();
  private static providerRegistered = false;

  private static ensureReadOnlySourceProvider(): void {
    if (DebuggerPanel.providerRegistered) return;
    DebuggerPanel.providerRegistered = true;
    vscode.workspace.registerTextDocumentContentProvider(READONLY_SOURCE_SCHEME, {
      provideTextDocumentContent: (uri: vscode.Uri) =>
        DebuggerPanel.readOnlySources.get(uri.toString()) ?? '',
    });
  }

  /** Stash a frame's read-only source and return its virtual URI; `title` is the tab label. */
  private static stashReadOnlySource(sessionId: number, methodOop: bigint, title: string, source: string): vscode.Uri {
    DebuggerPanel.ensureReadOnlySourceProvider();
    // Path titles the tab; query keeps each method distinct.
    const uri = vscode.Uri.from({
      scheme: READONLY_SOURCE_SCHEME,
      path: title,
      query: `session=${sessionId}&method=${methodOop}`,
    });
    DebuggerPanel.readOnlySources.set(uri.toString(), source);
    return uri;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  /** Last fetched (filtered) stack, cached so copy/select need not re-query. */
  private frames: DisplayFrame[] = [];
  /** Column the companion source editor lives in, reused across frame selects. */
  private sourceColumn: vscode.ViewColumn | undefined;
  /** The editor currently carrying the step-point highlight, if any. */
  private decoratedEditor: vscode.TextEditor | undefined;
  /** Virtual read-only source URIs this panel stashed (pruned on dispose). */
  private stashedSourceKeys = new Set<string>();
  /** Every source URI shown in the companion editor (closed on dispose). */
  private shownSourceUris = new Set<string>();

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
    // Mutable: resume-into-another-error updates it; step/restart clear it.
    private errorMessage: string,
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
        this.postInit();
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
      case 'selectFrame': {
        // Map the display level the webview reported back to the server level,
        // then drive the source pane AND the variables pane for that frame.
        const frame = this.frames.find(f => f.level === msg.level);
        if (frame) {
          void this.revealFrameSource(frame.serverLevel);
          this.postVariables(frame.serverLevel);
        }
        return;
      }
      case 'evalInFrame': {
        const frame = this.frames.find(f => f.level === msg.level);
        this.evalInFrame(frame?.serverLevel, msg.expr);
        return;
      }
      case 'resume': { this.resume(); return; }
      case 'terminate': { this.panel.dispose(); return; } // dispose → clearStack
      case 'stepOver':
      case 'stepInto':
      case 'stepThrough': {
        const frame = this.frames.find(f => f.level === msg.level);
        if (frame) this.step(msg.command, frame.serverLevel);
        return;
      }
      case 'restartFrame': {
        const frame = this.frames.find(f => f.level === msg.level);
        if (frame) this.restartFrame(frame.serverLevel);
        return;
      }
    }
  }

  /** Post the current (filtered) stack to the webview; it re-renders + re-selects top. */
  private postInit(): void {
    this.panel.webview.postMessage({
      command: 'init',
      errorMessage: this.errorMessage,
      // Send only the display shape; serverLevel stays host-side.
      stack: this.frames.map(f => ({ level: f.level, label: f.label, position: f.position })),
    });
  }

  /** Re-walk the (advanced) stack and re-render — used after a step / restart / resume-with-error. */
  private refresh(): void {
    this.frames = this.fetchStack();
    this.postInit();
  }

  /** Fetch the selected frame's variables (self + args/temps) and post them. */
  private postVariables(serverLevel: number): void {
    let vars: { name: string; value: string }[] = [];
    try {
      vars = this.fetchVariables(serverLevel);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
    this.panel.webview.postMessage({ command: 'variables', vars });
  }

  /**
   * Basic variables for a frame: `self` followed by the frame's args and temps,
   * each with its printString. (Stage 2 adds Receiver/Args grouping, the oop
   * column, and click-to-inspect.) Each printString is best-effort.
   */
  private fetchVariables(serverLevel: number): { name: string; value: string }[] {
    const info = debug.getFrameInfo(this.session, this.gsProcess, serverLevel);
    const safePrint = (oop: bigint): string => {
      try { return debug.getObjectPrintString(this.session, oop); }
      catch { return '<unprintable>'; }
    };
    const vars = [{ name: 'self', value: safePrint(info.receiverOop) }];
    for (let i = 0; i < info.argAndTempNames.length; i++) {
      vars.push({ name: info.argAndTempNames[i], value: safePrint(info.argAndTempOops[i]) });
    }
    return vars;
  }

  /** Evaluate an expression in the selected frame and post the printString back. */
  private evalInFrame(serverLevel: number | undefined, expr: string): void {
    if (serverLevel == null) return;
    let value: string;
    let isError = false;
    try {
      value = debug.evaluateInFrame(this.session, this.gsProcess, expr, serverLevel);
    } catch (e: unknown) {
      value = `Error: ${e instanceof Error ? e.message : String(e)}`;
      isError = true;
    }
    this.panel.webview.postMessage({ command: 'evalResult', expr, value, isError });
  }

  /** Resume execution: closes the panel if the process completes, else refreshes on the new error. */
  private resume(): void {
    const result = debug.continueExecution(this.session, this.gsProcess);
    if (result.completed) {
      this.panel.dispose();
    } else {
      this.errorMessage = result.errorMessage || 'GemStone error';
      this.refresh();
    }
  }

  /** Step (over/into/through) from the selected frame: dispose on completion, else refresh. */
  private step(command: 'stepOver' | 'stepInto' | 'stepThrough', serverLevel: number): void {
    const fn = command === 'stepOver' ? debug.stepOver
      : command === 'stepInto' ? debug.stepInto
        : debug.stepOut; // "Through" == gciStepThru (debugQueries.stepOut)
    const result = fn(this.session, this.gsProcess, serverLevel);
    if (result.completed) {
      this.panel.dispose();
    } else {
      this.errorMessage = ''; // no longer at the original halt — clear the banner
      this.refresh();
    }
  }

  /** Restart the selected frame (trim the stack to it) and refresh. */
  private restartFrame(serverLevel: number): void {
    debug.trimStackToLevel(this.session, this.gsProcess, serverLevel);
    this.errorMessage = '';
    this.refresh();
  }

  /**
   * Open the selected frame's source in the companion editor docked *below* the
   * panel, and highlight the step point the IP is on.
   *
   * Two source kinds:
   *  - a class>>selector method → the real `gemstone://` editor (full editing,
   *    senders/implementors, breakpoint gutters);
   *  - an "Executed Code" / doit frame (no home dictionary) → a read-only
   *    virtual editor showing the executed source (so these frames still show
   *    their code rather than opening nothing).
   *
   * Resolution is lazy (only the selected frame, on demand) — the cheap stack
   * listing already happened on `ready`, so the expensive URI/source resolution
   * (review #6) is deferred to here. Everything is best-effort: a failure to
   * open one frame's source must never tear down the debugger.
   */
  private async revealFrameSource(level: number): Promise<void> {
    try {
      const info = debug.getFrameInfo(this.session, this.gsProcess, level);
      // Block frames share their home method's source; resolve from the home
      // method (blocks aren't dictionary entries) but keep the frame's own
      // method+ip for the position (matches buildFrame's naming/position split).
      const { homeMethodOop } = debug.getMethodBlockInfo(this.session, info.methodOop);
      // Same classification as buildFrame's label (C3): a frame the stack list
      // shows as a method must never open as "Executed Code", and vice-versa.
      const home = this.resolveHomeMethod(homeMethodOop);

      let uri: vscode.Uri;
      let methodForOffsets: { className: string; isMeta: boolean; selector: string } | undefined;
      if (home.uriInfo) {
        // In the symbol list → the real editable gemstone:// editor.
        uri = vscode.Uri.parse(buildMethodSourceUri(this.session.id, home.uriInfo));
        methodForOffsets = { className: home.uriInfo.className, isMeta: home.uriInfo.isMeta, selector: home.uriInfo.selector };
      } else {
        // No gemstone:// URI: show the source read-only. Strip the Transcript-
        // capture glue so a doit shows just the user's code (e.g.
        // `JasperDebugDemo new run`). Title by the method when we have one, so a
        // non-symbol-list method isn't mislabelled "Executed Code".
        const source = unwrapTranscriptCapture(debug.getMethodSource(this.session, info.methodOop));
        const title = home.isExecutedCode ? 'Executed Code' : `${home.definingClassName}>>#${home.selector}`;
        uri = DebuggerPanel.stashReadOnlySource(this.session.id, info.methodOop, title, source);
        this.stashedSourceKeys.add(uri.toString());
      }

      const editor = await this.showSourceEditor(uri);

      // Only the editable gemstone:// method gets a step-point highlight (C2):
      // the read-only view has no reliable IP→source mapping (executed code is
      // unwrapped; a non-symbol-list method has no step-point offsets here).
      // TODO(Stage "Hardening"): revisit highlighting the read-only view.
      const range = methodForOffsets
        ? this.stepPointRange(editor.document, info, level, methodForOffsets)
        : undefined;
      // Clear a stale highlight if the source moved to a different editor.
      if (this.decoratedEditor && this.decoratedEditor !== editor) {
        this.decoratedEditor.setDecorations(DebuggerPanel.stepPointDecoration, []);
      }
      if (range) {
        editor.setDecorations(DebuggerPanel.stepPointDecoration, [range]);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      } else {
        editor.setDecorations(DebuggerPanel.stepPointDecoration, []);
      }
      this.decoratedEditor = editor;
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Open `uri` in the companion source editor and return it. The editor lives in
   * a dedicated group docked *below* the panel: the first time, we focus the
   * panel and split a new group beneath it; later selections reuse that group
   * (remembered as `sourceColumn`). Focus stays in the panel so clicking through
   * frames stays fluid, and the doc opens as a reused preview tab (no pile-up).
   */
  private async showSourceEditor(uri: vscode.Uri): Promise<vscode.TextEditor> {
    if (this.sourceColumn === undefined) {
      try {
        this.panel.reveal(this.panel.viewColumn, false); // focus the panel's group…
        await vscode.commands.executeCommand('workbench.action.newGroupBelow'); // …then split below it
      } catch { /* best-effort layout; fall back to the active group */ }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: this.sourceColumn ?? vscode.ViewColumn.Active,
      preview: true,
      preserveFocus: true,
    });
    this.shownSourceUris.add(uri.toString()); // closed with the panel (see dispose)
    this.sourceColumn = editor.viewColumn ?? this.sourceColumn;
    // gemstone:// docs get their language from the FS provider; the read-only
    // executed-code scheme does not, so set it so the source is highlighted.
    if (doc.languageId !== 'gemstone-smalltalk') {
      await vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
    }
    return editor;
  }

  /**
   * The range to highlight for a frame's current step point — just the token at
   * the step point, NOT the whole line. Prefers the exact step-point character
   * offset (`getSourceOffsets`, available for class>>selector methods); falls
   * back to the start of the IP's source line when offsets aren't available
   * (e.g. executed-code frames). Returns undefined when there's nothing to mark.
   */
  private stepPointRange(
    doc: vscode.TextDocument,
    info: debug.FrameInfo,
    level: number,
    method: { className: string; isMeta: boolean; selector: string } | undefined,
  ): vscode.Range | undefined {
    let pos: vscode.Position | undefined;

    // Exact step-point offset → the precise sub-expression start.
    if (method) {
      try {
        const stepPoint = debug.getStepPoint(this.session, this.gsProcess, level);
        if (stepPoint) {
          // getSourceOffsets returns GemStone `_sourceOffsets`, which are
          // 1-BASED (see getStepPointSelectorRanges.ts). doc.positionAt is
          // 0-based, so convert — otherwise the highlight sits one char too far.
          const offsets = queries.getSourceOffsets(this.session, method.className, method.isMeta, method.selector);
          const offset = offsets[stepPoint - 1];
          if (offset != null && offset >= 1 && doc.positionAt) pos = doc.positionAt(offset - 1);
        }
      } catch { /* best-effort; fall back to the IP line below */ }
    }

    // Fallback: the first non-whitespace token of the IP's source line.
    if (!pos) {
      let line = 0;
      try { line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset); } catch { /* */ }
      if (line > 0) {
        const col = doc.lineAt?.(line - 1)?.firstNonWhitespaceCharacterIndex ?? 0;
        pos = new vscode.Position(line - 1, col);
      }
    }
    if (!pos) return undefined;

    // Mark the token at the step point (its beginning), not the whole line.
    return doc.getWordRangeAtPosition?.(pos) ?? new vscode.Range(pos, pos.translate(0, 1));
  }

  /**
   * Walk the suspended process's stack and build a label per frame. The naming
   * logic deliberately mirrors the DAP `stackTraceRequest`
   * (gemstoneDebugSession.ts) so the Enhanced Debugger's stack matches the Run
   * and Debug Call Stack frame-for-frame. Proves the `debugQueries` pipe works
   * from this second consumer before Stage 1 builds the real layout on top.
   */
  private fetchStack(): DisplayFrame[] {
    const raws: RawFrame[] = [];
    try {
      const depth = debug.getStackDepth(this.session, this.gsProcess);
      for (let level = 1; level <= depth; level++) {
        raws.push(this.buildFrame(level));
      }
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return [];
    }
    // Trim machinery/wrapper glue, then renumber the survivors 1..N for display
    // while keeping each one's real server level for subsequent queries.
    return filterStack(raws).map((r, i) => ({
      level: i + 1,
      serverLevel: r.serverLevel,
      label: r.label,
      // Executed-code frames have no meaningful step point/line once unwrapped (#3).
      position: r.isExecutedCode ? '' : formatFramePosition(r.stepPoint, r.line),
    }));
  }

  /**
   * Resolve a single raw frame: a `Class[ class]>>#selector` label plus the
   * classification bits the stack filter needs. The label logic mirrors the DAP
   * path — only frames whose contents can't be fetched are `<frame N>`; a valid
   * frame with no introspectable method (a doit / executed-code or its blocks)
   * is `Executed Code`. Step point / line are best-effort.
   */
  private buildFrame(level: number): RawFrame {
    let info: debug.FrameInfo;
    try {
      info = debug.getFrameInfo(this.session, this.gsProcess, level);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      return {
        serverLevel: level, methodOop: 0n, homeMethodOop: 0n, isBlock: false,
        definingClassName: '', selector: '', isExecutedCode: false, label: `<frame ${level}>`,
      };
    }

    // Block vs home method (homeMethodOop == methodOop for non-blocks).
    let isBlock = false;
    let homeMethodOop = info.methodOop;
    try {
      const blockInfo = debug.getMethodBlockInfo(this.session, info.methodOop);
      isBlock = blockInfo.isBlock;
      homeMethodOop = blockInfo.homeMethodOop;
    } catch { /* treat as a non-block frame */ }

    // Resolve the home method's identity (the single source of truth for
    // "is this executed code?", shared with revealFrameSource — see C3).
    const home = this.resolveHomeMethod(homeMethodOop);

    let label: string;
    if (home.definingClassName) {
      const definingClass = `${home.definingClassName}${home.isMeta ? ' class' : ''}`;
      // Receiver class drives the `Receiver (Defining)` disambiguation for
      // inherited methods (non-block frames only — see formatFrameLabel).
      let receiverClass: string | undefined;
      if (!isBlock) {
        try {
          receiverClass = debug.getObjectClassName(this.session, info.receiverOop);
        } catch { /* best-effort; fall back to defining class only */ }
      }
      label = formatFrameLabel({ isBlock, definingClass, selector: home.selector, receiverClass });
    } else {
      label = 'Executed Code';
    }
    const isExecutedCode = home.isExecutedCode;

    let line: number | undefined;
    try {
      line = debug.getLineForIp(this.session, info.methodOop, info.ipOffset);
    } catch { /* best-effort */ }

    let stepPoint: number | undefined;
    try {
      stepPoint = debug.getStepPoint(this.session, this.gsProcess, level);
    } catch { /* best-effort */ }

    return {
      serverLevel: level, methodOop: info.methodOop, homeMethodOop, isBlock,
      definingClassName: home.definingClassName, selector: home.selector,
      isExecutedCode, label, line, stepPoint,
    };
  }

  /**
   * Resolve a (home) method's display identity — the SINGLE source of truth for
   * "is this executed code?", shared by buildFrame (labelling/classification)
   * and revealFrameSource (source-pane routing) so the two can never disagree.
   *
   *  - in the session's symbol list → `uriInfo` set (editable via gemstone://);
   *  - resolvable class but not in the symbol list → `uriInfo` undefined, but
   *    definingClassName/selector are still set — a real method, NOT executed code;
   *  - no resolvable class at all (a doit) → isExecutedCode true.
   */
  private resolveHomeMethod(homeMethodOop: bigint): {
    uriInfo: debug.MethodUriInfo | undefined;
    definingClassName: string;
    selector: string;
    isMeta: boolean;
  } & { isExecutedCode: boolean } {
    let uriInfo: debug.MethodUriInfo | undefined;
    let definingClassName = '';
    let selector = '';
    let isMeta = false;
    try {
      uriInfo = debug.getMethodUriInfo(this.session, homeMethodOop);
      if (uriInfo && uriInfo.dictName) {
        definingClassName = uriInfo.className;
        selector = uriInfo.selector;
        isMeta = uriInfo.isMeta;
      } else {
        uriInfo = undefined; // no dictName → not usable to build a gemstone:// URI
        const methodInfo = debug.getMethodInfo(this.session, homeMethodOop);
        definingClassName = methodInfo.className;
        selector = methodInfo.selector;
      }
    } catch { /* doit / executed code: no resolvable home class */ }
    return { uriInfo, definingClassName, selector, isMeta, isExecutedCode: definingClassName === '' };
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
    /* Toolbar: Resume / step verbs / Restart Frame / Terminate. */
    .toolbar { display: flex; gap: 0.3rem; margin: 0 0 0.6rem; flex-wrap: wrap; }
    .toolbar button {
      font-family: var(--vscode-font-family); font-size: 0.85rem;
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      border: none; padding: 0.25rem 0.7rem; border-radius: 2px; cursor: pointer;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .toolbar button.danger { color: var(--vscode-errorForeground); }
    /* Stack (left) + variables (right). */
    .main { display: flex; gap: 0.8rem; align-items: flex-start; }
    .main .stack { flex: 1 1 60%; min-width: 0; }
    .vars {
      flex: 1 1 40%; min-width: 0; max-height: 18rem; overflow: auto;
      border-left: 1px solid var(--vscode-panel-border, transparent); padding-left: 0.6rem;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
    }
    .vars .var { padding: 0.15rem 0.2rem; display: flex; gap: 0.5rem; }
    .vars .var-name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground)); white-space: nowrap; }
    .vars .var-name.self { font-style: italic; }
    .vars .var-value { color: var(--vscode-descriptionForeground); white-space: pre; overflow: hidden; text-overflow: ellipsis; }
    /* Eval-in-frame bar. */
    .evalbar { margin-top: 0.8rem; }
    .evalbar input {
      width: 100%; box-sizing: border-box; user-select: text; -webkit-user-select: text;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
      padding: 0.3rem 0.5rem; border-radius: 2px;
    }
    .eval-result {
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
      white-space: pre-wrap; margin-top: 0.35rem; user-select: text; -webkit-user-select: text;
    }
    .eval-result.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <div class="titlebar">
    <h1>Jasper Debugger</h1>
    <span class="subtitle">${subtitle}</span>
    <button id="copyBtn" class="copy-btn" title="Copy the whole stack to the clipboard">Copy Stack</button>
  </div>
  <div class="toolbar" id="toolbar">
    <button data-cmd="resume" title="Resume execution">Resume</button>
    <button data-cmd="stepOver" title="Step over (from the selected frame)">Over</button>
    <button data-cmd="stepInto" title="Step into">Into</button>
    <button data-cmd="stepThrough" title="Step through blocks">Through</button>
    <button data-cmd="restartFrame" title="Restart the selected frame">Restart Frame</button>
    <button data-cmd="terminate" class="danger" title="Terminate the process">Terminate</button>
  </div>
  <div class="error" id="error"></div>
  <div class="main">
    <ul class="stack" id="stack"></ul>
    <div class="vars" id="variables"></div>
  </div>
  <div class="evalbar">
    <input id="evalInput" type="text" autocomplete="off" spellcheck="false"
           placeholder="Evaluate in the selected frame — press Enter">
    <div class="eval-result" id="evalResult"></div>
  </div>
  <div id="ctxmenu" class="ctx-menu" role="menu">
    <div class="ctx-item" id="copyFrameItem" role="menuitem">Copy Frame</div>
  </div>
  <script nonce="${nonce}">${debuggerViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    DebuggerView.init({
      list: document.getElementById('stack'),
      menu: document.getElementById('ctxmenu'),
      copyFrameItem: document.getElementById('copyFrameItem'),
      copyBtn: document.getElementById('copyBtn'),
      error: document.getElementById('error'),
      toolbar: document.getElementById('toolbar'),
      variables: document.getElementById('variables'),
      evalInput: document.getElementById('evalInput'),
      evalResult: document.getElementById('evalResult'),
    }, vscode);
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    DebuggerPanel.panels.get(this.sessionId)?.delete(this);
    // Drop the step-point highlight from the companion editor (which outlives
    // the panel) so a stale highlight doesn't linger after the debugger closes.
    this.decoratedEditor?.setDecorations(DebuggerPanel.stepPointDecoration, []);
    this.decoratedEditor = undefined;
    // Close the companion source editor — it's an artifact of this debugger,
    // so it shouldn't outlive the panel.
    this.closeSourceEditors();
    // Release this panel's stashed read-only source.
    for (const key of this.stashedSourceKeys) DebuggerPanel.readOnlySources.delete(key);
    this.stashedSourceKeys.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    // Closing the panel implicitly terminates the suspended process it owned,
    // releasing the stalled GsProcess on the server (same as dismissing the
    // error notifier). clearStack is best-effort: the session may already be gone.
    debug.clearStack(this.session, this.gsProcess);
  }

  /**
   * Close the companion source tabs this panel opened. A `gemstone://` method is
   * closed ONLY in our own source column — never the user's own copy of the same
   * method open elsewhere (e.g. the System Browser). Our private read-only scheme
   * is unique to this debugger, so it's safe to close in any column. When the
   * source column is unknown we therefore close only the read-only tabs (closing
   * a shared `gemstone://` everywhere would be the very bug the guard prevents).
   */
  private closeSourceEditors(): void {
    if (this.shownSourceUris.size === 0) return;
    for (const group of vscode.window.tabGroups.all) {
      const inOurColumn = this.sourceColumn !== undefined && group.viewColumn === this.sourceColumn;
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) continue;
        if (!this.shownSourceUris.has(tab.input.uri.toString())) continue;
        if (inOurColumn || tab.input.uri.scheme === READONLY_SOURCE_SCHEME) {
          void vscode.window.tabGroups.close(tab);
        }
      }
    }
    this.shownSourceUris.clear();
  }
}
