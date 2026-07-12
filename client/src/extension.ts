import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { LoginStorage } from './loginStorage';
import { getLoginPassword, deleteLoginPassword } from './loginCredentials';
import { LoginTreeProvider, GemStoneLoginItem, GemStoneSessionItem } from './loginTreeProvider';
import { GemStoneLogin, loginLabel, loginTargetKey, sameLoginTarget } from './loginTypes';
import { InFlightGuard } from './inFlightGuard';
import { LoginEditorPanel } from './loginEditorPanel';
import { SessionManager, ActiveSession } from './sessionManager';
import {
  enhancedInspectorPerfTracker,
  buildEnhancedInspectorPerfStatusBarText,
  buildEnhancedInspectorPerfClipboardText,
  buildEnhancedInspectorPerfQuickPickItems,
  RESET_LABEL,
  COPY_LABEL,
} from './enhancedInspectorPerfTracker';
import { CodeExecutor } from './codeExecutor';
import { SystemBrowser } from './systemBrowser';
import { obtainSystemUserSession, refreshWorkingSession } from './systemUserSession';
import {
  startSeasideServer,
  stopSeasideServer,
  stopAllSeasideServers,
  SEASIDE_DEFAULT_PORT,
} from './seasideServer';
import { findRowanLoadSpecs, deriveRepoName, cloneGitRepo, updateGitRepo, normalizeGitUrl } from './rowanLoad';
import { NbCancelledError } from './nbRunner';
import { RowanRepoRegistry } from './rowanRepos';
import { RowanTreeProvider, RowanRepoItem, RowanLoadedProjectItem, RowanChangesProjectItem } from './rowanTreeProvider';
import { RowanDecorationProvider } from './rowanDecorations';
import { GlobalsBrowser } from './globalsBrowser';
import { CommentBrowser } from './commentBrowser';
import { EnhancedInspector } from './enhancedInspector';
import {
  runInstallEnhancedInspector,
  configureEnhancedInspectorAutoInstall,
  maybeOfferEnhancedInspectorInstall,
} from './enhancedInspectorCommand';
import { refreshEnhancedInspectorAvailable } from './enhancedInspectorAvailability';
import { supportsEnhancedInspector } from './enhancedInspectorInstall';
import { DebuggerPanel } from './debuggerPanel';
import { InlineValuesCodeLensProvider } from './inlineValuesCodeLens';
import { GemStoneFileSystemProvider, MethodCompiledEvent, ClassDefinitionCompiledEvent, closeGemstoneTabsForSession, installStaleGemstoneTabReaper } from './gemstoneFileSystemProvider';
import { openWorkspace } from './workspace';
import { openTutorialNotebook } from './tutorialNotebook';
import { GemStoneDebugSession } from './gemstoneDebugSession';
import { InspectorTreeProvider, InspectorNode } from './inspectorTreeProvider';
import { registerGemStoneExplorer } from './gemstoneExplorer';
import { GemStoneWorkspaceSymbolProvider } from './gemstoneSymbolProvider';
import { GemStoneDefinitionProvider } from './gemstoneDefinitionProvider';
import { GemStoneHoverProvider } from './gemstoneHoverProvider';
import { GemStoneCompletionProvider } from './gemstoneCompletionProvider';
import { BreakpointManager } from './breakpointManager';
import { SelectorBreakpointManager } from './selectorBreakpointManager';
import { SunitTestController } from './sunitTestController';
import { GrailNotebookController } from './grailNotebookController';
import { SmalltalkNotebookController } from './smalltalkNotebookController';
import { ExportManager } from './exportManager';
import { FileInManager } from './fileInManager';
import { showTranscript, getTranscriptChannel } from './transcriptChannel';
import { getGciLog } from './gciLog';
import { GemStoneCodeLensProvider } from './gemstoneCodeLensProvider';
import * as queries from './browserQueries';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneDatabase } from './sysadminTypes';
import { appendSysadmin, getSysadminChannel } from './sysadminChannel';
import { VersionManager } from './versionManager';
import { VersionTreeProvider, VersionItem } from './versionTreeProvider';
import { DatabaseManager } from './databaseManager';
import { DatabaseTreeProvider, DatabaseNode } from './databaseTreeProvider';
import { runLogicalBackup } from './backupManager';
import { runLogicalRestore, RestoreSession } from './restoreManager';
import { hasFileControlPrivilege } from './queries/backup';
import { ProcessManager } from './processManager';
import { openMcpInspector } from './openMcpInspector';
import { McpSocketServer, writeClaudeDesktopMcpConfig } from './mcpSocketServer';
import { writeClaudeCodeUserMcpConfig } from './claudeCodeUserMcpConfig';
import {
  buildRefreshPromptDeps,
  promptClaudeCodeRefresh,
} from './claudeCodeRefreshPrompt';
import { McpServerTreeProvider } from './mcpServerTreeProvider';
import { DEFAULT_MCP_HTTP_PORT, McpHttpServer } from './mcpHttpServer';
import { ensureSelfSignedCert, trustCertCommand } from './tlsCert';
import { ProcessTreeProvider, ProcessItem } from './processTreeProvider';
import { OsConfigTreeProvider } from './sharedMemoryTreeProvider';
import { runQuickSetup } from './quickSetup';
import {
  isWindows,
  getWslInfo,
  getWslInfoAsync,
  invalidateWslCache,
  getWslNetworkInfoCached,
  refreshWslNetworkInfo,
} from './wslBridge';
import {
  wslExistsSync, wslSymlinkSync, wslMkdirSync, wslImportFileSync,
  wslReaddirSync, wslUnlinkSync, wslChmodSync,
} from './wslFs';
import type {OutputChannel} from "vscode";
import {initializeExtensionFolder} from "./extensionPath";
import {initializeBundledGci, bundledWindowsClientGciPath, bundledGciArchSupported} from "./bundledGci";

let client: LanguageClient;
let sessionManager: SessionManager;
let exportManager: ExportManager;
let fileInManager: FileInManager;
let jasperChannel:OutputChannel;

function logLine(level: "ERROR", scope: string, message: string, data: unknown) {
  jasperChannel?.appendLine(`${new Date().toISOString()} [${level}] [${scope}] ${message} | ${data && JSON.stringify(data)}`);
}

async function logJasperError(message: string, scope: string, error: unknown) {
  logLine("ERROR", scope, message, { error: error instanceof Error ? error.message : String(error) });

  await vscode.window
      .showErrorMessage(message, 'Show Details')
      .then((choice) => {
        if (choice === 'Show Details') {
          jasperChannel.show(true);
        }
      });
}

/**
 * Pre-logout guard for a session that may hold uncommitted work. Given the
 * tri-state result of `sessionNeedsCommit` (true = pending, false = clean,
 * undefined = couldn't tell), returns:
 *  - `'proceed'` — nothing pending, or the user chose to log out (having
 *    optionally committed first);
 *  - `'cancel'`  — the user backed out, or a requested commit failed.
 *
 * `commit` is injected so the flow is unit-testable without a live session, and
 * `undefined` is treated like `true`: a failed probe is not evidence of a clean
 * transaction, so we prompt rather than silently discard.
 */
export async function confirmLogoutWithUncommittedChanges(
  sessionId: number,
  needsCommit: boolean | undefined,
  commit: (id: number) => { success: boolean; err: { number: number; message: string } },
): Promise<'proceed' | 'cancel'> {
  if (needsCommit === false) return 'proceed';

  const title =
    needsCommit === true
      ? `Session ${sessionId} has uncommitted changes.`
      : `Session ${sessionId} may have uncommitted changes.`;
  const detail =
    needsCommit === true
      ? 'Logging out discards them. Commit first to keep your work.'
      : 'Its commit state could not be checked; logging out may discard uncommitted work.';
  const choice = await vscode.window.showWarningMessage(
    title,
    { modal: true, detail },
    'Commit & Logout',
    'Logout Anyway',
  );

  if (choice === 'Commit & Logout') {
    try {
      const { success, err } = commit(sessionId);
      if (!success) {
        vscode.window.showErrorMessage(
          `Session ${sessionId}: Commit failed — ${err.message || `error ${err.number}`}. Not logging out.`,
        );
        return 'cancel';
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Session ${sessionId}: Commit failed — ${msg}. Not logging out.`);
      return 'cancel';
    }
    return 'proceed';
  }

  return choice === 'Logout Anyway' ? 'proceed' : 'cancel';
}

/**
 * The confirmation message to show before aborting, or `null` when the abort is
 * safe to run silently — a clean transaction with no unsaved editors, where the
 * abort discards nothing. Covers two independent losses: the transaction's
 * uncommitted changes (`sessionNeedsCommit`, tri-state, where `undefined` =
 * couldn't tell is treated as pending) and unsaved edits in open `.gs`/method
 * editors that a post-abort refresh would overwrite.
 */
export function abortConfirmMessage(
  needsCommit: boolean | undefined,
  hasUnsavedEditors: boolean,
): string | null {
  const parts: string[] = [];
  if (needsCommit === true) {
    parts.push('This discards this session’s uncommitted changes.');
  } else if (needsCommit === undefined) {
    parts.push('This may discard uncommitted changes (the commit state could not be checked).');
  }
  if (hasUnsavedEditors) {
    parts.push('Exported .gs files have unsaved edits that will be overwritten.');
  }
  return parts.length ? parts.join('\n') : null;
}

export async function handleMethodCompiled(event: MethodCompiledEvent) {
  if (event.uri.toString() === event.previousUri.toString()) {
    return;
  }
  
  await openTextEditorOn(event.uri);
  
  if (event.previousUriIsTemplate) {
    await closeTextEditorOn(event.previousUri);
  }
}

export async function handleClassDefinitionCompiled(event: ClassDefinitionCompiledEvent) {
  if (event.uri.toString() !== event.previousUri.toString()) {
    await openTextEditorOn(event.uri);
  }
  if (event.previousUriIsTemplate) {
    await closeTextEditorOn(event.previousUri);
  }
}

/**
 * Open a scratch Workspace targeting a specific session (the inline action on a
 * session in the Sessions view). The Workspace is a session-agnostic buffer that
 * runs against the *selected* session, so select the clicked session first —
 * otherwise, with several sessions open, Execute It would target whichever
 * session happened to already be active.
 */
export async function openWorkspaceForSession(
  sessionManager: SessionManager,
  item?: GemStoneSessionItem,
): Promise<void> {
  if (item) sessionManager.selectSession(item.activeSession.id);
  await openWorkspace();
}

// Getting Started onboarding. The walkthrough auto-opens once per machine on the
// first successful connect; this globalState key records that it has been shown.
// Clear it via the `gemstone.resetGettingStarted` command to make it auto-open
// again on the next connect.
const GETTING_STARTED_SEEN_KEY = 'gemstone.hasSeenGettingStarted';
const GETTING_STARTED_WALKTHROUGH_ID = 'gemtalksystems.gemstone-ide#gemstoneGettingStarted';

// How long a connect target stays reserved after a login attempt settles, so
// clicks queued behind a slow (blocking) login are dropped when they replay.
// Long enough to outlast the replay, short enough to be imperceptible on retry.
const LOGIN_GUARD_COOLDOWN_MS = 1000;

// Wrap a connect command handler so re-clicks for the same login target, while a
// connection attempt for it is in flight (or cooling down), are dropped instead
// of starting another login. See InFlightGuard. Exported for testing.
export function withLoginGuard(
  guard: InFlightGuard,
  handler: (item: GemStoneLoginItem) => Promise<void>,
): (item: GemStoneLoginItem) => Promise<void> {
  return async (item) => {
    await guard.run(loginTargetKey(item.login), () => handler(item));
  };
}

// Where a tracked Rowan repository is checked out: a folder named `name` in the
// open workspace, so the source is visible and editable in the Explorer.
// Returns undefined (and warns) when no folder is open.
//
// TODO: make the location configurable (workspace vs the extension's global
// storage vs tracking a folder in place). FOR NOW everything lands in the open
// workspace — git clones and copied-in local folders alike.
function rowanWorkspaceDest(name: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage(
      'Open a folder or workspace first — Rowan repositories live inside it.',
    );
    return undefined;
  }
  return path.join(folder.uri.fsPath, name);
}

// Live feedback for the "Rowan repository URL" input box: warn on input that
// isn't a git URL, and otherwise preview the normalized URL that will be cloned
// (so pasting a browser URL like `…/owner/repo/tree/main` visibly resolves to
// `…/owner/repo.git`).
function validateRowanGitUrl(value: string): vscode.InputBoxValidationMessage | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/|\/|~|\.)/.test(v)) {
    return {
      message: 'Expected a git URL, e.g. https://github.com/owner/repo',
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  }
  const normalized = normalizeGitUrl(v);
  return normalized === v
    ? undefined
    : { message: `Will clone: ${normalized}`, severity: vscode.InputBoxValidationSeverity.Info };
}

// True when `p` is already inside one of the open workspace folders.
function isInsideWorkspace(p: string): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + path.sep),
  );
}

// Load a Rowan project from an on-disk directory: find its load spec (picking
// among several), load it over a transient SystemUser session, then refresh the
// working session's view and the browser. Shared by the local-directory and
// git-clone load commands.
async function loadRowanFromDirectory(
  session: ActiveSession, dir: string, sessionManager: SessionManager,
): Promise<void> {
  const specs = findRowanLoadSpecs(dir);
  if (specs.length === 0) {
    vscode.window.showErrorMessage(`No Rowan load specification (.ston) found under ${dir}.`);
    return;
  }
  let spec = specs[0];
  if (specs.length > 1) {
    const picked = await vscode.window.showQuickPick(
      specs.map(s => ({ label: s.name, description: path.relative(dir, s.path), spec: s })),
      { placeHolder: 'Which project spec to load?' },
    );
    if (!picked) return;
    spec = picked.spec;
  }

  // If the project declares it needs more gem temp-object cache than this stone
  // has, the load will overflow ("VM temporary object memory is full"). Warn
  // with the fix before spending minutes on a doomed load — but let the user
  // proceed, since the requirement is a conservative author estimate.
  if (spec.minTempObjCacheKB !== undefined) {
    let gemKB: number | undefined;
    try { gemKB = queries.getGemCacheKB(session); } catch { gemKB = undefined; }
    if (gemKB !== undefined && gemKB < spec.minTempObjCacheKB) {
      const needMB = Math.round(spec.minTempObjCacheKB / 1000);
      const haveMB = Math.round(gemKB / 1000);
      const choice = await vscode.window.showWarningMessage(
        `"${spec.name}" needs about ${needMB} MB of gem temp-object cache, but this stone's gems have ${haveMB} MB — the load will likely run out of memory.`,
        {
          modal: true,
          detail:
            `To fix: set GEM_TEMPOBJ_CACHE_SIZE = ${spec.minTempObjCacheKB}; in the stone's ` +
            `gem.conf and restart it (a Jasper-created stone does this automatically on its next start).`,
        },
        'Load Anyway',
      );
      if (choice !== 'Load Anyway') return;
    }
  }

  // Loading mutates Rowan's system registry — needs SystemUser.
  const sys = await obtainSystemUserSession(session, `load Rowan project "${spec.name}"`);
  if (!sys) return;

  // Runs over the non-blocking execute: big projects load for minutes, and the
  // nb runner keeps the extension responsive and shows a cancellable progress
  // notification. Cancelling hard-breaks the gem; the logout below then discards
  // the aborted transaction, so nothing partial is committed.
  let result;
  try {
    result = await queries.loadRowanProjectNb(sys, spec.path, dir, `Loading ${spec.name}…`);
  } catch (e: unknown) {
    if (e instanceof NbCancelledError) {
      vscode.window.showInformationMessage(`Load of "${spec.name}" cancelled.`);
    } else {
      vscode.window.showErrorMessage(`Load of "${spec.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  } finally {
    try { session.gci.GciTsLogout(sys.handle); } catch { /* transient session */ }
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Load of "${spec.name}" failed: ${result.detail}`);
    return;
  }
  // The load committed on the SystemUser session; refresh the working session's
  // view so the new project is visible.
  await refreshWorkingSession(session, sessionManager, `Rowan project "${result.detail}" loaded.`);
}

export function activate(context: vscode.ExtensionContext) {
  // Create every output channel up front — not lazily on first use — so the
  // full set is discoverable in the Output view's channel dropdown from
  // activation. (The Class Sync channel is created just after ExportManager is
  // constructed; the LSP channel by client.start(); the Enhanced Inspector Perf
  // channel with the perf tracker.) See docs/output-channels.md.
  jasperChannel = vscode.window.createOutputChannel('Jasper');
  context.subscriptions.push(
    jasperChannel,
    getGciLog(),
    getTranscriptChannel(),
    getSysadminChannel(),
  );

  initializeBundledGci(context.extensionPath);

  // Reap any companion debugger source tab a prior session left open when its
  // window was closed with the Enhanced Debugger still up (it restores orphaned
  // and broken — no session to resolve gemstone://). See DebuggerPanel.
  DebuggerPanel.initSourceTabCleanup(context.workspaceState);


  // Inline-value overlay (#5): a source-pane CodeLens toggles it. The lens is
  // emitted only for source docs a live debugger is showing; the command it fires
  // carries that doc's URI so the right panel toggles.
  const inlineValuesLens = new InlineValuesCodeLensProvider();
  DebuggerPanel.setSourceCodeLensProvider(inlineValuesLens);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gemstone.toggleInlineValues',
      (uri?: unknown) => DebuggerPanel.toggleInlineValuesForUri(typeof uri === 'string' ? uri : undefined),
    ),
    vscode.commands.registerCommand(
      'gemstone.toggleInlineValuesPerLine',
      (uri?: unknown) => DebuggerPanel.toggleInlineValuesPerLineForUri(typeof uri === 'string' ? uri : undefined),
    ),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'gemstone' }, { scheme: 'gemstone-debug' }], inlineValuesLens,
    ),
    // The inline-value hover (#5): serves each variable's full printString for a
    // hovered line, plus a hint that editable ones are set by clicking the name.
    vscode.languages.registerHoverProvider(
      [{ scheme: 'gemstone' }, { scheme: 'gemstone-debug' }],
      {
        provideHover(doc, pos) {
          const md = DebuggerPanel.provideInlineHover(doc.uri.toString(), pos.line);
          return md ? new vscode.Hover(md) : undefined;
        },
      },
    ),
  );

  try {
    initializeExtensionFolder();
  } catch (error) {
    void logJasperError(`Jasper could not set up its local folder. Please check folder permissions and reload VS Code.`, "initialization", error);
    throw error;
  }
  
  // Populated by the async cert-generation step below; read by the
  // `gemstone.openMcpInspector` command so Node trusts our self-signed cert
  // (macOS keychain trust doesn't extend to Node's TLS stack).
  let certPathForTrust: string | undefined;

  // ── LSP Client ───────────────────────────────────────────
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'gemstone-topaz' },
      { scheme: 'file', language: 'gemstone-tonel' },
      { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    ],
    synchronize: {
      configurationSection: 'gemstoneSmalltalk',
    },
  };

  client = new LanguageClient(
    'gemstone-smalltalk',
    'GemStone Smalltalk Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  // ── Login Management ─────────────────────────────────────
  const storage = new LoginStorage();
  const sysadminStorage = new SysadminStorage();
  // SessionManager is created early so the Logins panel can mark the connected
  // login row (and swap its inline Login action for Logout) in single-session mode.
  sessionManager = new SessionManager();

  // De-duplicates connect clicks: the blocking GciTsLogin freezes the extension
  // host while it runs, so extra clicks during a slow login queue up and replay
  // once it returns. The cooldown keeps the target reserved briefly past the
  // call's return so those late replays are dropped too. See InFlightGuard.
  const loginGuard = new InFlightGuard(LOGIN_GUARD_COOLDOWN_MS);

  // Sessions don't survive a window reload, so any gemstone:// method/class tab
  // VS Code restored from the previous window is unservable and shows a broken
  // "could not be opened" editor. Reap such stale tabs — both those already
  // present and (winning the async-restore race) those that appear afterward.
  // Must run after sessionManager exists (the reaper checks for a live session).
  context.subscriptions.push(installStaleGemstoneTabReaper(sessionManager));

  const treeProvider = new LoginTreeProvider(storage, sessionManager);

  const treeView = vscode.window.createTreeView('gemstoneLogins', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.logins')) {
        treeProvider.refresh();
      }
      if (e.affectsConfiguration('gemstone.maxEnvironment')) {
        // maxEnvironment changes are picked up on next browser refresh
      }
      if (e.affectsConfiguration('gemstone.sessionMode')) {
        applySessionModeContext();
      }
    })
  );

  // Drive the `gemstone.multipleSessions` context key (used to show/hide the
  // Sessions panel) from the gemstone.sessionMode preference.
  const applySessionModeContext = () => {
    const mode = vscode.workspace.getConfiguration('gemstone').get<string>('sessionMode', 'single');
    vscode.commands.executeCommand('setContext', 'gemstone.multipleSessions', mode === 'multiple');
  };
  applySessionModeContext();

  // A login may not be edited or deleted while it has a live session, which also
  // guarantees every active session keeps a matching login row to nest under.
  const loginHasActiveSession = (login: GemStoneLogin): boolean =>
    sessionManager.getSessions().some((s) => sameLoginTarget(s.login, login));

  // ── Session Management ───────────────────────────────────
  // Active sessions are shown as children of their login in the Logins &
  // Sessions tree (treeProvider above); there is no separate Sessions view.
  exportManager = new ExportManager();
  // Create the Class Sync channel now so it joins the others in the dropdown.
  const classSyncChannel = exportManager.ensureLogChannel();
  if (classSyncChannel) context.subscriptions.push(classSyncChannel);
  SystemBrowser.setExportManager(exportManager);
  fileInManager = new FileInManager(sessionManager, exportManager);
  fileInManager.register(context);

  // ── Object Inspector ──────────────────────────────────────
  const inspectorProvider = new InspectorTreeProvider(sessionManager);
  // The debugger's "Inspect" falls back to this tree view when the session has
  // no enhanced inspector; give the panel a handle to it (it isn't constructed
  // with one — its factory is called from deep in codeExecutor).
  DebuggerPanel.inspectorProvider = inspectorProvider;

  const inspectorView = vscode.window.createTreeView('gemstoneInspector', {
    treeDataProvider: inspectorProvider,
    showCollapseAll: true,
  });
  inspectorProvider.setView(inspectorView);
  context.subscriptions.push(inspectorView, inspectorProvider);

  // ── GemStone Explorer (cascading navigation panes) ───────────
  const explorer = registerGemStoneExplorer(context, sessionManager);

  // ── GemStone FileSystem Provider ─────────────────────────
  const gemstoneFs = new GemStoneFileSystemProvider(sessionManager, exportManager);
  context.subscriptions.push(
    gemstoneFs,
    vscode.workspace.registerFileSystemProvider('gemstone', gemstoneFs, {
      isCaseSensitive: true,
    })
  );

  // ── Workspace Symbol Provider (Cmd+T class search) ──────
  const symbolProvider = new GemStoneWorkspaceSymbolProvider(sessionManager);
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(symbolProvider),
  );

  // Set language mode for gemstone:// documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === 'gemstone') {
        vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
      }
    })
  );

  // Lock editors for read-only .gs files (e.g. Globals for non-SystemUser)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const { uri } = editor.document;
      if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.gs')) return;
      try {
        const stat = fs.statSync(uri.fsPath);
        if ((stat.mode & 0o200) === 0) {
          vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
        }
      } catch { /* ignore */ }
    })
  );

  // ── GCI-backed providers (Definition + Hover + Completion) ─
  const providerSelectors: vscode.DocumentFilter[] = [
    { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    { scheme: 'untitled', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-topaz' },
    { scheme: 'file', language: 'gemstone-tonel' },
  ];
  const selectorResolver = {
    getSelector: (uri: string, position: vscode.Position) =>
      client.sendRequest<string | null>('gemstone/selectorAtPosition', {
        textDocument: { uri },
        position,
      }),
  };
  const definitionProvider = new GemStoneDefinitionProvider(sessionManager, selectorResolver);
  const hoverProvider = new GemStoneHoverProvider(sessionManager, selectorResolver);
  const completionProvider = new GemStoneCompletionProvider(sessionManager);
  const codeLensProvider = new GemStoneCodeLensProvider(sessionManager);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(providerSelectors, definitionProvider),
    vscode.languages.registerHoverProvider(providerSelectors, hoverProvider),
    vscode.languages.registerCompletionItemProvider(providerSelectors, completionProvider),
    vscode.languages.registerCodeLensProvider(providerSelectors, codeLensProvider),
    codeLensProvider, // dispose() cancels pending count lookups + releases the emitter
  );

  // ── Breakpoints + Debugger ───────────────────────────────
  const breakpointManager = new BreakpointManager(sessionManager);
  breakpointManager.register(context);

  const selectorBreakpointManager = new SelectorBreakpointManager(sessionManager);
  selectorBreakpointManager.register(context);

  // Re-apply breakpoints and refresh browser method list after method recompilation
  context.subscriptions.push(
    gemstoneFs.onDidChangeFile(events => {
      for (const event of events) {
        if (event.type === vscode.FileChangeType.Changed) {
          breakpointManager.invalidateForUri(event.uri);
          selectorBreakpointManager.invalidateForUri(event.uri);

          const uri = event.uri;
          if (uri.scheme === 'gemstone') {
            const parts = uri.path.split('/').map(decodeURIComponent);
            // parts: ['', dictName, className, side, category, selector]
            if (parts.length >= 3) {
              const sessionId = parseInt(uri.authority, 10);
              const className = parts[2];
              SystemBrowser.methodCompiled(sessionId, className);
              // Keep the GemStone Explorer's method list in sync too (new-class URIs
              // carry no real class name, so skip those — the class-definition
              // event below handles class creation).
              if (className !== 'new-class') {
                explorer.onMethodCompiled(sessionId, className);
              }
            }
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    gemstoneFs.onMethodCompiled(handleMethodCompiled),
    gemstoneFs.onClassDefinitionCompiled(handleClassDefinitionCompiled),
    // Refresh the GemStone Explorer's class list when a class is created/redefined
    // (the definition event carries the real class name; the new-class URI
    // doesn't). parts: ['', dictName, className, 'definition'].
    gemstoneFs.onClassDefinitionCompiled((e) => {
      const parts = e.uri.path.split('/').map(decodeURIComponent);
      if (parts.length >= 3) {
        explorer.onClassCompiled(parseInt(e.uri.authority, 10), parts[2]);
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('gemstone', {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(
          new GemStoneDebugSession(sessionManager, breakpointManager),
        );
      },
    }),
    vscode.debug.registerDebugConfigurationProvider('gemstone', {
      resolveDebugConfiguration(_folder, config) {
        if (!config.type) config.type = 'gemstone';
        if (!config.request) config.request = 'attach';
        if (!config.name) config.name = 'GemStone Debug';
        return config;
      },
    }),
  );

  // ── SUnit Test Controller ────────────────────────────────
  const sunitTestController = new SunitTestController(sessionManager);
  context.subscriptions.push(sunitTestController);

  // ── Jupyter Notebook Kernels (Grail Python + Smalltalk) ─
  const grailNotebookController = new GrailNotebookController(sessionManager);
  context.subscriptions.push(grailNotebookController);
  const smalltalkNotebookController = new SmalltalkNotebookController(sessionManager);
  context.subscriptions.push(smalltalkNotebookController);

  // ── Code Execution ─────────────────────────────────────
  const codeExecutor = new CodeExecutor(sessionManager);
  context.subscriptions.push(codeExecutor);

  // ── Status Bar: Active Session ─────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBarItem.command = 'gemstone.selectSession';
  context.subscriptions.push(statusBarItem);

  const browserBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 99
  );
  browserBarItem.text = '$(book)';
  browserBarItem.tooltip = 'Open System Browser';
  browserBarItem.command = 'gemstone.openBrowser';
  context.subscriptions.push(browserBarItem);

  function updateStatusBar() {
    const session = sessionManager.getSelectedSession();
    if (session) {
      statusBarItem.text = `$(database) ${loginLabel(session.login)}`;
      statusBarItem.tooltip = 'GemStone: click to change session';
      statusBarItem.show();
      browserBarItem.show();
    } else if (sessionManager.getSessions().length > 0) {
      statusBarItem.text = '$(database) No session selected';
      statusBarItem.tooltip = 'Click to select a GemStone session';
      statusBarItem.show();
      browserBarItem.hide();
    } else {
      statusBarItem.hide();
      browserBarItem.hide();
    }
  }

  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateStatusBar()),
  );
  updateStatusBar();

  // Drive the `gemstone.enhancedInspectorSupported` context key off the selected
  // session's version, so the "Install Enhanced Inspector Support" command is
  // only offered where it can actually work (see package.json commandPalette
  // when-clause). Recomputed on every selection change.
  function updateEnhancedInspectorSupportedContext(): void {
    const selected = sessionManager.getSelectedSession();
    vscode.commands.executeCommand(
      'setContext',
      'gemstone.enhancedInspectorSupported',
      !!selected && supportsEnhancedInspector(selected.stoneVersion),
    );
  }
  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateEnhancedInspectorSupportedContext()),
  );
  updateEnhancedInspectorSupportedContext();

  // ── Enhanced Inspector Perf Tracking ───────────────────────────────────
  const enhancedInspectorPerfChannel = vscode.window.createOutputChannel('GemStone Enhanced Inspector Perf');
  context.subscriptions.push(enhancedInspectorPerfChannel);

  const enhancedInspectorPerfCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  enhancedInspectorPerfCountItem.tooltip = 'Enhanced Inspector Perf: click to see breakdown';
  enhancedInspectorPerfCountItem.command = 'gemstone.showEnhancedInspectorPerfDetails';
  context.subscriptions.push(enhancedInspectorPerfCountItem);

  const enhancedInspectorPerfResetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  enhancedInspectorPerfResetItem.text = '$(debug-restart)';
  enhancedInspectorPerfResetItem.tooltip = 'Reset Enhanced Inspector Perf Counter';
  enhancedInspectorPerfResetItem.command = 'gemstone.resetEnhancedInspectorPerfCounter';
  context.subscriptions.push(enhancedInspectorPerfResetItem);

  function updateEnhancedInspectorPerfStatusBar() {
    if (enhancedInspectorPerfTracker.enabled) {
      enhancedInspectorPerfCountItem.text = buildEnhancedInspectorPerfStatusBarText(enhancedInspectorPerfTracker.count);
      enhancedInspectorPerfCountItem.show();
      enhancedInspectorPerfResetItem.show();
    } else {
      enhancedInspectorPerfCountItem.hide();
      enhancedInspectorPerfResetItem.hide();
    }
  }

  enhancedInspectorPerfTracker.onCountChanged = updateEnhancedInspectorPerfStatusBar;

  const applyEnhancedInspectorPerfSetting = () => {
    const enabled = vscode.workspace.getConfiguration('gemstone').get<boolean>('enhancedInspectorPerfTracking', false);
    enhancedInspectorPerfTracker.setEnabled(enabled);
    vscode.commands.executeCommand('setContext', 'gemstone.enhancedInspectorPerfTracking', enabled);
    updateEnhancedInspectorPerfStatusBar();
  };
  applyEnhancedInspectorPerfSetting();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gemstone.enhancedInspectorPerfTracking')) {
        applyEnhancedInspectorPerfSetting();
      }
    }),
    vscode.commands.registerCommand('gemstone.enableEnhancedInspectorPerfTracking', async () => {
      await vscode.workspace.getConfiguration('gemstone').update('enhancedInspectorPerfTracking', true, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.disableEnhancedInspectorPerfTracking', async () => {
      await vscode.workspace.getConfiguration('gemstone').update('enhancedInspectorPerfTracking', false, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.resetEnhancedInspectorPerfCounter', () => {
      const sorted = [...enhancedInspectorPerfTracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
      enhancedInspectorPerfChannel.appendLine(`[reset] ${enhancedInspectorPerfTracker.count} total GCI calls`);
      for (const [method, count] of sorted) {
        enhancedInspectorPerfChannel.appendLine(`  ${method}: ${count}`);
      }
      enhancedInspectorPerfTracker.reset();
    }),
    vscode.commands.registerCommand('gemstone.showEnhancedInspectorPerfDetails', async () => {
      const clipboardText = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker);
      const items: vscode.QuickPickItem[] = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker).map(item =>
        item.isSeparator
          ? { label: '', kind: vscode.QuickPickItemKind.Separator }
          : { label: item.label, description: item.description }
      );
      const selected = await vscode.window.showQuickPick(items, {
        title: `Enhanced Inspector Perf: ${enhancedInspectorPerfTracker.count} total GCI calls`,
        placeHolder: 'Choose an action, or press Escape to dismiss',
      });
      if (selected?.label === RESET_LABEL) {
        vscode.commands.executeCommand('gemstone.resetEnhancedInspectorPerfCounter');
      } else if (selected?.label === COPY_LABEL) {
        await vscode.env.clipboard.writeText(clipboardText);
        vscode.window.showInformationMessage('Enhanced Inspector Perf breakdown copied to clipboard.');
      }
    }),
  );

  // ── Shared Helpers ─────────────────────────────────────

  async function resolveSelector(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (!editor.selection.isEmpty) {
        return editor.document.getText(editor.selection).trim();
      }
      // Ask LSP for selector at cursor position
      if (client) {
        try {
          const selector = await client.sendRequest<string | null>(
            'gemstone/selectorAtPosition',
            {
              textDocument: { uri: editor.document.uri.toString() },
              position: editor.selection.active,
            },
          );
          if (selector) return selector;
        } catch {
          // LSP not ready or request not supported
        }
      }
    }

    return vscode.window.showInputBox({
      prompt: 'Enter selector',
      placeHolder: 'e.g. at:put:',
    });
  }

  async function showMethodResults(
    session: { id: number },
    results: queries.MethodSearchResult[],
    title: string,
  ): Promise<void> {
    if (results.length === 0) {
      vscode.window.showInformationMessage(`${title}: no results found.`);
      return;
    }

    const items = results.map(r => ({
      label: `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
      description: r.category,
      detail: r.dictName,
      result: r,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} method${results.length === 1 ? '' : 's'} found`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;

    const r = picked.result;
    // If a System Browser is open for this session, navigate it to the selected
    // method (updates all 5 columns) and open the method editor from there.
    // Otherwise fall back to opening the document directly.
    if (!SystemBrowser.navigateTo(session.id, r)) {
      const side = r.isMeta ? 'class' : 'instance';
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
        `/${encodeURIComponent(r.dictName)}` +
        `/${encodeURIComponent(r.className)}` +
        `/${side}` +
        `/${encodeURIComponent(r.category)}` +
        `/${encodeURIComponent(r.selector)}`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }
  }

  // ── Commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.openDocument', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('gemstone.addLogin', () => {
      LoginEditorPanel.show(storage, context.secrets, treeProvider, undefined, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.editLogin', (item: GemStoneLoginItem) => {
      // A connected login opens read-only so its config can still be viewed;
      // the settings are only consumed at login, so editing a live one is
      // disabled (log out first) to avoid disturbing the session's tree row.
      LoginEditorPanel.show(
        storage, context.secrets, treeProvider, item.login, sysadminStorage,
        loginHasActiveSession(item.login),
      );
    }),

    vscode.commands.registerCommand('gemstone.deleteLogin', async (item: GemStoneLoginItem) => {
      if (loginHasActiveSession(item.login)) {
        vscode.window.showWarningMessage(
          `"${loginLabel(item.login)}" has an active session. Log out before deleting it.`,
        );
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Delete login "${loginLabel(item.login)}"?`,
        { modal: true },
        'Delete',
      );
      if (confirmed === 'Delete') {
        if (item.login.password_in_keychain) {
          await deleteLoginPassword(context.secrets, item.login);
        }
        await storage.deleteLogin(loginLabel(item.login));
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('gemstone.duplicateLogin', (item: GemStoneLoginItem) => {
      const copy = { ...item.login, label: '' };
      LoginEditorPanel.show(storage, context.secrets, treeProvider, copy, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.openWalkthrough', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        GETTING_STARTED_WALKTHROUGH_ID,
        false,
      );
    }),

    vscode.commands.registerCommand('gemstone.openWorkspace', async () => {
      await openWorkspace();
    }),

    vscode.commands.registerCommand('gemstone.openTutorial', async () => {
      await openTutorialNotebook();
    }),

    vscode.commands.registerCommand('gemstone.installEnhancedInspector', async () => {
      await runInstallEnhancedInspector(sessionManager, context.extensionPath);
    }),

    vscode.commands.registerCommand('gemstone.configureEnhancedInspectorAutoInstall', async () => {
      await configureEnhancedInspectorAutoInstall();
    }),

    vscode.commands.registerCommand('gemstone.resetGettingStarted', async () => {
      await context.globalState.update(GETTING_STARTED_SEEN_KEY, undefined);
      const openNow = 'Open Walkthrough Now';
      const choice = await vscode.window.showInformationMessage(
        'Getting Started reset — the walkthrough will open automatically on your next connect.',
        openNow,
      );
      if (choice === openNow) {
        void vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          GETTING_STARTED_WALKTHROUGH_ID,
          false,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.login', withLoginGuard(loginGuard, async (item: GemStoneLoginItem) => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage(
          'Please open a folder in the workspace before logging in to GemStone.',
        );
        return;
      }

      const login = { ...item.login };

      // If the login is configured to use the OS keychain, fetch the password
      // from there. Fall through to the prompt if the keychain entry is missing.
      if (login.password_in_keychain && !login.gs_password) {
        const stored = await getLoginPassword(context.secrets, login);
        if (stored) {
          login.gs_password = stored;
        }
      }

      if (!login.gs_password) {
        const password = await vscode.window.showInputBox({
          prompt: `GemStone password for ${login.gs_user || 'user'}@${login.gem_host || 'host'}`,
          password: true,
        });
        if (password === undefined) return;
        login.gs_password = password;
      }

      if (!login.host_password && login.host_user) {
        const password = await vscode.window.showInputBox({
          prompt: `Host password for ${login.host_user}@${login.gem_host || 'host'}`,
          password: true,
        });
        if (password === undefined) return;
        login.host_password = password;
      }

      // Ensure GCI library is configured for this version
      let gciPath = storage.getGciLibraryPath(login.version);

      // Prefer a GCI library bundled with the extension (for secure /
      // air-gapped installs that cannot download from gemtalksystems.com).
      // This must win over the download/file-picker prompts below.
      if (!gciPath && process.platform === 'win32') {
        const bundled = bundledWindowsClientGciPath(login.version);
        if (bundled) {
          if (bundledGciArchSupported()) {
            gciPath = bundled;
          } else {
            // The bundled DLLs are x64; an ARM64 VS Code process cannot load
            // them. Guide the user to the x64 build instead of letting the
            // native loader fail with a cryptic architecture-mismatch error.
            vscode.window.showErrorMessage(
              `The GemStone ${login.version} client library bundled with Jasper is x64, but VS Code is ` +
              `running as ${process.arch}. Install and run the x64 build of VS Code (it runs under ` +
              `emulation on Windows on ARM) to use the bundled library.`,
            );
            return;
          }
        }
      }

      // Auto-detect from extracted version's lib/ directory.
      // Skipped on Windows: the product dir is a Linux build (only .so), so
      // the GCI for a Windows host has to come from the Windows client below.
      if (!gciPath && process.platform !== 'win32') {
        const gsPath = sysadminStorage.getGemstonePath(login.version);
        if (gsPath) {
          const ext = process.platform === 'darwin' ? 'dylib' : 'so';
          const candidate = path.join(gsPath, 'lib', `libgcits-${login.version}-64.${ext}`);
          if (fs.existsSync(candidate)) {
            gciPath = candidate;
          }
        }
      }

      // Auto-detect from extracted Windows client distribution
      if (!gciPath && process.platform === 'win32') {
        const clientGci = sysadminStorage.getWindowsClientGciPath(login.version);
        if (clientGci) {
          gciPath = clientGci;
        }
      }

      // On Windows, offer to download the client distribution before falling
      // back to the manual file picker.
      if (!gciPath && process.platform === 'win32') {
        if (!login.version || !login.version.trim()) {
          vscode.window.showErrorMessage(
            'Cannot download a Windows client: the login has no GemStone version set. Edit the login to choose a version first.',
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          `Windows client library not found for GemStone ${login.version}. Download it?`,
          'Download', 'Browse...',
        );
        if (choice === 'Download') {
          try {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Windows client ${login.version}...`,
                cancellable: true,
              },
              (progress, token) =>
                versionManager.downloadAndExtractWindowsClient(login.version, progress, token),
            );
            gciPath = sysadminStorage.getWindowsClientGciPath(login.version);
            if (gciPath) {
              await storage.setGciLibraryPath(login.version, gciPath);
            }
            versionProvider.loadVersions();
          } catch (e) {
            vscode.window.showErrorMessage(
              `Windows client install failed: ${e instanceof Error ? e.message : e}`,
            );
            return;
          }
        } else if (choice !== 'Browse...') {
          return; // cancelled
        }
      }

      if (!gciPath) {
        const filters: Record<string, string[]> =
          process.platform === 'win32'
            ? { 'DLL files': ['dll'] }
            : process.platform === 'darwin'
              ? { 'Dynamic libraries': ['dylib'] }
              : { 'Shared libraries': ['so'] };

        const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
        const expectedName = `libgcits-${login.version}-64.${ext}`;

        const result = await vscode.window.showOpenDialog({
          title: `Select GCI library (${expectedName}) for GemStone ${login.version}`,
          canSelectMany: false,
          filters,
        });
        if (!result || result.length === 0) return;
        gciPath = result[0].fsPath;

        const selectedName = gciPath.split(/[\\/]/).pop();
        const libPattern = /^libgcits-[\d.]+.*-64\.\w+$/;
        if (!libPattern.test(selectedName || '')) {
          const pick = await vscode.window.showWarningMessage(
            `Selected file "${selectedName}" does not match expected pattern "${expectedName}". Use it anyway?`,
            'Yes', 'No',
          );
          if (pick !== 'Yes') return;
        }
        await storage.setGciLibraryPath(login.version, gciPath);
      }

      // The in-process GCI library reads GEMSTONE_GLOBAL_DIR to find the
      // NetLDI lock file (which encodes the port it is listening on).
      // Set both variables from sysadminStorage so the login can succeed
      // even though the VSCode/Electron process doesn't inherit them.
      process.env.GEMSTONE_GLOBAL_DIR = sysadminStorage.getRootPath();
      const gsInstallPath = sysadminStorage.getGemstonePath(login.version)
        ?? path.dirname(path.dirname(gciPath));
      process.env.GEMSTONE = gsInstallPath;

      let session;
      try {
        session = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${login.stone} on ${login.gem_host} as ${login.gs_user}…`,
            cancellable: false,
          },
          // loginAsync uses the non-blocking GciTsNbLogin path (yielding between
          // polls) so the notification animates and the window stays responsive
          // during a slow connect; it falls back to the blocking login on
          // Windows / older libraries.
          () => sessionManager.loginAsync(login, gciPath),
        );
        refreshEnhancedInspectorAvailable(session);
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `Connected to ${login.stone} (${session.stoneVersion}) on ${login.gem_host} as ${login.gs_user}`
        );
        exportManager.exportSession(session, true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Login failed: ${msg}`);
        return;
      }
      // We no longer auto-open a workspace on every connect (it left a dirty,
      // hot-exit-restored buffer behind). Instead, on the *first* successful
      // connect, open the Getting Started walkthrough once — a richer, native,
      // dismissible onboarding card that links to the on-demand workspace. The
      // workspace stays available afterward via the gemstone.openWorkspace
      // command and the Logins & Sessions welcome view.
      if (!context.globalState.get<boolean>(GETTING_STARTED_SEEN_KEY)) {
        void context.globalState.update(GETTING_STARTED_SEEN_KEY, true);
        void vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          GETTING_STARTED_WALKTHROUGH_ID,
          false,
        );
      }

      // If this stone lacks Enhanced Inspector support, offer (or auto-run) the
      // install per the gemstone.enhancedInspector.autoInstall setting. Fire and
      // forget so the connect flow completes; the offer surfaces its own UI.
      if (!session.enhancedInspectorAvailable) {
        void maybeOfferEnhancedInspectorInstall(session, sessionManager, context.extensionPath);
      }
    })),

    vscode.commands.registerCommand('gemstone.serveSeaside', async () => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('Connect to a GemStone session before serving Seaside.');
        return;
      }
      const host = session.login.gem_host;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        vscode.window.showErrorMessage(
          'Serve Seaside currently supports a local stone (the server runs where the stone does).',
        );
        return;
      }
      const version = session.login.version;
      const gciPath = storage.getGciLibraryPath(version);
      const gemstonePath =
        sysadminStorage.getGemstonePath(version) ??
        (gciPath ? path.dirname(path.dirname(gciPath)) : undefined);
      if (!gemstonePath) {
        vscode.window.showErrorMessage(
          `Could not locate the GemStone ${version} install for this session.`,
        );
        return;
      }
      const globalDir = sysadminStorage.getRootPath();
      try {
        const url = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Starting Seaside server…' },
          () => startSeasideServer({ session, gemstonePath, globalDir }),
        );
        // Prefer the integrated browser; fall back to the external one if this
        // editor build has no Simple Browser.
        try {
          await vscode.commands.executeCommand('simpleBrowser.show', url);
        } catch {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        vscode.window.showInformationMessage(`Seaside is serving at ${url}`);
      } catch (e) {
        vscode.window.showErrorMessage(
          `Serve Seaside failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.stopSeaside', async () => {
      if (stopSeasideServer(SEASIDE_DEFAULT_PORT)) {
        vscode.window.showInformationMessage(
          `Stopped the Seaside server on port ${SEASIDE_DEFAULT_PORT}.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `No Seaside server is running on port ${SEASIDE_DEFAULT_PORT}.`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionCommit', async (item: GemStoneSessionItem) => {
      if (fileInManager.hasUnsavedChanges(item.activeSession)) {
        const choice = await vscode.window.showWarningMessage(
          'Exported .gs files have unsaved edits that will be overwritten.',
          { modal: true },
          'Commit Anyway',
        );
        if (choice !== 'Commit Anyway') return;
      }
      try {
        const { success, err } = sessionManager.commit(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Commit succeeded.`
          );
          await exportManager.refreshSession(item.activeSession);
          SystemBrowser.refresh(item.activeSession.id);
        } else {
          vscode.window.showErrorMessage(
            `Session ${item.activeSession.id}: Commit failed — ${err.message || `error ${err.number}`}`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Commit failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionAbort', async (item: GemStoneSessionItem) => {
      const message = abortConfirmMessage(
        queries.sessionNeedsCommit(item.activeSession),
        fileInManager.hasUnsavedChanges(item.activeSession),
      );
      if (message) {
        const choice = await vscode.window.showWarningMessage(
          message,
          { modal: true },
          'Abort Anyway',
        );
        if (choice !== 'Abort Anyway') return;
      }
      try {
        const { success, err } = sessionManager.abort(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Abort succeeded.`
          );
          await exportManager.refreshSession(item.activeSession);
          SystemBrowser.refresh(item.activeSession.id);
        } else {
          vscode.window.showErrorMessage(
            `Session ${item.activeSession.id}: Abort failed — ${err.message || `error ${err.number}`}`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Abort failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.openBrowser', async (item?: GemStoneSessionItem) => {
      const session = item
        ? item.activeSession
        : await sessionManager.resolveSession();
      if (!session) return;
      SystemBrowser.show(session, exportManager);
    }),

    vscode.commands.registerCommand('gemstone.sessionOpenWorkspace', (item?: GemStoneSessionItem) =>
      openWorkspaceForSession(sessionManager, item),
    ),

    vscode.commands.registerCommand('gemstone.rowanFindClassPackage', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const editor = vscode.window.activeTextEditor;
      const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';
      const className = selected || await vscode.window.showInputBox({
        prompt: 'Class name to locate in Rowan',
        placeHolder: 'e.g. STONReader',
      });
      if (!className) return;

      const owners = queries.findRowanClassOwners(session, className);
      const parts = [
        ...owners.defined.map(o => `defined in ${o.project} / ${o.package}`),
        ...owners.extended.map(o => `extended by ${o.project} / ${o.package}`),
      ];
      if (parts.length === 0) {
        vscode.window.showInformationMessage(`"${className}" is not in any loaded Rowan package.`);
      } else {
        vscode.window.showInformationMessage(`${className}: ${parts.join('; ')}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.searchRowanClasses', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let classes: queries.RowanClassLocation[];
      try {
        classes = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Loading Rowan classes…', cancellable: false },
          () => Promise.resolve(queries.listAllRowanClasses(session)),
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Failed to load Rowan classes: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (classes.length === 0) {
        vscode.window.showInformationMessage('No Rowan classes found (is Rowan installed?).');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        classes.map(c => ({ label: c.name, description: `${c.project} / ${c.package}`, cls: c })),
        { placeHolder: 'Search Rowan classes…', matchOnDescription: true },
      );
      if (!picked) return;

      // Reveal the class's source in the System Browser (opens one if needed).
      SystemBrowser.navigateBeside(session, {
        dictName: picked.cls.symbolDict, className: picked.cls.name,
        isMeta: false, selector: '', category: '',
      });
    }),

    vscode.commands.registerCommand('gemstone.loadRowanProject', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: 'Load Project', title: 'Select a Rowan project directory to load',
      });
      if (!folder || folder.length === 0) return;

      await loadRowanFromDirectory(session, folder[0].fsPath, sessionManager);
      void vscode.commands.executeCommand('gemstone.rowanRefreshView');
    }),

    vscode.commands.registerCommand('gemstone.loadRowanProjectFromGit', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const raw = (await vscode.window.showInputBox({
        prompt: 'Git repository URL of the Rowan project',
        placeHolder: 'https://github.com/owner/repo.git',
        ignoreFocusOut: true,
        validateInput: validateRowanGitUrl,
      }))?.trim();
      if (!raw) return;
      const url = normalizeGitUrl(raw);

      // Clone into the open workspace folder.
      const dest = rowanWorkspaceDest(deriveRepoName(url));
      if (!dest) return;
      if (!fs.existsSync(dest)) {
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Cloning ${url}…`, cancellable: false },
            () => cloneGitRepo(url, dest),
          );
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`git clone failed: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }

      await loadRowanFromDirectory(session, dest, sessionManager);
      void vscode.commands.executeCommand('gemstone.rowanRefreshView');
    }),

    vscode.commands.registerCommand('gemstone.unloadRowanProject', async (nameArg?: string | RowanLoadedProjectItem) => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      // Invoked from the palette (no arg → pick), programmatically (string), or
      // the Rowan view's context menu (tree item).
      let projectName = typeof nameArg === 'string' ? nameArg : nameArg?.project.name;
      if (!projectName) {
        const projects = queries.listRowanProjects(session).projects;
        projectName = await vscode.window.showQuickPick(
          projects.map(p => p.name),
          { placeHolder: 'Unload which Rowan project?' },
        );
      }
      if (!projectName) return;

      const confirm = await vscode.window.showWarningMessage(
        `Unload Rowan project "${projectName}"?`,
        { modal: true, detail: 'This removes its classes and methods from the image. The on-disk source is left untouched.' },
        'Unload',
      );
      if (confirm !== 'Unload') return;

      const sys = await obtainSystemUserSession(session, `unload Rowan project "${projectName}"`);
      if (!sys) return;

      let result;
      try {
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Unloading ${projectName}…`, cancellable: false },
          () => Promise.resolve(queries.unloadRowanProject(sys, projectName!)),
        );
      } finally {
        try { session.gci.GciTsLogout(sys.handle); } catch { /* transient session */ }
      }

      if (!result.success) {
        vscode.window.showErrorMessage(`Unload of "${projectName}" failed: ${result.detail}`);
        return;
      }
      await refreshWorkingSession(session, sessionManager, `Rowan project "${projectName}" unloaded.`);
      void vscode.commands.executeCommand('gemstone.rowanRefreshView');
    }),

    vscode.commands.registerCommand('gemstone.sessionLogout', async (item?: GemStoneSessionItem) => {
      const session = item ? item.activeSession : sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showInformationMessage('No GemStone session to log out of.');
        return;
      }
      const decision = await confirmLogoutWithUncommittedChanges(
        session.id,
        queries.sessionNeedsCommit(session),
        (id) => sessionManager.commit(id),
      );
      if (decision === 'cancel') return;
      // Keep the class mirror on disk: it's keyed by connection target and is
      // re-synced incrementally on the next login, which is far cheaper than
      // rebuilding it from scratch (especially for large, remote images).
      SystemBrowser.disposeForSession(session.id);
      GlobalsBrowser.disposeForSession(session.id);
      CommentBrowser.disposeForSession(session.id);
      // Close any lingering class-definition / method-source editor tabs for this
      // session (e.g. opened via go-to-definition without a browser). Browser-owned
      // tabs are already closed when the browser is disposed above.
      void closeGemstoneTabsForSession(session.id);
      EnhancedInspector.disposeForSession(session.id);
      // Dispose before logout so each panel's dispose() can still release its
      // suspended GsProcess against a live handle.
      DebuggerPanel.disposeForSession(session.id);
      sessionManager.logout(session.id);
      treeProvider.refresh();
      inspectorProvider.removeSessionItems(session.id);
      breakpointManager.clearAllForSession(session.id);
      selectorBreakpointManager.clearAllForSession(session.id);
      vscode.window.showInformationMessage(`Session ${session.id}: Logged out.`);
    }),

    vscode.commands.registerCommand('gemstone.sessionPing', async (item?: GemStoneSessionItem) => {
      const session = item ? item.activeSession : sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showInformationMessage('No GemStone session to ping.');
        return;
      }
      try {
        const { success, err } = sessionManager.ping(session.id);
        if (success) {
          vscode.window.showInformationMessage(`Session ${session.id} is active and responsive.`);
        } else {
          vscode.window.showErrorMessage(
            `Session ${session.id}: Ping failed — ${err.message || `error ${err.number}`}`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Ping failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.selectSession', async (item?: GemStoneSessionItem) => {
      if (item) {
        sessionManager.selectSession(item.activeSession.id);
      } else {
        await sessionManager.resolveSession();
      }
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.exportClasses', async (item?: GemStoneSessionItem) => {
      const session = item
        ? item.activeSession
        : await sessionManager.resolveSession();
      if (!session) return;
      await exportManager.exportSession(session);
    }),

    vscode.commands.registerCommand('gemstone.refreshBrowser', async () => {
      symbolProvider.invalidateCache();
      completionProvider.invalidateCache();
      const session = sessionManager.getSelectedSession();
      if (session) {
        await exportManager.refreshSession(session);
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshTests', () => {
      sunitTestController.refresh();
    }),

    vscode.commands.registerCommand('gemstone.displayIt', () => {
      codeExecutor.displayIt();
    }),

    vscode.commands.registerCommand('gemstone.executeIt', () => {
      codeExecutor.executeIt();
    }),

    vscode.commands.registerCommand('gemstone.debugIt', () => {
      codeExecutor.debugIt();
    }),

    vscode.commands.registerCommand('gemstone.copyDisplayItResult', () => {
      codeExecutor.copyLastResult();
    }),

    vscode.commands.registerCommand('gemstone.outputDisplayItResult', () => {
      codeExecutor.outputLastResult();
    }),

    vscode.commands.registerCommand('gemstone.dismissDisplayResult', () => {
      codeExecutor.dismissDisplayResult();
    }),

    vscode.commands.registerCommand('gemstone.expandDisplayResultInPlace', () => {
      codeExecutor.expandResultInPlace();
    }),

    vscode.commands.registerCommand('gemstone.inspectIt', () => {
      codeExecutor.inspectIt(inspectorProvider);
    }),

    vscode.commands.registerCommand('gemstone.showTranscript', () => {
      showTranscript();
    }),

    vscode.commands.registerCommand('gemstone.runSunitClass', async (args: { dictName: string; className: string }) => {
      await sunitTestController.runClassByName(args.dictName, args.className);
    }),

    vscode.commands.registerCommand('gemstone.runSunitClasses', async (dictName: string, classNames: string[]) => {
      await sunitTestController.runClassesByName(dictName, classNames);
    }),

    vscode.commands.registerCommand('gemstone.runSunitMethods', async (dictName: string, className: string, selectors: string[]) => {
      await sunitTestController.runTestsByName(dictName, className, selectors);
    }),

    vscode.commands.registerCommand('gemstone.runSunitMethodCategory', async (dictName: string, className: string, category: string) => {
      await sunitTestController.runMethodCategoryByName(dictName, className, category);
    }),

    vscode.commands.registerCommand('gemstone.inspectGlobal', async (args: { className: string }) => {
      // The reveal-existing dedup only applies to the classic Inspector tree: when
      // the session has the Enhanced Inspector, inspectExpression opens a webview
      // (not a tree root), so findRootByLabel could never match — skip the lookup
      // and just inspect (a fresh panel, like editor Inspect It).
      const selected = sessionManager.getSelectedSession();
      if (!selected?.enhancedInspectorAvailable) {
        const existing = inspectorProvider.findRootByLabel(args.className);
        if (existing) {
          await inspectorView.reveal(existing, { select: true, focus: true });
          return;
        }
      }
      await codeExecutor.inspectExpression(inspectorProvider, args.className, args.className);
    }),

    vscode.commands.registerCommand('gemstone.sendersOfSelector', async (args: { selector: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.sendersOf(session, args.selector, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `Senders of #${args.selector}`);
    }),

    vscode.commands.registerCommand('gemstone.implementorsOfSelector', async (args: { selector: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.implementorsOf(session, args.selector, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `Implementors of #${args.selector}`);
    }),

    vscode.commands.registerCommand('gemstone.hierarchyImplementorsOf', async (args: { selector: string; className: string; dictIndex: number; isMeta: boolean; direction: 'up' | 'down'; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.hierarchyImplementorsOf(
          session, args.dictIndex, args.className, args.selector, args.isMeta, args.direction, env,
        ));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const side = args.isMeta ? ' class' : '';
      const title = args.direction === 'up'
        ? `${args.className}${side} >> #${args.selector} — superclass implementors`
        : `${args.className}${side} >> #${args.selector} — subclass overrides`;
      await showMethodResults(session, results, title);
    }),

    vscode.commands.registerCommand('gemstone.browseReferences', async (args: { objectName: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.referencesToObject(session, args.objectName, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `References to ${args.objectName}`);
    }),

    vscode.commands.registerCommand('gemstone.removeInspectorItem', (node?: InspectorNode) => {
      if (node) inspectorProvider.removeRoot(node);
    }),

    vscode.commands.registerCommand('gemstone.clearInspector', () => {
      inspectorProvider.clearAll();
    }),

    vscode.commands.registerCommand('gemstone.searchMethods', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const term = await vscode.window.showInputBox({
        prompt: 'Search method source code',
        placeHolder: 'Enter search term',
      });
      if (!term) return;

      await vscode.commands.executeCommand('gemstone.searchMethodsFor', { term, sessionId: session.id });
    }),

    // Search method source for a term in a specific session (no prompt). Used by
    // the browser's "Browse Methods Containing…" context command, which supplies
    // the term; gemstone.searchMethods prompts and then delegates here.
    vscode.commands.registerCommand('gemstone.searchMethodsFor', async (args: { term: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Searching methods for "${args.term}"...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.searchMethodSource(session, args.term, true)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Methods containing "${args.term}"`);
    }),

    vscode.commands.registerCommand('gemstone.sendersOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding senders of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.sendersOf(session, selector, env));
            }
            // Deduplicate by class+meta+selector
            const seen = new Set<string>();
            return Promise.resolve(all.filter(r => {
              const key = `${r.className}|${r.isMeta}|${r.selector}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }));
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Senders search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Senders of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.implementorsOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding implementors of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.implementorsOf(session, selector, env));
            }
            const seen = new Set<string>();
            return Promise.resolve(all.filter(r => {
              const key = `${r.className}|${r.isMeta}|${r.selector}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }));
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Implementors search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Implementors of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.classHierarchy', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const className = await vscode.window.showInputBox({
        prompt: 'Enter class name',
        placeHolder: 'e.g. Array',
      });
      if (!className) return;

      let results: queries.ClassHierarchyEntry[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching hierarchy for ${className}...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.getClassHierarchy(session, className!)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Hierarchy query failed: ${msg}`);
        return;
      }

      if (results.length === 0) {
        vscode.window.showInformationMessage(`No hierarchy found for ${className}.`);
        return;
      }

      const superCount = results.filter(r => r.kind === 'superclass').length;

      const items = results.map(r => {
        let indent: string;
        if (r.kind === 'superclass') {
          const idx = results.indexOf(r);
          indent = '  '.repeat(idx);
        } else if (r.kind === 'self') {
          indent = '  '.repeat(superCount);
        } else {
          indent = '  '.repeat(superCount + 1);
        }
        const marker = r.kind === 'self' ? ' \u25C0' : '';
        return {
          label: `${indent}${r.className}${marker}`,
          description: r.dictName,
          detail: r.kind === 'self' ? '(target class)' : undefined,
          entry: r,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Hierarchy for ${className}`,
        matchOnDescription: true,
      });
      if (!picked) return;

      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
        `/${encodeURIComponent(picked.entry.dictName)}` +
        `/${encodeURIComponent(picked.entry.className)}` +
        `/definition`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.toggleSelectorBreakpoint', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      selectorBreakpointManager.toggleBreakpointAtCursor(editor);
    }),

    vscode.commands.registerCommand('gemstone.findClass', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let entries: queries.ClassNameEntry[];
      try {
        entries = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading class list…',
            cancellable: false,
          },
          () => Promise.resolve(queries.getAllClassNames(session)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to load classes: ${msg}`);
        return;
      }

      const items = entries.map(e => ({
        label: e.className,
        description: e.dictName,
        entry: e,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Type to find a class…',
        matchOnDescription: true,
      });
      if (!picked) return;

      if (!SystemBrowser.navigateToClass(
        session.id, picked.entry.dictName, picked.entry.className, picked.entry.dictIndex,
      )) {
        // ?dict=<index> scopes the definition to the exact dictionary the entry
        // came from, so aliases sharing a key (or dictionaries sharing a name)
        // resolve to the class the user picked.
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(picked.entry.dictName)}` +
          `/${encodeURIComponent(picked.entry.className)}` +
          `/definition?dict=${picked.entry.dictIndex}`
        );
        vscode.commands.executeCommand('gemstone.openDocument', uri);
      }
    }),

    vscode.commands.registerCommand('gemstone.findMethod', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let className: string | undefined;
      let dictName: string | undefined;

      const current = SystemBrowser.getSelectedClassName(session.id);
      if (current) {
        className = current.className;
        dictName = current.dictName;
      } else {
        className = await vscode.window.showInputBox({
          prompt: 'Enter class name',
          placeHolder: 'e.g. Array',
        });
        if (!className) return;
      }

      let methods: queries.MethodEntry[];
      try {
        methods = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Loading methods for ${className}…`,
            cancellable: false,
          },
          () => Promise.resolve(queries.getMethodList(session, className!)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to load methods: ${msg}`);
        return;
      }

      if (methods.length === 0) {
        vscode.window.showInformationMessage(`No methods found for ${className}.`);
        return;
      }

      const items = methods.map(m => ({
        label: `${m.isMeta ? '(class) ' : ''}${m.selector}`,
        description: m.category,
        method: m,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Type to find a method in ${className}…`,
        matchOnDescription: true,
      });
      if (!picked) return;

      const result: queries.MethodSearchResult = {
        dictName: dictName || '',
        className: className!,
        isMeta: picked.method.isMeta,
        selector: picked.method.selector,
        category: picked.method.category,
      };

      if (!SystemBrowser.navigateTo(session.id, result)) {
        const side = result.isMeta ? 'class' : 'instance';
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(result.dictName)}` +
          `/${encodeURIComponent(result.className)}` +
          `/${side}` +
          `/${encodeURIComponent(result.category)}` +
          `/${encodeURIComponent(result.selector)}`
        );
        vscode.commands.executeCommand('gemstone.openDocument', uri);
      }
    }),
  );

  // ── SysAdmin ──────────────────────────────────────────────
  // WSL detection runs asynchronously so it never blocks activation and so a
  // cold-start WSL2 VM (not yet running when VS Code launches) doesn't produce
  // a false negative that sticks for the whole session. If the first probe
  // reports unavailable, we wait briefly and retry once before concluding WSL
  // is genuinely missing. The "install WSL" warning is deferred until that
  // second probe also fails, and a subsequent refresh of the Versions view
  // will re-probe — giving the user a recovery path without reloading.
  if (isWindows()) {
    vscode.commands.executeCommand('setContext', 'gemstone.isWindows', true);
    (async () => {
      let wslInfo = await getWslInfoAsync();
      if (!wslInfo.available) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        invalidateWslCache();
        wslInfo = await getWslInfoAsync();
      }
      vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', wslInfo.available);
      if (wslInfo.available) {
        // Allow the extension host to access the WSL filesystem via \\wsl$\... UNC
        // paths. VS Code blocks unknown UNC hosts by default; the Node-side
        // allowlist is read at extension-host startup, so when we add a host we
        // must prompt the user to reload the window before any fs operation on
        // \\wsl$\... will succeed.
        const secConfig = vscode.workspace.getConfiguration('security');
        const allowedHosts = secConfig.get<string[]>('allowedUNCHosts', []);
        const toAdd = ['wsl$', 'wsl.localhost'].filter(h => !allowedHosts.includes(h));
        if (toAdd.length > 0) {
          await secConfig.update(
            'allowedUNCHosts',
            [...allowedHosts, ...toAdd],
            vscode.ConfigurationTarget.Global,
          );
          const choice = await vscode.window.showWarningMessage(
            'GemStone added the WSL filesystem to security.allowedUNCHosts. Reload the window to enable access to \\\\wsl$\\... paths.',
            'Reload Window',
          );
          if (choice === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      } else {
        const choice = await vscode.window.showWarningMessage(
          'GemStone system administration features require Windows Subsystem for Linux (WSL2). ' +
          'Install WSL with: wsl --install',
          'Learn More',
        );
        if (choice === 'Learn More') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install'),
          );
        }
      }
    })();
  }

  const processManager = new ProcessManager(sysadminStorage);
  const inspectorTerminal: { terminal: vscode.Terminal | undefined } = { terminal: undefined };
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      if (inspectorTerminal.terminal === closed) {
        inspectorTerminal.terminal = undefined;
      }
    }),
  );

  // ── Claude Code & Claude Desktop MCP integration ─────────────────────────
  // Jasper exposes a single global MCP server at a fixed socket path. The
  // server name (`gemstone`) and socket path are written into each client's
  // user-scope config on every activation — the configs always point at the
  // same well-known socket, regardless of which Jasper window owns it.
  //
  // Ownership of the live socket (and the HTTPS port) is claimed on the
  // first GemStone login in this window, not on activation. That way the
  // window MCP talks to is the one actually working with GemStone — a window
  // that opens but never logs in stays passive.
  //
  // Once claimed, the socket stays bound for the rest of this VS Code run,
  // even if the user logs out. That keeps Claude Code's MCP connection alive
  // across logout/login cycles — tools just return "no session selected"
  // during the gap and resume working when the user logs back in.
  //
  // Claude Code:    user-scope `mcpServers.gemstone` in `~/.claude.json`.
  // Claude Desktop: `mcpServers.gemstone` in `claude_desktop_config.json`.
  const workspaceRoots = vscode.workspace.workspaceFolders;
  if (workspaceRoots && workspaceRoots.length > 0) {
    const workspacePath = workspaceRoots[0].uri.fsPath;
    const mcpSocketServer = new McpSocketServer({
      getSession: () => sessionManager.getSelectedSession(),
      getSessionLabel: () => {
        const session = sessionManager.getSelectedSession();
        return session ? `${loginLabel(session.login)} (id ${session.id})` : undefined;
      },
      workspacePath,
    });
    const registerDesktop = vscode.workspace.getConfiguration('gemstone')
      .get<boolean>('mcp.registerWithClaudeDesktop', true);

    // Write the well-known configs unconditionally — they point at the fixed
    // socket path, which is correct regardless of which window owns it.
    try {
      const result = writeClaudeCodeUserMcpConfig(
        context.extensionPath,
        mcpSocketServer.socketPath,
      );
      if (result.skipped === 'missing') {
        appendSysadmin(`Claude Code config not found at ${result.path}; skipping user-scope MCP registration.`);
      } else if (result.skipped === 'unreadable') {
        appendSysadmin(`Claude Code config at ${result.path} is unreadable; skipping user-scope MCP registration.`);
      } else {
        appendSysadmin(`Claude Code MCP config: ${result.path}${result.updated ? ' (updated)' : ' (unchanged)'}`);
        if (result.updated) {
          void promptClaudeCodeRefresh(buildRefreshPromptDeps(context));
        }
      }
    } catch (err) {
      appendSysadmin(`Failed to write Claude Code MCP config: ${(err as Error).message}`);
    }
    if (registerDesktop) {
      try {
        const desktopPath = writeClaudeDesktopMcpConfig(
          context.extensionPath,
          mcpSocketServer.socketPath,
        );
        appendSysadmin(`Claude Desktop MCP config: ${desktopPath}`);
      } catch (err) {
        appendSysadmin(`Failed to write Claude Desktop MCP config: ${(err as Error).message}`);
      }
    }

    // HTTPS/SSE surface for clients whose connector UI takes a URL (e.g.
    // Claude Desktop's "Add custom connector" dialog, which rejects http URLs).
    // Tied to socket ownership: the same window owns both, so MCP behavior is
    // consistent across stdio and SSE clients. Override the port per-workspace
    // via `gemstone.mcp.httpPort` to run multiple Jasper windows simultaneously.
    const httpPort = vscode.workspace.getConfiguration('gemstone')
      .get<number>('mcp.httpPort', DEFAULT_MCP_HTTP_PORT);
    let httpServer: McpHttpServer | undefined;
    let httpStarted = false;

    // Tree view that exposes who owns the MCP server right now. Reads its
    // state on demand from the socket server + sidecar file, so a refresh is
    // all that's needed when ownership or session selection changes.
    const mcpTreeProvider = new McpServerTreeProvider({
      isOwner: () => mcpSocketServer.isOwner,
      socketPath: mcpSocketServer.socketPath,
      httpsUrl: () => (httpStarted && httpServer ? httpServer.url : undefined),
      getSession: () => sessionManager.getSelectedSession(),
      sidecarPath: mcpSocketServer.sidecarPath,
    });
    const mcpTreeView = vscode.window.createTreeView('gemstoneMcpServer', {
      treeDataProvider: mcpTreeProvider,
      showCollapseAll: false,
    });
    context.subscriptions.push(mcpTreeView);
    context.subscriptions.push(
      sessionManager.onDidChangeSelection(() => mcpTreeProvider.refresh()),
    );
    // Watch the sidecar file so passive windows pick up ownership changes
    // from elsewhere without polling.
    const sidecarWatcher = fs.watch(
      path.dirname(mcpSocketServer.sidecarPath),
      (_event, filename) => {
        if (!filename || filename === path.basename(mcpSocketServer.sidecarPath)) {
          mcpTreeProvider.refresh();
        }
      },
    );
    // The watcher target may not exist yet on first run; mkdirSync from the
    // sidecar write covers that, but guard the close in dispose anyway.
    context.subscriptions.push({ dispose: () => sidecarWatcher.close() });

    // Eager claim at activation: the first Jasper window to activate owns the
    // MCP socket regardless of whether it has a session yet. Claude Code's
    // MCP client fails the proxy on a short timeout, so the socket needs to
    // be live by the time Claude Code spawns the proxy on the same window
    // reload — deferring until first login lost that race. Tradeoff: if you
    // open a non-GemStone workspace first, that window will own the socket
    // and serve "no session selected" until you log in there or hand off
    // ownership (disable Jasper in that workspace; click "Claim MCP Server"
    // in the workspace you actually want).
    let claimAttemptInFlight = false;
    const tryClaimMcpOwnership = async () => {
      if (mcpSocketServer.isOwner || claimAttemptInFlight) return;
      claimAttemptInFlight = true;
      try {
        const claimed = await mcpSocketServer.start();
        mcpTreeProvider.refresh();
        if (!claimed) return;

        const tls = await ensureSelfSignedCert(context.globalStorageUri.fsPath);
        certPathForTrust = tls.certPath;
        if (tls.generated) {
          appendSysadmin(`Generated self-signed MCP TLS cert at ${tls.certPath}`);
          appendSysadmin(`Trust it once with: ${trustCertCommand(tls.certPath)}`);
          appendSysadmin(`Or run the "GemStone: Install MCP TLS Certificate" command.`);
        }
        httpServer = new McpHttpServer({
          getSession: () => sessionManager.getSelectedSession(),
          port: httpPort,
          tls: { cert: tls.cert, key: tls.key },
        });
        try {
          await httpServer.start();
          httpStarted = true;
          appendSysadmin(`MCP HTTPS listening at ${httpServer.url}`);
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === 'EADDRINUSE') {
            appendSysadmin(`MCP HTTPS port ${httpPort} in use; skipping (another Jasper window may own it). Override gemstone.mcp.httpPort per-workspace to run two windows simultaneously.`);
          } else {
            appendSysadmin(`MCP HTTPS server failed to start: ${e.message}`);
          }
        }
        mcpTreeProvider.refresh();
      } catch (err) {
        appendSysadmin(`MCP claim failed: ${(err as Error).message}`);
      } finally {
        claimAttemptInFlight = false;
      }
    };

    // Session changes have two effects when we're the owner: tools see the
    // new session immediately (via getSession), and the sidecar needs an
    // update so passive Jasper windows can show what's currently selected.
    // When we're not owner, the change still triggers a re-render of the
    // local panel (which displays "(none)") and a re-claim attempt for the
    // case where a prior owner released ownership while we were idle.
    context.subscriptions.push(
      sessionManager.onDidChangeSelection(() => {
        mcpSocketServer.refreshSidecar();
        mcpTreeProvider.refresh();
        void tryClaimMcpOwnership();
      }),
    );
    void tryClaimMcpOwnership();

    context.subscriptions.push(
      vscode.commands.registerCommand('gemstone.claimMcpServer', async () => {
        if (mcpSocketServer.isOwner) {
          vscode.window.showInformationMessage('This window already owns the MCP server.');
          return;
        }
        await tryClaimMcpOwnership();
        if (!mcpSocketServer.isOwner) {
          vscode.window.showWarningMessage(
            'Could not claim the MCP server — another Jasper window still owns it. ' +
            'Close or disable Jasper in that window, then try again.',
          );
        }
      }),
      vscode.commands.registerCommand('gemstone.copyMcpUrl', async () => {
        if (!httpStarted || !httpServer) {
          vscode.window.showWarningMessage(`Jasper MCP HTTPS surface is not running on port ${httpPort}. Check the GemStone Admin output channel for the reason.`);
          return;
        }
        await vscode.env.clipboard.writeText(httpServer.url);
        vscode.window.showInformationMessage(`Copied MCP URL: ${httpServer.url}`);
      }),
      vscode.commands.registerCommand('gemstone.copyMcpSocketPath', async (socketPath?: string) => {
        if (!socketPath) {
          vscode.window.showWarningMessage('No MCP socket path available.');
          return;
        }
        await vscode.env.clipboard.writeText(socketPath);
        vscode.window.showInformationMessage(`Copied MCP socket path: ${socketPath}`);
      }),
      vscode.commands.registerCommand('gemstone.installMcpTlsCertificate', async () => {
        if (!certPathForTrust) {
          vscode.window.showWarningMessage('MCP TLS certificate has not been generated yet. Wait for extension activation to complete and try again.');
          return;
        }
        const cmd = trustCertCommand(certPathForTrust);
        const choice = await vscode.window.showInformationMessage(
          `Install the MCP TLS certificate into your system trust store so Claude clients accept https://127.0.0.1:${httpPort}/sse?\n\nCommand to run: ${cmd}`,
          { modal: true },
          'Run in Terminal',
          'Copy Command',
          'Show Cert Path',
        );
        if (choice === 'Run in Terminal') {
          const terminal = vscode.window.createTerminal({ name: 'Install MCP TLS Cert' });
          terminal.show();
          terminal.sendText(cmd);
        } else if (choice === 'Copy Command') {
          await vscode.env.clipboard.writeText(cmd);
          vscode.window.showInformationMessage('Command copied to clipboard.');
        } else if (choice === 'Show Cert Path') {
          await vscode.env.clipboard.writeText(certPathForTrust);
          vscode.window.showInformationMessage(`Cert path copied: ${certPathForTrust}`);
        }
      }),
    );

    context.subscriptions.push({
      dispose: () => {
        void mcpSocketServer.dispose();
        if (httpServer) void httpServer.dispose();
      },
    });
  }
  const versionManager = new VersionManager(sysadminStorage);
  const databaseManager = new DatabaseManager(sysadminStorage, processManager);

  // OS Configuration (macOS, Linux, and Windows)
  if (process.platform === 'darwin' || process.platform === 'linux' || isWindows()) {
    const osConfigProvider = new OsConfigTreeProvider();
    context.subscriptions.push(
      vscode.window.createTreeView('gemstoneSharedMemory', {
        treeDataProvider: osConfigProvider,
      })
    );
    osConfigProvider.registerCommands(context);
  }

  // Versions
  const versionProvider = new VersionTreeProvider(versionManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneVersions', {
      treeDataProvider: versionProvider,
    })
  );

  // Databases
  const databaseProvider = new DatabaseTreeProvider(sysadminStorage, processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneDatabases', {
      treeDataProvider: databaseProvider,
      showCollapseAll: true,
    })
  );

  // Processes
  const processProvider = new ProcessTreeProvider(processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneProcesses', {
      treeDataProvider: processProvider,
    })
  );

  // Rowan: tracked repositories (registry persists in globalState — stones are
  // disposable, the registry isn't) + package-manager operations.
  const rowanRegistry = new RowanRepoRegistry(context.globalState);
  const rowanProvider = new RowanTreeProvider(rowanRegistry, {
    getSession: () => sessionManager.getSelectedSession() ?? null,
  });
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneRowan', {
      treeDataProvider: rowanProvider,
    }),
    // Git-view-style M/A/D badges + label tinting for Rowan rows.
    vscode.window.registerFileDecorationProvider(new RowanDecorationProvider()),
    // Loaded-projects section tracks the connected stone.
    sessionManager.onDidChangeSelection(() => rowanProvider.refresh()),

    vscode.commands.registerCommand('gemstone.rowanRefreshView', () => {
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanAddRepo', async () => {
      const source = await vscode.window.showQuickPick(
        [
          { label: '$(repo-clone) Clone from Git URL…', origin: 'git' as const },
          { label: '$(folder) Add local folder…', origin: 'folder' as const },
        ],
        { placeHolder: 'How should the Rowan repository be added?' },
      );
      if (!source) return;

      let repoPath: string;
      let gitUrl: string | undefined;
      if (source.origin === 'git') {
        const raw = (await vscode.window.showInputBox({
          prompt: 'Git repository URL of the Rowan project',
          placeHolder: 'https://github.com/owner/repo.git',
          ignoreFocusOut: true,
          validateInput: validateRowanGitUrl,
        }))?.trim();
        if (!raw) return;
        const url = normalizeGitUrl(raw);
        // Clone into the open workspace folder.
        const dest = rowanWorkspaceDest(deriveRepoName(url));
        if (!dest) return;
        if (!fs.existsSync(dest)) {
          try {
            await vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `Cloning ${url}…`, cancellable: false },
              () => cloneGitRepo(url, dest),
            );
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`git clone failed: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
        }
        repoPath = dest;
        gitUrl = url;
      } else {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
          openLabel: 'Add Repository', title: 'Select a Rowan project directory',
        });
        if (!folder || folder.length === 0) return;
        const src = folder[0].fsPath;
        if (isInsideWorkspace(src)) {
          // Already in the workspace — track it in place.
          repoPath = src;
        } else {
          // FOR NOW, copy it into the workspace too (so it's visible/editable
          // there, like git clones). TODO: make this configurable.
          const dest = rowanWorkspaceDest(path.basename(src));
          if (!dest) return;
          if (!fs.existsSync(dest)) {
            try {
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: `Copying ${path.basename(src)} into the workspace…`,
                  cancellable: false,
                },
                async () => {
                  fs.cpSync(src, dest, { recursive: true });
                },
              );
            } catch (e: unknown) {
              vscode.window.showErrorMessage(
                `Could not copy the folder into the workspace: ${e instanceof Error ? e.message : String(e)}`,
              );
              return;
            }
          }
          repoPath = dest;
        }
      }

      if (findRowanLoadSpecs(repoPath).length === 0) {
        vscode.window.showWarningMessage(
          `No Rowan load specification (.ston) found under ${repoPath} — tracking it anyway.`,
        );
      }
      await rowanRegistry.add({ name: path.basename(repoPath), path: repoPath, gitUrl });
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanRemoveRepo', async (item?: RowanRepoItem) => {
      if (!item) return;
      await rowanRegistry.remove(item.repo.path);
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanExportProject', async (item?: RowanLoadedProjectItem) => {
      if (!item) return;
      const session = sessionManager.getSelectedSession();
      if (!session) return;
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: 'Export Here',
        title: `Export a copy of "${item.project.name}" to…`,
      });
      if (!folder || folder.length === 0) return;
      const result = queries.exportRowanProject(session, item.project.name, folder[0].fsPath);
      if (!result.success) {
        vscode.window.showErrorMessage(`Export of "${item.project.name}" failed: ${result.detail}`);
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `Exported "${item.project.name}" to ${result.detail}.`, 'Reveal',
      );
      if (choice === 'Reveal') {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.detail));
      }
    }),

    vscode.commands.registerCommand('gemstone.rowanOpenProjectDiff', async (item?: RowanChangesProjectItem | RowanLoadedProjectItem) => {
      if (!item) return;
      const session = sessionManager.getSelectedSession();
      if (!session) return;
      const projectName = item instanceof RowanChangesProjectItem ? item.projectName : item.project.name;
      const diff = queries.diffRowanProject(session, projectName);
      if (!diff.ok) {
        vscode.window.showErrorMessage(`Diff of "${projectName}" failed: ${diff.error}`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: queries.formatRowanDiff(projectName, diff),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('gemstone.rowanLoadRepo', async (item?: RowanRepoItem) => {
      if (!item) return;
      const session = await sessionManager.resolveSession();
      if (!session) return;
      await loadRowanFromDirectory(session, item.repo.path, sessionManager);
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanUpdateRepo', async (item?: RowanRepoItem) => {
      if (!item || !item.repo.gitUrl) return;
      let result: { updated: boolean };
      try {
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Updating ${item.repo.name}…`, cancellable: false },
          () => updateGitRepo(item.repo.path),
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Update of "${item.repo.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      // Re-read the checkout (a new gemstone.ston, spec, etc. may now be present)
      // so the row's state — and any cache warning — reflects the update.
      rowanProvider.refresh();
      vscode.window.showInformationMessage(
        result.updated
          ? `Updated "${item.repo.name}" to the latest from its remote.`
          : `"${item.repo.name}" is already up to date.`,
      );
    }),
  );

  // Refresh process state on initial load
  processManager.refreshProcesses();

  // Helper to refresh databases + processes together
  function refreshAdminViews() {
    processManager.refreshProcesses();
    databaseProvider.refresh();
    processProvider.refresh();
  }

  // ── Quick Setup ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.quickSetup', () =>
      runQuickSetup({
        sysadminStorage,
        versionManager,
        databaseManager,
        processManager,
        loginStorage: storage,
        refreshAdminViews,
        refreshVersions: () => versionProvider.loadVersions(),
        refreshLogins: () => treeProvider.refresh(),
      }),
    ),
  );

  // ── SysAdmin Commands ───────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.refreshVersions', async () => {
      if (isWindows()) {
        invalidateWslCache();
        const wslInfo = await getWslInfoAsync();
        vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', wslInfo.available);
      }
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.downloadVersion', async (item: VersionItem) => {
      const version = item.version;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading GemStone ${version.version}...`,
          cancellable: true,
        },
        async (progress, token) => {
          await versionManager.download(version, progress, token);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${version.version} downloaded.`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteDownload', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete download of GemStone ${item.version.version}?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteDownload(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.extractVersion', async (item: VersionItem) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Extracting GemStone ${item.version.version}...`,
        },
        async (progress) => {
          await versionManager.extract(item.version, progress);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${item.version.version} extracted.`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteExtracted', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete extracted GemStone ${item.version.version}? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteExtracted(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.registerLocalVersion', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select GemStone Product Directory',
      });
      if (!uris || uris.length === 0) return;
      const productPath = uris[0].fsPath;
      const info = SysadminStorage.readVersionTxt(productPath);
      if (!info) {
        vscode.window.showErrorMessage('No valid version.txt found in the selected directory.');
        return;
      }
      const suffix = sysadminStorage.getPlatformSuffix();
      const linkName = `GemStone64Bit${info.version}${suffix}`;
      const linkPath = path.join(sysadminStorage.getRootPath(), linkName);
      if (wslExistsSync(linkPath)) {
        vscode.window.showErrorMessage(`Version ${info.version} already exists in ${sysadminStorage.getRootPath()}.`);
        return;
      }
      sysadminStorage.ensureRootPath();
      wslSymlinkSync(productPath, linkPath);
      sysadminStorage.invalidateExtractedCache();
      appendSysadmin(`Registered local version: ${info.version} → ${productPath}`);
      vscode.window.showInformationMessage(`Registered local GemStone ${info.version} (${info.description || 'local build'}).`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.unregisterLocalVersion', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Unregister local GemStone ${item.version.version}? This only removes the symlink, not the product directory.`,
        { modal: true },
        'Unregister',
      );
      if (confirmed !== 'Unregister') return;
      await versionManager.deleteExtracted(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.openVersionFolder', (item: VersionItem) => {
      const gsPath = sysadminStorage.getGemstonePath(item.version.version);
      if (gsPath) {
        vscode.env.openExternal(vscode.Uri.file(gsPath));
      }
    }),

    vscode.commands.registerCommand('gemstone.openVersionTerminal', (item: VersionItem) => {
      try {
        processManager.openVersionTerminal(item.version.version);
      } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    }),

    vscode.commands.registerCommand('gemstone.downloadWindowsClient', async (item: VersionItem) => {
      const version = item.version.version;
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Installing Windows client ${version}...`,
            cancellable: true,
          },
          (progress, token) => versionManager.downloadAndExtractWindowsClient(version, progress, token),
        );
      } catch (e) {
        vscode.window.showErrorMessage(
          `Windows client install failed: ${e instanceof Error ? e.message : e}`,
        );
        versionProvider.loadVersions();
        return;
      }

      // Auto-register GCI library path
      const gciPath = sysadminStorage.getWindowsClientGciPath(version);
      if (gciPath) {
        await storage.setGciLibraryPath(version, gciPath);
      }
      versionProvider.loadVersions();
      vscode.window.showInformationMessage(
        `Windows client for GemStone ${version} is ready.${gciPath ? ' GCI library registered.' : ''}`,
      );
    }),

    vscode.commands.registerCommand('gemstone.openWindowsClientFolder', (item: VersionItem) => {
      const clientPath = sysadminStorage.getWindowsClientPath(item.version.version);
      if (clientPath) {
        vscode.env.openExternal(vscode.Uri.file(clientPath));
      }
    }),

    vscode.commands.registerCommand('gemstone.deleteWindowsClientExtracted', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete the Windows client distribution for GemStone ${item.version.version}?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteWindowsClientExtracted(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.createDatabase', async () => {
      const db = await databaseManager.createDatabase();
      if (db) {
        refreshAdminViews();
        vscode.window.showInformationMessage(`Database "${db.dirName}" created.`);
      }
    }),

    vscode.commands.registerCommand('gemstone.deleteDatabase', async (node: DatabaseNode) => {
      if (node?.kind !== 'database') return;
      const deleted = await databaseManager.deleteDatabase(node.db);
      if (deleted) {
        refreshAdminViews();
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshDatabases', () => {
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startStone', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      try {
        await processManager.startStone(node.db);
        vscode.window.showInformationMessage(`Stone "${node.db.config.stoneName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopStone', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      try {
        await processManager.stopStone(node.db);
        vscode.window.showInformationMessage(`Stone "${node.db.config.stoneName}" stopped.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startNetldi', async (node: DatabaseNode) => {
      if (node?.kind !== 'netldi') return;
      try {
        await processManager.startNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopNetldi', async (node: DatabaseNode) => {
      if (node?.kind !== 'netldi') return;
      try {
        await processManager.stopNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" stopped.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.openMcpInspector', () => {
      const port = vscode.workspace.getConfiguration('gemstone')
        .get<number>('mcp.httpPort', DEFAULT_MCP_HTTP_PORT);
      openMcpInspector(
        `https://127.0.0.1:${port}/sse`,
        inspectorTerminal,
        { extraCaCertPath: certPathForTrust },
      );
    }),

    vscode.commands.registerCommand('gemstone.openDbInFinder', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.db.path));
    }),

    vscode.commands.registerCommand('gemstone.openDbTerminal', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      processManager.openTerminal(node.db);
    }),

    vscode.commands.registerCommand('gemstone.createLoginFromDb', async (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      const db = node.db;
      const login = {
        label: '',
        version: db.config.version,
        gem_host: 'localhost',
        stone: db.config.stoneName,
        gs_user: 'DataCurator',
        gs_password: 'swordfish',
        netldi: db.config.ldiName,
        host_user: '',
        host_password: '',
      };
      // Auto-detect GCI library path
      // On Windows, the sysadmin install is Linux (in WSL) and only has .so files.
      // The Windows .dll must be provided separately via the login editor.
      if (!isWindows()) {
        const gsPath = sysadminStorage.getGemstonePath(db.config.version);
        if (gsPath) {
          const ext = process.platform === 'darwin' ? 'dylib' : 'so';
          const fs = await import('fs');
          const libPath = path.join(gsPath, 'lib', `libgcits-${db.config.version}-64.${ext}`);
          if (fs.existsSync(libPath)) {
            await storage.setGciLibraryPath(db.config.version, libPath);
          }
        }
      }
      LoginEditorPanel.show(storage, context.secrets, treeProvider, login, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.refreshProcesses', () => {
      processProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.deleteStaleLock', async (item: ProcessItem) => {
      if (!item || item.process.responding) return;
      const report = processManager.inspectStaleLock(item.process);
      if (!report.safe) {
        vscode.window.showWarningMessage(report.reason);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `${report.reason}\n\nDelete ${report.lockPath}?`,
        { modal: true },
        'Delete Lock',
      );
      if (confirm !== 'Delete Lock') return;
      if (processManager.deleteStaleLock(report.lockPath)) {
        vscode.window.showInformationMessage(`Removed stale lock for ${item.process.name}.`);
        processProvider.refresh();
      } else {
        vscode.window.showErrorMessage(`Failed to remove ${report.lockPath}. Check filesystem permissions.`);
      }
    }),

    vscode.commands.registerCommand('gemstone.copyNetldiHost', async (item: ProcessItem) => {
      // Only NetLDI items surface this command (package.json menu filter),
      // but guard anyway since commands can be invoked programmatically.
      if (!item || item.process.type !== 'netldi') return;
      const net = getWslNetworkInfoCached() ?? await refreshWslNetworkInfo();
      const host = net.netldiHost;
      if (!host) {
        vscode.window.showWarningMessage(
          'Could not determine a host for WSL — try running NetLDI and refreshing, or check WSL is reachable.',
        );
        return;
      }
      await vscode.env.clipboard.writeText(host);
      const portSuffix = item.process.port ? ` (port ${item.process.port})` : '';
      vscode.window.showInformationMessage(`Copied ${host}${portSuffix} to clipboard.`);
    }),

    vscode.commands.registerCommand('gemstone.replaceExtent', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      const replaced = await databaseManager.replaceExtent(node.db);
      if (replaced) {
        refreshAdminViews();
      }
    }),

    vscode.commands.registerCommand('gemstone.fullLogicalBackup', async (item?: GemStoneSessionItem) => {
      // A full backup runs over GCI against the connected stone, so it operates
      // on a specific session: the one clicked in the Sessions tree, or the
      // selected session when invoked from the palette.
      const session = item ? item.activeSession : sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showInformationMessage(
          'No GemStone session to back up. Connect a session first.',
        );
        return;
      }
      // Default the destination next to the extents when this session's stone is
      // one we manage locally; otherwise the picker opens without a default dir.
      const db = sysadminStorage.getDatabases()
        .find(d => d.config.stoneName === session.login.stone);
      const backedUp = await runLogicalBackup({
        execute: (label, code) => queries.executeFetchString(session, label, code),
        runBackup: (code) =>
          queries.executeFetchStringNb(session, 'gemstone.fullLogicalBackup', code, undefined, true),
        stoneName: session.login.stone,
        dbPath: db?.path,
      });
      // Re-read the Databases tree so the new backup (and the Backups node, if
      // this was the first one) shows up without a manual refresh.
      if (backedUp) refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.fullLogicalRestore',
      async (item?: GemStoneSessionItem | DatabaseNode) => {
        // Two entry points: the Sessions view button (a GemStoneSessionItem) and
        // a right-click on a backup-file node in the Databases tree. Either way we
        // need a LIVE session (for credentials to re-login through the restore's
        // stop/start cycle) and a locally-managed database (the restore must run
        // on the stone's own host).
        let session: ActiveSession | undefined;
        let backupFile: string | undefined;
        let db: GemStoneDatabase | undefined;

        if (item instanceof GemStoneSessionItem) {
          session = item.activeSession;
        } else if (item && 'kind' in item && item.kind === 'backupFile') {
          backupFile = item.filePath;
          db = item.db;
          session = sessionManager.getSessions()
            .find(s => s.login.stone === db!.config.stoneName);
          if (!session) {
            vscode.window.showWarningMessage(
              `A full logical restore runs over a live session (it needs your login to reconnect `
              + `through the stone restart). Log in to "${db.config.stoneName}" first, then try again.`,
              { modal: true },
            );
            return;
          }
        } else {
          session = sessionManager.getSelectedSession();
        }
        if (!session) {
          vscode.window.showInformationMessage(
            'No GemStone session to restore. Connect a session to the stone you want to restore first.',
          );
          return;
        }

        db = db ?? sysadminStorage.getDatabases()
          .find(d => d.config.stoneName === session!.login.stone);
        if (!db) {
          vscode.window.showErrorMessage(
            `Full logical restore currently requires a database created through Jasper's Databases `
            + `panel — it needs to stop/start the stone and locate its extent, which Jasper only `
            + `knows how to do for databases it manages. "${session.login.stone}" is not one of them `
            + '(it was created outside Jasper), so it cannot be restored this way yet.',
            { modal: true },
          );
          return;
        }

        // Capture what we need before the session is torn down. The GciLibrary
        // outlives its session's logout, so the transient restore logins reuse it.
        const harvested = session.login;
        const gci = session.gci;
        const sessionId = session.id;
        const managed = db;
        const dataDir = path.join(managed.path, 'data');
        const gsPath = sysadminStorage.getGemstonePath(managed.config.version);

        const toRestoreSession = (
          t: { session: ActiveSession; logout: () => void },
        ): RestoreSession => ({
          run: (label, code) => queries.executeFetchStringNb(t.session, label, code, undefined, true),
          logout: t.logout,
        });

        const restored = await runLogicalRestore({
          stoneName: managed.config.stoneName,
          dbPath: managed.path,
          backupFile,
          hasFileControl: () =>
            hasFileControlPrivilege((label, code) => queries.executeFetchString(session!, label, code)),
          closeCurrentSession: async () => { sessionManager.logout(sessionId); },
          stopStone: async () => {
            // GciTsLogout returns before the stone finishes deregistering our gem,
            // so stopstone (which logs in itself to request shutdown) can still see
            // our just-closed session and refuse with "Other users logged in" (exit
            // 13). Retry briefly to ride out that deregistration lag; a genuine
            // other-user situation simply fails after the retries with that message.
            let lastErr: unknown;
            for (let attempt = 0; attempt < 6; attempt++) {
              try {
                await processManager.stopStone(managed);
                return;
              } catch (e) {
                lastErr = e;
                await new Promise((resolve) => setTimeout(resolve, 1500));
              }
            }
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
          },
          startStone: async () => { await processManager.startStone(managed); },
          copyCurrentExtentAside: async (destPath) => {
            wslMkdirSync(path.dirname(destPath), { recursive: true });
            wslImportFileSync(path.join(dataDir, 'extent0.dbf'), destPath);
          },
          swapInFreshExtent: async () => {
            if (!gsPath) {
              throw new Error(
                `GemStone ${managed.config.version} installation not found; cannot obtain a fresh extent.`,
              );
            }
            const pristine = path.join(gsPath, 'bin', 'extent0.dbf');
            if (!wslExistsSync(pristine)) {
              throw new Error(`Fresh extent not found at ${pristine}.`);
            }
            for (const entry of wslReaddirSync(dataDir)) {
              if (entry.toLowerCase().endsWith('.dbf')) {
                wslUnlinkSync(path.join(dataDir, entry));
              }
            }
            const dest = path.join(dataDir, 'extent0.dbf');
            wslImportFileSync(pristine, dest);
            wslChmodSync(dest, 0o644);
          },
          loginAsDefaultAdmin: async () => toRestoreSession(
            sessionManager.loginTransient(
              { ...harvested, gs_user: 'DataCurator', gs_password: 'swordfish' }, gci,
            ),
          ),
          loginAsSessionUser: async () =>
            toRestoreSession(sessionManager.loginTransient(harvested, gci)),
        });

        if (restored) {
          // Best-effort: re-establish the user's normal interactive session (the
          // restored repo carries the real accounts again). If it fails, the
          // success toast already told the user to reconnect manually.
          const libraryPath = storage.getGciLibraryPath(harvested.version);
          if (libraryPath) {
            try {
              const s = sessionManager.login(harvested, libraryPath);
              refreshEnhancedInspectorAvailable(s);
            } catch { /* user reconnects manually */ }
          }
          refreshAdminViews();
        }
      }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  stopAllSeasideServers();
  if (fileInManager) {
    fileInManager.dispose();
  }
  if (exportManager) {
    exportManager.dispose();
  }
  if (sessionManager) {
    sessionManager.dispose();
  }
  if (!client) return undefined;
  return client.stop();
}

export async function openTextEditorOn(uri: vscode.Uri) {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {preview: false});
  } catch (error) {
    await logJasperError(`Failed to open text editor on ${uri.toString()}`, "Editor", error);
  }
}

export async function closeTextEditorOn(uri: vscode.Uri) {
  const uriString = uri.toString();
  await Promise.all(textEditorsOn(uriString).map(async tab => {
    try {
      await vscode.window.tabGroups.close(tab)
    } catch (error) {
      await logJasperError(`Failed to close text editor on ${uriString}`, "Editor", error);
    }
  }))
}

function textEditorsOn(uriString: string) {
  return vscode.window.tabGroups.all
      .flatMap(tabGroup => tabGroup.tabs.filter(tab => isTextEditorFor(tab, uriString)));
}

function isTextEditorFor(tab: vscode.Tab, uriString: string) {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriString;
}
