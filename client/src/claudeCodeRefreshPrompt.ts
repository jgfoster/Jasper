import * as vscode from 'vscode';

// Claude Code reads `~/.claude.json` once at extension activation, so the
// Claude Code session already running in this window snapshotted its MCP
// server list before Jasper wrote the jasper entry. Reloading the window
// re-activates Claude Code against the now-current config; future VSCode
// launches don't need this dance because the entry will already be in place
// at startup. We offer the reload as a one-click action and a "Don't show
// again" escape for users who'd rather handle it themselves.
const SUPPRESS_KEY = 'jasper.mcp.claudeCodeRefreshPrompt.suppressed';
// Pre-rename suppression key. Honored (read-only) so users who already opted
// out before the `gemstone` → `jasper` rename aren't nagged again.
const LEGACY_SUPPRESS_KEY = 'gemstone.mcp.claudeCodeRefreshPrompt.suppressed';
const RELOAD_WINDOW = 'Reload Window';
const DONT_SHOW_AGAIN = "Don't show again";
const RELOAD_COMMAND = 'workbench.action.reloadWindow';

const PROMPT_MESSAGE =
  'Jasper registered the jasper MCP server with Claude Code. ' +
  'Reload the window once so Claude Code picks it up — future launches ' +
  'will see it automatically.';

export interface RefreshPromptDeps {
  getSuppressed: () => boolean;
  setSuppressed: (value: boolean) => Thenable<void>;
  showInformationMessage: (
    message: string,
    ...items: string[]
  ) => Thenable<string | undefined>;
  executeCommand: (command: string) => Thenable<unknown>;
}

export type RefreshPromptResult =
  | 'suppressed'
  | 'dismissed'
  | 'acknowledged'
  | 'reloaded';

export async function promptClaudeCodeRefresh(
  deps: RefreshPromptDeps,
): Promise<RefreshPromptResult> {
  if (deps.getSuppressed()) return 'suppressed';
  const choice = await deps.showInformationMessage(
    PROMPT_MESSAGE,
    RELOAD_WINDOW,
    DONT_SHOW_AGAIN,
  );
  if (choice === RELOAD_WINDOW) {
    await deps.executeCommand(RELOAD_COMMAND);
    return 'reloaded';
  }
  if (choice === DONT_SHOW_AGAIN) {
    await deps.setSuppressed(true);
    return 'acknowledged';
  }
  return 'dismissed';
}

export function buildRefreshPromptDeps(
  context: vscode.ExtensionContext,
): RefreshPromptDeps {
  return {
    getSuppressed: () =>
      context.globalState.get<boolean>(SUPPRESS_KEY, false) ||
      context.globalState.get<boolean>(LEGACY_SUPPRESS_KEY, false),
    setSuppressed: (value) => context.globalState.update(SUPPRESS_KEY, value),
    showInformationMessage: (message, ...items) =>
      vscode.window.showInformationMessage(message, ...items),
    executeCommand: (command) => vscode.commands.executeCommand(command),
  };
}

export const __test = {
  SUPPRESS_KEY,
  RELOAD_WINDOW,
  DONT_SHOW_AGAIN,
  RELOAD_COMMAND,
  PROMPT_MESSAGE,
};
