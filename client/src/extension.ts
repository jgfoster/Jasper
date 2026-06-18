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
import { GemStoneLogin, loginLabel, sameLoginTarget } from './loginTypes';
import { LoginEditorPanel } from './loginEditorPanel';
import { SessionManager } from './sessionManager';
import {
  gtPerfTracker,
  buildGtPerfStatusBarText,
  buildGtPerfClipboardText,
  buildGtPerfQuickPickItems,
  RESET_LABEL,
  COPY_LABEL,
} from './gtPerfTracker';
import { CodeExecutor } from './codeExecutor';
import { SystemBrowser } from './systemBrowser';
import { GlobalsBrowser } from './globalsBrowser';
import { GtInspector } from './gtInspector';
import { GemStoneFileSystemProvider, MethodCompiledEvent } from './gemstoneFileSystemProvider';
import { openWorkspace } from './workspace';
import { GemStoneDebugSession } from './gemstoneDebugSession';
import { InspectorTreeProvider, InspectorNode } from './inspectorTreeProvider';
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
import { showTranscript } from './transcriptChannel';
import { GemStoneCodeLensProvider } from './gemstoneCodeLensProvider';
import * as queries from './browserQueries';
import { SysadminStorage } from './sysadminStorage';
import { appendSysadmin } from './sysadminChannel';
import { VersionManager } from './versionManager';
import { VersionTreeProvider, VersionItem } from './versionTreeProvider';
import { DatabaseManager } from './databaseManager';
import { DatabaseTreeProvider, DatabaseNode } from './databaseTreeProvider';
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
import { wslExistsSync, wslSymlinkSync } from './wslFs';
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

export async function handleMethodCompiled(event: MethodCompiledEvent) {
  if (event.uri.toString() === event.previousUri.toString()) {
    return;
  }
  
  await openTextEditorOn(event.uri);
  
  if (event.isNewMethod) {
    await closeTextEditorOn(event.previousUri);
  }
}

export function activate(context: vscode.ExtensionContext) {
  jasperChannel = vscode.window.createOutputChannel('Jasper');
  context.subscriptions.push(jasperChannel);

  initializeBundledGci(context.extensionPath);

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
  vscode.commands.executeCommand('setContext', 'gemstone.gtAvailable', false);
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
  SystemBrowser.setExportManager(exportManager);
  fileInManager = new FileInManager(sessionManager, exportManager);
  fileInManager.register(context);

  // ── Object Inspector ──────────────────────────────────────
  const inspectorProvider = new InspectorTreeProvider(sessionManager);

  const inspectorView = vscode.window.createTreeView('gemstoneInspector', {
    treeDataProvider: inspectorProvider,
    showCollapseAll: true,
  });
  inspectorProvider.setView(inspectorView);
  context.subscriptions.push(inspectorView, inspectorProvider);

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
            }
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    gemstoneFs.onMethodCompiled(handleMethodCompiled)
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
    sessionManager.onDidChangeSelection(id => {
      const s = id !== null ? sessionManager.getSession(id) : undefined;
      vscode.commands.executeCommand('setContext', 'gemstone.gtAvailable', s?.gtAvailable ?? false);
    }),
  );
  updateStatusBar();

  // ── GT Perf Tracking ───────────────────────────────────
  const gtPerfChannel = vscode.window.createOutputChannel('GemStone GT Perf');
  context.subscriptions.push(gtPerfChannel);

  const gtPerfCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  gtPerfCountItem.tooltip = 'GT Perf: click to see breakdown';
  gtPerfCountItem.command = 'gemstone.showGtPerfDetails';
  context.subscriptions.push(gtPerfCountItem);

  const gtPerfResetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  gtPerfResetItem.text = '$(debug-restart)';
  gtPerfResetItem.tooltip = 'Reset GT Perf Counter';
  gtPerfResetItem.command = 'gemstone.resetGtPerfCounter';
  context.subscriptions.push(gtPerfResetItem);

  function updateGtPerfStatusBar() {
    if (gtPerfTracker.enabled) {
      gtPerfCountItem.text = buildGtPerfStatusBarText(gtPerfTracker.count);
      gtPerfCountItem.show();
      gtPerfResetItem.show();
    } else {
      gtPerfCountItem.hide();
      gtPerfResetItem.hide();
    }
  }

  gtPerfTracker.onCountChanged = updateGtPerfStatusBar;

  const applyGtPerfSetting = () => {
    const enabled = vscode.workspace.getConfiguration('gemstone').get<boolean>('gtPerfTracking', false);
    gtPerfTracker.setEnabled(enabled);
    vscode.commands.executeCommand('setContext', 'gemstone.gtPerfTracking', enabled);
    updateGtPerfStatusBar();
  };
  applyGtPerfSetting();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gemstone.gtPerfTracking')) {
        applyGtPerfSetting();
      }
    }),
    vscode.commands.registerCommand('gemstone.enableGtPerfTracking', async () => {
      await vscode.workspace.getConfiguration('gemstone').update('gtPerfTracking', true, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.disableGtPerfTracking', async () => {
      await vscode.workspace.getConfiguration('gemstone').update('gtPerfTracking', false, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.resetGtPerfCounter', () => {
      const sorted = [...gtPerfTracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
      gtPerfChannel.appendLine(`[reset] ${gtPerfTracker.count} total GCI calls`);
      for (const [method, count] of sorted) {
        gtPerfChannel.appendLine(`  ${method}: ${count}`);
      }
      gtPerfTracker.reset();
    }),
    vscode.commands.registerCommand('gemstone.showGtPerfDetails', async () => {
      const clipboardText = buildGtPerfClipboardText(gtPerfTracker);
      const items: vscode.QuickPickItem[] = buildGtPerfQuickPickItems(gtPerfTracker).map(item =>
        item.isSeparator
          ? { label: '', kind: vscode.QuickPickItemKind.Separator }
          : { label: item.label, description: item.description }
      );
      const selected = await vscode.window.showQuickPick(items, {
        title: `GT Perf: ${gtPerfTracker.count} total GCI calls`,
        placeHolder: 'Choose an action, or press Escape to dismiss',
      });
      if (selected?.label === RESET_LABEL) {
        vscode.commands.executeCommand('gemstone.resetGtPerfCounter');
      } else if (selected?.label === COPY_LABEL) {
        await vscode.env.clipboard.writeText(clipboardText);
        vscode.window.showInformationMessage('GT Perf breakdown copied to clipboard.');
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
      if (loginHasActiveSession(item.login)) {
        vscode.window.showWarningMessage(
          `"${loginLabel(item.login)}" has an active session. Log out before editing it.`,
        );
        return;
      }
      LoginEditorPanel.show(storage, context.secrets, treeProvider, item.login, sysadminStorage);
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

    vscode.commands.registerCommand('gemstone.login', async (item: GemStoneLoginItem) => {
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
        session = sessionManager.login(login, gciPath);
        session.gtAvailable = queries.checkGtAvailable(session);
        vscode.commands.executeCommand('setContext', 'gemstone.gtAvailable', session.gtAvailable);
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
      await openWorkspace();
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
      if (fileInManager.hasUnsavedChanges(item.activeSession)) {
        const choice = await vscode.window.showWarningMessage(
          'Exported .gs files have unsaved edits that will be overwritten.',
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

    vscode.commands.registerCommand('gemstone.sessionLogout', async (item?: GemStoneSessionItem) => {
      const session = item ? item.activeSession : sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showInformationMessage('No GemStone session to log out of.');
        return;
      }
      // Keep the class mirror on disk: it's keyed by connection target and is
      // re-synced incrementally on the next login, which is far cheaper than
      // rebuilding it from scratch (especially for large, remote images).
      SystemBrowser.disposeForSession(session.id);
      GlobalsBrowser.disposeForSession(session.id);
      GtInspector.disposeForSession(session.id);
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

    vscode.commands.registerCommand('gemstone.superInspectIt', () => {
      codeExecutor.superInspectIt();
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
      const existing = inspectorProvider.findRootByLabel(args.className);
      if (existing) {
        await inspectorView.reveal(existing, { select: true, focus: true });
        return;
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
        ? `${args.className}${side} >> #${args.selector} — superclass implementations`
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

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Searching methods for "${term}"...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.searchMethodSource(session, term, true)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Methods containing "${term}"`);
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

      if (!SystemBrowser.navigateToClass(session.id, picked.entry.dictName, picked.entry.className)) {
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(picked.entry.dictName)}` +
          `/${encodeURIComponent(picked.entry.className)}` +
          `/definition`
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
  );
}

export function deactivate(): Thenable<void> | undefined {
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
