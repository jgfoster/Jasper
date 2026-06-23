import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';
import * as queries from './browserQueries';
import { unwrapTranscriptCapture } from './transcriptCapture';
import { GtInspector } from './gtInspector';
import { logError } from './gciLog';
import { NbCancelledError } from './nbRunner';

// The webview's DOM behavior lives in a standalone file (like listFilter.js /
// methodListView.js) so it gets IDE support and can be jsdom-tested in isolation
// instead of being trapped inside the inline <script> template literal. The
// webview needs the raw source text to inject into a <script> tag, so we read it
// at runtime rather than importing it as a compiled module.
const debuggerViewJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'debuggerView.js'), 'utf8');

/**
 * Toolbar glyphs, keyed by `data-cmd`. These are the exact VS Code `codicon`
 * debug-control SVGs the DAP debug toolbar uses (debug-continue / -step-over /
 * -step-into / -step-out / -restart-frame / -stop), inlined so they need no font
 * load or extra `localResourceRoots` and stay within the strict webview CSP
 * (inline SVG markup, not a fetched resource). `fill="currentColor"` lets each
 * button's text colour drive the glyph (so the danger Terminate renders red).
 */
const TOOLBAR_ICONS: Record<string, string> = {
  resume: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.578 7.149L7.578 2.186C7.397 2.058 7.198 2 7.003 2C6.484 2 6 2.411 6 3.002V13.003C6 13.594 6.485 14.005 7.004 14.005C7.201 14.005 7.403 13.946 7.585 13.815L14.585 8.777C15.142 8.376 15.139 7.546 14.579 7.15L14.578 7.149ZM7.5 12.027V3.969L13.14 7.968L7.5 12.027ZM3.5 2.75V13.25C3.5 13.664 3.164 14 2.75 14C2.336 14 2 13.664 2 13.25V2.75C2 2.336 2.336 2 2.75 2C3.164 2 3.5 2.336 3.5 2.75Z"/></svg>',
  stepOver: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.99993 13C9.99993 14.103 9.10293 15 7.99993 15C6.89693 15 5.99993 14.103 5.99993 13C5.99993 11.897 6.89693 11 7.99993 11C9.10293 11 9.99993 11.897 9.99993 13ZM13.2499 2C12.8359 2 12.4999 2.336 12.4999 2.75V4.027C11.3829 2.759 9.75993 2 7.99993 2C5.03293 2 2.47993 4.211 2.06093 7.144C2.00193 7.554 2.28793 7.934 2.69793 7.993C2.73393 7.999 2.76993 8.001 2.80493 8.001C3.17193 8.001 3.49293 7.731 3.54693 7.357C3.86093 5.159 5.77593 3.501 8.00093 3.501C9.52993 3.501 10.9199 4.264 11.7439 5.501H9.75093C9.33693 5.501 9.00093 5.837 9.00093 6.251C9.00093 6.665 9.33693 7.001 9.75093 7.001H13.2509C13.6649 7.001 14.0009 6.665 14.0009 6.251V2.751C14.0009 2.337 13.6649 2.001 13.2509 2.001L13.2499 2Z"/></svg>',
  stepInto: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 13C10 14.103 9.10304 15 8.00004 15C6.89704 15 6.00004 14.103 6.00004 13C6.00004 11.897 6.89704 11 8.00004 11C9.10304 11 10 11.897 10 13ZM12.03 5.22C11.737 4.927 11.262 4.927 10.969 5.22L8.74904 7.44V1.75C8.74904 1.336 8.41304 1 7.99904 1C7.58504 1 7.24904 1.336 7.24904 1.75V7.439L5.02904 5.219C4.73604 4.926 4.26104 4.926 3.96804 5.219C3.67504 5.512 3.67504 5.987 3.96804 6.28L7.46804 9.78C7.61404 9.926 7.80604 10 7.99804 10C8.19004 10 8.38204 9.927 8.52804 9.78L12.028 6.28C12.321 5.987 12.321 5.512 12.028 5.219L12.03 5.22Z"/></svg>',
  // "Through" = step through blocks (gciStepThru). The `indent` arrow (turns down
  // into a nested position) reads as stepping into a block, and stays visually
  // distinct from Into's debug-step-into glyph.
  stepThrough: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.50002 3C2.77602 3 3.00002 3.224 3.00002 3.5V6.5C3.00002 7.327 3.67302 8 4.50002 8H12.293L9.64702 5.354C9.45202 5.159 9.45202 4.842 9.64702 4.647C9.84202 4.452 10.159 4.452 10.354 4.647L13.854 8.147C14.049 8.342 14.049 8.659 13.854 8.854L10.354 12.354C10.256 12.452 10.128 12.5 10 12.5C9.87202 12.5 9.74402 12.451 9.64602 12.354C9.45102 12.159 9.45102 11.842 9.64602 11.647L12.292 9.001H4.49902C3.12002 9.001 1.99902 7.88 1.99902 6.501V3.501C1.99902 3.225 2.22302 3.001 2.49902 3.001L2.50002 3Z"/></svg>',
  restartFrame: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5C1 3.22386 1.22386 3 1.5 3H14.5C14.7761 3 15 3.22386 15 3.5C15 3.77614 14.7761 4 14.5 4H1.5C1.22386 4 1 3.77614 1 3.5Z"/><path d="M1 7.5C1 7.22386 1.22386 7 1.5 7H14.5C14.7761 7 15 7.22386 15 7.5C15 7.77614 14.7761 8 14.5 8H1.5C1.22386 8 1 7.77614 1 7.5Z"/><path d="M1 11.5C1 11.2239 1.22386 11 1.5 11H7.99939V11.4994C7.99939 11.6716 8.02899 11.8407 8.08538 12H1.5C1.22386 12 1 11.7761 1 11.5Z"/><path d="M8.99939 9.49939V11.4994C8.99939 11.632 9.05207 11.7592 9.14584 11.8529C9.2396 11.9467 9.36678 11.9994 9.49939 11.9994H11.4994C11.632 11.9994 11.7592 11.9467 11.8529 11.8529C11.9467 11.7592 11.9994 11.632 11.9994 11.4994C11.9994 11.3668 11.9467 11.2396 11.8529 11.1458C11.7592 11.0521 11.632 10.9994 11.4994 10.9994H10.4994C10.5702 10.9049 10.6477 10.8157 10.7314 10.7324C11.2078 10.2778 11.8409 10.0242 12.4994 10.0242C13.1579 10.0242 13.791 10.2778 14.2674 10.7324C14.4996 10.9645 14.6838 11.2402 14.8095 11.5435C14.9352 11.8469 14.9999 12.172 14.9999 12.5004C14.9999 12.8287 14.9352 13.1539 14.8095 13.4573C14.6838 13.7606 14.4996 14.0362 14.2674 14.2684C13.7909 14.7227 13.1578 14.9762 12.4994 14.9762C11.841 14.9762 11.2079 14.7227 10.7314 14.2684C10.6371 14.1773 10.5108 14.1269 10.3797 14.1281C10.2486 14.1292 10.1232 14.1818 10.0305 14.2745C9.93778 14.3672 9.88519 14.4926 9.88405 14.6237C9.88291 14.7548 9.93331 14.8811 10.0244 14.9754C10.6808 15.6318 11.5711 16.0006 12.4994 16.0006C13.4277 16.0006 14.318 15.6318 14.9744 14.9754C15.6308 14.319 15.9996 13.4287 15.9996 12.5004C15.9996 11.5721 15.6308 10.6818 14.9744 10.0254C14.3075 9.38902 13.4212 9.03396 12.4994 9.03396C11.5776 9.03396 10.6912 9.38902 10.0244 10.0254L9.99939 10.0514V9.49939C9.99939 9.36678 9.94671 9.2396 9.85294 9.14584C9.75918 9.05207 9.632 8.99939 9.49939 8.99939C9.36678 8.99939 9.2396 9.05207 9.14584 9.14584C9.05207 9.2396 8.99939 9.36678 8.99939 9.49939Z"/></svg>',
  terminate: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 3.5V12.5H3.5V3.5H12.5ZM12.5 2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H12.5C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2Z"/></svg>',
};

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
  | { command: 'restartFrame'; level: number }
  | { command: 'inspectVariable'; oop: string; name: string }
  | { command: 'saveLayout'; stackBasis?: string; evalHeight?: string };

/** A single variable row (name / printString / oop) sent to the webview. */
interface VarRow {
  name: string;
  value: string;
  /** The variable's OOP as a decimal string (drives the dim column + GT Inspect). */
  oop: string;
}

/**
 * A named group of variable rows. Stage 2 splits the flat list into Receiver
 * (`self`), Instance variables, Arguments & Temps, and a collapsed
 * `(stack temps)` group for the synthetic eval-stack temporaries.
 */
interface VarGroup {
  title: string;
  kind: 'receiver' | 'instvars' | 'argtemps' | 'stacktemps';
  vars: VarRow[];
  /** Rendered collapsed by default (used for the noisy `(stack temps)` group). */
  collapsed?: boolean;
}

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

  /**
   * The Call-Stack-vs-Variables split, as a CSS width for the stack pane
   * (`--stack-basis`). Remembered across panels for the lifetime of this VS Code
   * window so a resize sticks from one debugger to the next; the webview also
   * persists it via getState/setState so it survives a webview reload. (Full
   * cross-restart persistence would need globalState — deferred.) Default 60%.
   */
  private static savedStackBasis = '60%';

  /**
   * The eval bar's height (`--eval-height`); the hsplitter resizes it, trading
   * space with the panes (which flex-fill the rest). Like `savedStackBasis`,
   * remembered across panels for this window and persisted webview-side via
   * getState/setState. Default 7rem.
   */
  private static savedEvalHeight = '7rem';

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
  /** Server level of the currently-selected frame (drives edit-and-continue). */
  private selectedServerLevel: number | undefined;
  /**
   * The `gemstone://` URI of the selected frame's source IFF it is an editable
   * method — set by revealFrameSource, cleared for read-only (doit) frames.
   * Saving this exact document triggers edit-and-continue for the selected frame.
   */
  private editableSourceUri: string | undefined;
  /**
   * True once the TOP frame's method has been recompiled in place but could not
   * be re-entered (GemStone has no primitive to reset the top-of-stack IP — see
   * editAndContinue). The suspended top activation is then stale: continuing or
   * stepping it via GciTsContinueWith / gciStep… does NOT return (it hangs the
   * gem, freezing the whole extension host — confirmed 2026-06-22). So while this
   * is set, Resume/Step are refused with guidance; it clears the moment a trim
   * (Restart a deeper frame / deep edit-and-continue) rebuilds the stack.
   */
  private staleTopActivation = false;
  /**
   * True while a non-blocking GCI operation (step / trim) is in flight. Only one
   * GciTsNb… call may be outstanding per session, and overlapping a blocking
   * Resume on top of one is illegal — so step/resume/restart are ignored while
   * set. Cleared when the operation settles (resolve / reject / cancel).
   */
  private nbBusy = false;
  /** Set in dispose() so an in-flight Nb op's continuation skips touching a dead panel. */
  private disposed = false;

  /**
   * @param onComplete called with the process's result oop when execution
   *   completes via Resume or step-to-completion (e.g. so a halted Display It
   *   can render its result back in the workspace). Omitted when there's no
   *   result to surface (Execute It, or a halt not originating from a doit).
   */
  static create(
    session: ActiveSession, gsProcess: bigint, errorMessage: string,
    onComplete?: (resultOop: bigint) => void,
  ): void {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneEnhancedDebugger',
      'Jasper Debugger',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    const debugger_ = new DebuggerPanel(panel, session, gsProcess, errorMessage, onComplete);
    if (!DebuggerPanel.panels.has(session.id)) {
      DebuggerPanel.panels.set(session.id, new Set());
    }
    DebuggerPanel.panels.get(session.id)!.add(debugger_);
    // Disable native code for this session so the debugger can single-step
    // (GemStone can't step native code — error 6014). Released on dispose.
    debug.acquireStepping(session);
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
    private readonly onComplete?: (resultOop: bigint) => void,
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
    // Edit-and-continue: saving the selected frame's source recompiles it (the
    // gemstone:// FS provider) and then re-enters the recompiled method.
    vscode.workspace.onDidSaveTextDocument(
      (doc) => this.onSourceSaved(doc),
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
          this.selectedServerLevel = frame.serverLevel;
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
        void this.step(msg.command, msg.level);
        return;
      }
      case 'restartFrame': {
        const frame = this.frames.find(f => f.level === msg.level);
        if (frame) void this.restartFrame(frame.serverLevel);
        return;
      }
      case 'inspectVariable': {
        // Open the clicked variable in a GT Inspector (beside), like GT Inspect.
        try {
          GtInspector.create(this.session, BigInt(msg.oop), msg.name);
        } catch (e: unknown) {
          logError(this.sessionId, e instanceof Error ? e.message : String(e));
        }
        return;
      }
      case 'saveLayout': {
        // Remember the splits (stack-vs-variables width, eval-bar height) so the
        // next panel opens the same way. Each is sent only when it changed.
        if (msg.stackBasis != null) DebuggerPanel.savedStackBasis = msg.stackBasis;
        if (msg.evalHeight != null) DebuggerPanel.savedEvalHeight = msg.evalHeight;
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

  /** Fetch the selected frame's grouped variables and post them. */
  private postVariables(serverLevel: number): void {
    let groups: VarGroup[] = [];
    try {
      groups = this.fetchVariables(serverLevel);
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
    this.panel.webview.postMessage({ command: 'variables', groups });
  }

  /**
   * The selected frame's variables, split into Receiver (`self`), Instance
   * variables (the receiver's named instVars), Arguments & Temps (the frame's
   * *named* args/temps), and a collapsed `(stack temps)` group for the synthetic
   * `.tN` eval-stack temporaries (which have no source name). Each printString
   * and the instVar resolution are best-effort so one bad slot can't blank the
   * whole pane. Each row carries its OOP for the dim column + click-to-inspect.
   */
  private fetchVariables(serverLevel: number): VarGroup[] {
    const info = debug.getFrameInfo(this.session, this.gsProcess, serverLevel);
    const safePrint = (oop: bigint): string => {
      try { return debug.getObjectPrintString(this.session, oop); }
      catch { return '<unprintable>'; }
    };
    const row = (name: string, oop: bigint): VarRow =>
      ({ name, value: safePrint(oop), oop: oop.toString() });

    const groups: VarGroup[] = [];

    // 1. Receiver — `self`.
    groups.push({ title: 'Receiver', kind: 'receiver', vars: [row('self', info.receiverOop)] });

    // 2. Instance variables — the receiver's named instVars (none for immediates).
    try {
      const ivNames = debug.getInstVarNames(this.session, info.receiverOop);
      if (ivNames.length > 0) {
        const ivOops = debug.getNamedInstVarOops(this.session, info.receiverOop, ivNames.length);
        const ivVars = ivNames.map((n, i) => row(n, ivOops[i]));
        groups.push({ title: 'Instance variables', kind: 'instvars', vars: ivVars });
      }
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }

    // 3 + 4. Args/temps — real source names vs synthetic `.tN` eval-stack temps.
    // `__vsc…` temps are the Transcript-capture wrapper's glue (see
    // transcriptCapture.ts); they're hidden, just like the glue is stripped from
    // an executed-code frame's source.
    const named: VarRow[] = [];
    const stackTemps: VarRow[] = [];
    for (let i = 0; i < info.argAndTempNames.length; i++) {
      const name = info.argAndTempNames[i];
      if (name.startsWith('__vsc')) continue;
      (name.startsWith('.') ? stackTemps : named).push(row(name, info.argAndTempOops[i]));
    }
    if (named.length > 0) {
      groups.push({ title: 'Arguments & Temps', kind: 'argtemps', vars: named });
    }
    if (stackTemps.length > 0) {
      groups.push({ title: '(stack temps)', kind: 'stacktemps', collapsed: true, vars: stackTemps });
    }
    return groups;
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
    if (this.guardStaleTopActivation('Resume')) return;
    // Don't issue a blocking continue while a non-blocking step/trim is in flight
    // (only one GCI call per session). Resume itself is still BLOCKING — 3.7.x has
    // no GciTsNbContinue — so a long/looping Resume can still stall the host until
    // it returns; making Resume non-blocking needs a worker thread (tracked).
    if (this.nbBusy) {
      this.notifyBusy('Resume');
      return;
    }
    const result = debug.continueExecution(this.session, this.gsProcess);
    if (result.completed) {
      this.onCompleted(result);
    } else {
      this.errorMessage = result.errorMessage || 'GemStone error';
      this.refresh();
    }
  }

  /**
   * Refuse a Resume/Step when the top activation is stale (its method was
   * recompiled in place and couldn't be re-entered). Continuing/stepping it would
   * hang the gem and freeze the extension host. Returns true if the action was
   * blocked (the caller must bail). The only safe escapes are Restart on a deeper
   * frame (re-enters the recompiled code) or Terminate.
   */
  private guardStaleTopActivation(action: string): boolean {
    if (!this.staleTopActivation) return false;
    this.errorMessage = `${action} is unavailable: the top frame's method was recompiled, so its `
      + 'suspended activation can no longer be continued (GemStone would hang). Restart a deeper '
      + 'frame to re-enter the recompiled code, or Terminate the process.';
    this.postInit();
    return true;
  }

  /**
   * The process ran to completion (via Resume or step). Hand its result to the
   * onComplete callback (e.g. a halted Display It rendering its value back in
   * the workspace) — BEFORE dispose, while the result oop is still fetchable —
   * then close the panel.
   */
  private onCompleted(result: debug.StepResult): void {
    if (result.resultOop != null) this.onComplete?.(result.resultOop);
    this.panel.dispose();
  }

  /**
   * Step over/into/through, then dispose on completion / else refresh.
   *
   * Steps from the selected (or topmost) USER frame's server level — NOT the
   * process top (level 1). After a `halt`/error the process top is exception/
   * signal machinery (which we filter out of the view); stepping over from a
   * user frame runs that machinery to completion and stops at the next step
   * point in the user code (e.g. the statement after `halt`), which is what the
   * user expects from one Step Over. Stepping from level 1 would instead crawl
   * one step point at a time through the hidden machinery.
   *
   * Requires native code OFF (codeExecutor toggles it before a debuggable run;
   * the panel holds it off while open) — GemStone can't step native code (error
   * 6014). If a step still hits that, we surface a clear message rather than
   * fail silently. Resume is unaffected.
   */
  private async step(command: 'stepOver' | 'stepInto' | 'stepThrough', displayLevel?: number): Promise<void> {
    if (this.guardStaleTopActivation('Step')) return;
    const fn = command === 'stepOver' ? debug.stepOverNb
      : command === 'stepInto' ? debug.stepIntoNb
        : debug.stepThruNb; // "Through" == gciStepThru
    const frame = this.frames.find(f => f.level === displayLevel) ?? this.frames[0];
    const level = frame?.serverLevel ?? 1;
    await this.runNb('Step', async () => {
      // Non-blocking + cancellable: a step that crawls hidden machinery or steps
      // a looping method no longer freezes the extension host (see nbRunner.ts).
      const result = await fn(this.session, this.gsProcess, level);
      if (this.disposed) return; // panel closed while the step ran
      if (result.completed) {
        this.onCompleted(result);
        return;
      }
      if (result.errorMessage && /native code/i.test(result.errorMessage)) {
        this.errorMessage = 'Stepping is unavailable while the gem runs native code '
          + '(GEM_NATIVE_CODE_ENABLED). Use Resume — or run the gem with native code disabled to step.';
        this.postInit(); // show the note; the stack is unchanged
        return;
      }
      this.errorMessage = ''; // stepped to a new point — clear the original halt banner
      this.refresh();
    });
  }

  /**
   * Report a failed/cancelled non-blocking op in the panel banner (best-effort —
   * does nothing if the panel was disposed mid-flight). A user cancel (hard
   * break) is surfaced as "<action> cancelled", anything else as a failure.
   */
  private handleNbError(action: string, e: unknown): void {
    if (this.disposed) return;
    if (e instanceof NbCancelledError) {
      this.errorMessage = `${action} cancelled.`;
    } else {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
      this.errorMessage = `${action} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.refresh();
  }

  /**
   * Run a non-blocking debugger op (step / trim) under the single-in-flight
   * guard. Owns the `nbBusy` lifecycle in a `finally` so it can NEVER leak — a
   * leaked flag would silently wedge the debugger (every later step/resume/
   * restart becomes a no-op). `op` does the work and its own post-processing; a
   * thrown error (including a user cancel) is surfaced via handleNbError. If an
   * op is already in flight the request is NOT silently dropped — the user is
   * told to retry (otherwise a save-driven edit-and-continue or a click would
   * just vanish).
   */
  private async runNb(action: string, op: () => Promise<void>): Promise<void> {
    if (this.nbBusy) {
      this.notifyBusy(action);
      return;
    }
    this.nbBusy = true;
    try {
      await op();
    } catch (e: unknown) {
      this.handleNbError(action, e);
    } finally {
      this.nbBusy = false;
    }
  }

  /** Tell the user another debugger op is still running rather than dropping theirs. */
  private notifyBusy(action: string): void {
    if (this.disposed) return;
    this.errorMessage = `Another debugger operation is still running — wait for it to finish, then retry ${action}.`;
    this.postInit();
  }

  /**
   * Restart the selected frame: re-enter its method from the first statement,
   * keeping the receiver + arguments. GemStone does this via
   * `GsProcess>>trimStackToLevel:` (the same primitive GT's `restartFrameLevel:`
   * uses), which trims the calls made from the frame and resets the new
   * top-of-stack to its method's first instruction.
   *
   * That primitive is a guarded no-op for level 1, and there is no primitive to
   * reset the *top* frame's IP in place — so the absolute top frame can't be
   * restarted. Tell the user instead of silently doing nothing; restart still
   * works on any deeper frame (for a recursive call, restarting the caller frame
   * re-enters the same method one level up).
   */
  private async restartFrame(serverLevel: number): Promise<void> {
    if (serverLevel <= 1) {
      // Show the notice IN the panel (the banner) — a toast is easy to miss while
      // the webview has focus. It clears on the next step/resume/restart.
      this.errorMessage = 'Cannot restart the top frame: GemStone can only restart a frame '
        + 'that has called another. Select a deeper frame to restart it.';
      this.postInit();
      return;
    }
    await this.runNb('Restart frame', async () => {
      await debug.trimStackToLevelNb(this.session, this.gsProcess, serverLevel);
      if (this.disposed) return;
      this.staleTopActivation = false; // the trim discarded any stale top activation
      this.errorMessage = '';
      this.refresh();
    });
  }

  /**
   * Edit-and-continue. The companion source editor IS a real `gemstone://`
   * editor, so saving it already recompiles the method (the FS provider's
   * writeFile). We hook the *post*-save moment: when the saved document is the
   * selected frame's editable source AND the recompile succeeded, re-enter the
   * recompiled method so execution picks up the new code.
   *
   * Only the selected frame's editable source counts — a read-only doit, or a
   * save of some unrelated method, is ignored (`editableSourceUri` gates it).
   *
   * A failed recompile leaves the OLD method installed and an error diagnostic
   * on the URI (the FS provider sets it and does NOT rethrow, so this save still
   * fires) — we detect that and do nothing, so the user just fixes and re-saves.
   */
  private onSourceSaved(doc: vscode.TextDocument): void {
    if (this.editableSourceUri === undefined || this.selectedServerLevel === undefined) return;
    if (doc.uri.toString() !== this.editableSourceUri) return;
    // The recompile failed if the FS provider left an error diagnostic on the URI
    // (it sets one and does NOT rethrow, so this save still fires) — then we leave
    // the old method installed and do nothing; the user fixes and re-saves.
    const failed = vscode.languages
      .getDiagnostics(doc.uri)
      .some((d) => d.severity === vscode.DiagnosticSeverity.Error);
    if (failed) return;
    void this.editAndContinue(this.selectedServerLevel);
  }

  /**
   * Re-enter the (just-recompiled) selected frame's method. Reuses the restart
   * mechanism: `trimStackToLevel:` installs the recompiled home method on the
   * frame and resets it to its method's first instruction (the running activation
   * still held the OLD GsNMethod and could not continue on it). Execution then
   * flows into the new code on the next step/resume.
   *
   * Same GemStone limitation as Restart Frame: the primitive is a guarded no-op
   * for the absolute top frame (level 1), so an edit there can't be re-entered in
   * place — we tell the user instead of silently doing nothing. (After a halt/
   * error the user's frame is normally below the trimmed signal machinery, so its
   * server level is ≥ 2 and edit-and-continue works.)
   */
  private async editAndContinue(serverLevel: number): Promise<void> {
    if (serverLevel <= 1) {
      // The top method is now recompiled but its activation can't be re-entered;
      // mark it stale so Resume/Step refuse to continue it (would hang the gem).
      this.staleTopActivation = true;
      this.errorMessage = 'Saved and recompiled — but GemStone cannot re-enter the top frame in '
        + 'place, so its suspended activation can no longer be continued. Restart a deeper frame '
        + 'to re-enter the recompiled code, or Terminate the process. (Resume/Step are disabled.)';
      this.postInit();
      return;
    }
    await this.runNb('Edit-and-continue', async () => {
      await debug.trimStackToLevelNb(this.session, this.gsProcess, serverLevel);
      if (this.disposed) return;
      this.staleTopActivation = false; // the trim rebuilt the stack from a fresh activation
      this.errorMessage = '';
      this.refresh();
    });
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
        // Saving this document triggers edit-and-continue for the selected frame.
        this.editableSourceUri = uri.toString();
      } else {
        // A read-only doit / non-symbol-list method can't be edited-and-continued.
        this.editableSourceUri = undefined;
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
    const stackBasis = DebuggerPanel.savedStackBasis;
    const evalHeight = DebuggerPanel.savedEvalHeight;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Fill the webview column as a flex column so the panes take all available
       height (more stack frames visible) and the eval bar stays pinned at the
       bottom — it can never overlap the companion source editor group below. */
    html, body { height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 0.75rem 1rem;
      box-sizing: border-box;
      height: 100vh;
      margin: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
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
      /* Selectable so the error text can be copied (Ctrl/Cmd+C); the rest of the
         panel stays non-selectable to keep the custom copy menu the only path. */
      user-select: text; -webkit-user-select: text; cursor: text;
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
    /* Pane labels above the Call Stack / Variables panes. */
    .pane-title {
      font-size: 0.9rem; font-weight: 600; margin: 0 0 0.3rem;
      color: var(--vscode-foreground);
    }
    /* Toolbar: icon-only debug controls (the DAP toolbar's codicon glyphs) so it
       stays compact. Tooltips/aria-labels carry the names. */
    .toolbar { display: flex; gap: 0.15rem; margin: 0 0 0.6rem; flex-wrap: wrap; }
    .toolbar button {
      display: flex; align-items: center; justify-content: center;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      background: transparent;
      border: none; padding: 0.3rem; border-radius: 4px; cursor: pointer;
    }
    .toolbar button svg { width: 16px; height: 16px; display: block; }
    .toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .toolbar button.danger { color: var(--vscode-debugIcon-stopForeground, var(--vscode-errorForeground)); }
    /* Call Stack (left) + Variables (right), divided by a draggable splitter.
       --stack-basis is the stack pane's width; the splitter drag rewrites it and
       it's persisted (see debuggerView.js / the saveLayout message). */
    /* The panes row fills the leftover vertical space (flex:1) so the Call Stack /
       Variables get as much room as the column allows. */
    .main { display: flex; align-items: stretch; --stack-basis: 60%; flex: 1 1 auto; min-height: 0; }
    .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .stack-pane { flex: 0 0 var(--stack-basis); }
    .vars-pane { flex: 1 1 0; }
    .main .stack { min-width: 0; flex: 1 1 0; min-height: 0; overflow: auto; }
    /* Draggable divider: a thin hit area with a centred 1px rule that thickens
       and lights up on hover / while dragging. */
    .splitter {
      flex: 0 0 9px; align-self: stretch; cursor: col-resize; position: relative;
      margin-top: 1.7rem; /* skip past the pane titles so the rule spans the lists */
    }
    .splitter::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
      background: var(--vscode-panel-border, transparent);
    }
    .splitter:hover::before, .splitter.dragging::before {
      left: 3px; width: 3px; background: var(--vscode-focusBorder);
    }
    .vars {
      min-width: 0; flex: 1 1 0; min-height: 0; overflow: auto;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
    }
    /* Horizontal divider between the panes and the eval bar: drag up to give the
       eval bar more room (e.g. for a long result), drag down to give the panes
       more room. Rewrites the --eval-height var (the eval bar's fixed height). */
    .hsplitter {
      flex: 0 0 auto; height: 9px; cursor: row-resize; position: relative; margin: 0.2rem 0;
    }
    .hsplitter::before {
      content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 1px;
      background: var(--vscode-panel-border, transparent);
    }
    .hsplitter:hover::before, .hsplitter.dragging::before {
      top: 3px; height: 3px; background: var(--vscode-focusBorder);
    }
    /* Only when the column is genuinely tiny: stack the Variables pane under the
       Call Stack and hide the splitter (a horizontal drag is meaningless in a
       vertical layout). A debugger webview usually lives in a Beside column a few
       hundred px wide, so this threshold stays low — otherwise the side-by-side
       layout would never apply and the panel would be needlessly tall. */
    @media (max-width: 340px) {
      .main { flex-direction: column; }
      .stack-pane, .vars-pane { flex: 1 1 0; }
      .splitter { display: none; }
      .vars-pane { margin-top: 0.6rem; }
    }
    /* Variable groups (Receiver / Instance variables / Arguments & Temps /
       stack temps). Titles toggle their body; the stack-temps group is collapsed. */
    .var-group { margin-bottom: 0.25rem; }
    .var-group-title {
      font-weight: 600; font-size: 0.82rem; cursor: pointer; user-select: none;
      color: var(--vscode-foreground); padding: 0.15rem 0.2rem;
    }
    .var-group-title::before { content: '\\25BE\\00a0'; color: var(--vscode-descriptionForeground); }
    .var-group.collapsed .var-group-title::before { content: '\\25B8\\00a0'; }
    .var-group.collapsed .var-group-body { display: none; }
    .vars .var {
      padding: 0.15rem 0.2rem; display: flex; gap: 0.5rem; align-items: baseline;
      cursor: pointer; border-radius: 3px;
    }
    .vars .var:hover { background: var(--vscode-list-hoverBackground); }
    .vars .var-name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground)); white-space: nowrap; flex: 0 0 auto; }
    .vars .var-name.self { font-style: italic; }
    .vars .var-value { color: var(--vscode-descriptionForeground); white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; }
    /* OOP shown dim at the row end, matching the GT Inspector header convention. */
    .vars .var-oop {
      flex: 0 0 auto; margin-left: auto; white-space: nowrap;
      font-size: 0.78em; color: var(--vscode-descriptionForeground); opacity: 0.75;
    }
    /* Eval-in-frame bar: a fixed-height region at the bottom (the hsplitter
       resizes it). The result area scrolls within it. */
    .evalbar {
      flex: 0 0 var(--eval-height, 7rem); min-height: 2.6rem; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .evalbar input {
      width: 100%; box-sizing: border-box; user-select: text; -webkit-user-select: text;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
      padding: 0.3rem 0.5rem; border-radius: 2px; flex: 0 0 auto;
    }
    .eval-result {
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem;
      white-space: pre-wrap; margin-top: 0.35rem; user-select: text; -webkit-user-select: text;
      flex: 1 1 auto; min-height: 0; overflow: auto;
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
    <button data-cmd="resume" title="Resume execution" aria-label="Resume execution">${TOOLBAR_ICONS.resume}</button>
    <button data-cmd="stepOver" title="Step over (from the selected frame)" aria-label="Step over">${TOOLBAR_ICONS.stepOver}</button>
    <button data-cmd="stepInto" title="Step into" aria-label="Step into">${TOOLBAR_ICONS.stepInto}</button>
    <button data-cmd="stepThrough" title="Step through blocks" aria-label="Step through blocks">${TOOLBAR_ICONS.stepThrough}</button>
    <button data-cmd="restartFrame" title="Restart the selected frame" aria-label="Restart the selected frame">${TOOLBAR_ICONS.restartFrame}</button>
    <button data-cmd="terminate" class="danger" title="Terminate the process" aria-label="Terminate the process">${TOOLBAR_ICONS.terminate}</button>
  </div>
  <div class="error" id="error"></div>
  <div class="main" id="main" style="--stack-basis: ${stackBasis};">
    <div class="pane stack-pane">
      <div class="pane-title">Call Stack</div>
      <ul class="stack" id="stack"></ul>
    </div>
    <div class="splitter" id="splitter" title="Drag to resize"></div>
    <div class="pane vars-pane">
      <div class="pane-title">Variables</div>
      <div class="vars" id="variables"></div>
    </div>
  </div>
  <div class="hsplitter" id="hsplitter" title="Drag to resize the panes vs the eval bar"></div>
  <div class="evalbar" id="evalbar" style="--eval-height: ${evalHeight};">
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
      evalbar: document.getElementById('evalbar'),
      main: document.getElementById('main'),
      splitter: document.getElementById('splitter'),
      hsplitter: document.getElementById('hsplitter'),
    }, vscode);
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true; // an in-flight Nb step/trim continuation must skip the dead panel
    DebuggerPanel.panels.get(this.sessionId)?.delete(this);
    // Restore native code once the last debugger for this session closes
    // (paired with acquireStepping in create).
    debug.releaseStepping(this.session);
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
