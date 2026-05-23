import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import {
  promptClaudeCodeRefresh,
  RefreshPromptDeps,
  __test,
} from '../claudeCodeRefreshPrompt';

function makeDeps(
  overrides: {
    initialSuppressed?: boolean;
    choice?: string;
  } = {},
): RefreshPromptDeps & {
  store: { suppressed: boolean };
  showInformationMessage: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
} {
  const store = { suppressed: overrides.initialSuppressed ?? false };
  const showInformationMessage = vi.fn(async () => overrides.choice);
  const executeCommand = vi.fn(async () => undefined);
  return {
    store,
    getSuppressed: () => store.suppressed,
    setSuppressed: async (value) => {
      store.suppressed = value;
    },
    showInformationMessage,
    executeCommand,
  };
}

describe('promptClaudeCodeRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "suppressed" and skips the prompt when the memento is set', async () => {
    const deps = makeDeps({ initialSuppressed: true });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('suppressed');
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('shows the prompt with "Reload Window" and "Don\'t show again" actions', async () => {
    const deps = makeDeps();
    await promptClaudeCodeRefresh(deps);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    const [message, ...actions] = deps.showInformationMessage.mock.calls[0];
    expect(message).toBe(__test.PROMPT_MESSAGE);
    expect(message).toMatch(/registered the gemstone MCP server/);
    expect(message).toMatch(/Reload the window/);
    expect(message).toMatch(/future launches/);
    expect(actions).toEqual([__test.RELOAD_WINDOW, __test.DONT_SHOW_AGAIN]);
  });

  it('executes the reload command and returns "reloaded" when user clicks "Reload Window"', async () => {
    const deps = makeDeps({ choice: __test.RELOAD_WINDOW });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('reloaded');
    expect(deps.executeCommand).toHaveBeenCalledWith(__test.RELOAD_COMMAND);
    expect(deps.store.suppressed).toBe(false);
  });

  it('persists suppression and returns "acknowledged" when user clicks "Don\'t show again"', async () => {
    const deps = makeDeps({ choice: __test.DONT_SHOW_AGAIN });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('acknowledged');
    expect(deps.store.suppressed).toBe(true);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('returns "dismissed" without persisting or reloading when the user dismisses the prompt', async () => {
    const deps = makeDeps({ choice: undefined });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('dismissed');
    expect(deps.store.suppressed).toBe(false);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('re-prompts on a later call when the user previously dismissed without acknowledging', async () => {
    const deps = makeDeps({ choice: undefined });
    await promptClaudeCodeRefresh(deps);
    await promptClaudeCodeRefresh(deps);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(2);
  });
});
