import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above module-level consts, so the spies and the
// mutable test state they read live in vi.hoisted() — which runs first and is
// visible both to the factories below and to the test bodies.
const mocks = vi.hoisted(() => {
  // A stateful config store so the prompt buttons can write the tri-state and
  // we can read it back, mirroring how VS Code persists configuration. The
  // user's click on each prompt is set per test via `state`.
  const state: { offerChoice?: string; refreshChoice?: string; config: Record<string, unknown> } = {
    offerChoice: undefined,
    refreshChoice: undefined,
    config: {},
  };
  const updateSpy = vi.fn((key: string, value: unknown) => {
    state.config[key] = value;
    return Promise.resolve();
  });
  const showInformationMessage = vi.fn((message: string) => {
    if (message.includes('Install enhanced inspector support')) return Promise.resolve(state.offerChoice);
    if (message.includes('Refresh this session')) return Promise.resolve(state.refreshChoice);
    return Promise.resolve(undefined);
  });
  // Controllable QuickPick for the auto-install picker. The factory stashes the
  // created instance on `quickPick.current` so a test can set `selectedItems`,
  // fire accept via `__accept()`, then close it via `hide()`.
  const quickPick: { current?: Record<string, unknown> } = {};
  const createQuickPick = vi.fn(() => {
    const acceptHandlers: Array<() => void | Promise<void>> = [];
    const hideHandlers: Array<() => void> = [];
    const qp: Record<string, unknown> = {
      title: '',
      placeholder: '',
      items: [] as unknown[],
      selectedItems: [] as unknown[],
      activeItems: [] as unknown[],
      enabled: true,
      busy: false,
      onDidAccept: vi.fn((h: () => void | Promise<void>) => {
        acceptHandlers.push(h);
        return { dispose: vi.fn() };
      }),
      onDidHide: vi.fn((h: () => void) => {
        hideHandlers.push(h);
        return { dispose: vi.fn() };
      }),
      show: vi.fn(),
      hide: vi.fn(() => hideHandlers.forEach((h) => h())),
      dispose: vi.fn(),
      __accept: async () => {
        for (const h of acceptHandlers) await h();
      },
    };
    quickPick.current = qp;
    return qp;
  });
  return {
    state,
    updateSpy,
    showInformationMessage,
    quickPick,
    createQuickPick,
    showInputBox: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(undefined)),
    showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
    executeCommand: vi.fn(() => Promise.resolve(undefined)),
    installSupport: vi.fn(() =>
      Promise.resolve({ success: true, committed: true, verified: true, filedIn: [], message: 'ok' }),
    ),
    // Probed for `System needsCommit` during the post-install refresh; default
    // 'false' = nothing pending (the freshly-logged-in case).
    executeFetchString: vi.fn(() => 'false'),
    // Controls whether the payload .gs files appear present on disk.
    existsSync: vi.fn(() => true),
  };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: unknown) => (key in mocks.state.config ? mocks.state.config[key] : def),
      update: mocks.updateSpy,
    }),
  },
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showInputBox: mocks.showInputBox,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
    createQuickPick: mocks.createQuickPick,
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
  },
  commands: { executeCommand: mocks.executeCommand },
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { Notification: 15 },
}));

vi.mock('fs', () => ({ existsSync: mocks.existsSync }));

vi.mock('../browserQueries', () => ({
  executeFetchString: mocks.executeFetchString,
  checkGtAvailable: vi.fn(() => true),
}));

vi.mock('../enhancedInspectorInstall', () => ({
  installEnhancedInspectorSupport: mocks.installSupport,
  isEnhancedInspectorInstalled: vi.fn(() => false),
  ENHANCED_INSPECTOR_FILES: ['Announcements.gs'],
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { ActiveSession } from '../sessionManager';
import {
  maybeOfferEnhancedInspectorInstall,
  configureEnhancedInspectorAutoInstall,
  runInstallEnhancedInspector,
} from '../enhancedInspectorCommand';

const AUTO_INSTALL_KEY = 'enhancedInspector.autoInstall';

function createBaseSession(systemUserLoginSucceeds = true): ActiveSession {
  return {
    id: 1,
    login: { stone: 'demo', gem_host: 'localhost', netldi: 'netldi' },
    gci: {
      GciTsLogin: vi.fn(() =>
        systemUserLoginSucceeds
          ? { session: {}, err: { number: 0 } }
          : { session: null, err: { number: 4051, message: 'bad password' } },
      ),
      GciTsLogout: vi.fn(),
    },
    stoneVersion: '3.7.0',
    gtAvailable: false,
  } as unknown as ActiveSession;
}

// sessionManager.abort returns { success, err } (and throws for an unknown id);
// the post-install refresh reads `.success`, so the mock mirrors that shape.
const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
const getSelectedSessionMock = vi.fn<() => ActiveSession | undefined>();
const sessionManager = {
  abort: abortMock,
  getSelectedSession: getSelectedSessionMock,
} as unknown as Parameters<typeof maybeOfferEnhancedInspectorInstall>[1];

const EXTENSION_PATH = '/ext';

function offer(base: ActiveSession): Promise<void> {
  return maybeOfferEnhancedInspectorInstall(base, sessionManager, EXTENSION_PATH);
}

function wasOffered(): boolean {
  return mocks.showInformationMessage.mock.calls.some((c) =>
    String(c[0]).includes('Install enhanced inspector support'),
  );
}

function wasRefreshPrompted(): boolean {
  return mocks.showInformationMessage.mock.calls.some((c) =>
    String(c[0]).includes('Refresh this session'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.config = {};
  mocks.state.offerChoice = undefined;
  mocks.state.refreshChoice = undefined;
  // clearAllMocks leaves implementations and once-queues in place, so reset the
  // mocks whose per-test overrides would otherwise leak into later tests.
  mocks.existsSync.mockReturnValue(true);
  mocks.showInputBox.mockReset();
  mocks.showInputBox.mockResolvedValue(undefined);
  getSelectedSessionMock.mockReset();
});

describe('maybeOfferEnhancedInspectorInstall', () => {
  it('does nothing when the setting is "never"', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'never';

    await offer(createBaseSession());

    expect(wasOffered()).toBe(false);
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('installs without prompting when the setting is "always"', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'always';

    await offer(createBaseSession());

    expect(wasOffered()).toBe(false);
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('warns without prompting for a password when "always" cannot reach SystemUser', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'always';

    await offer(createBaseSession(false));

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('offers a prompt when the setting is "ask"', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';

    await offer(createBaseSession());

    expect(wasOffered()).toBe(true);
  });

  it('persists "never" and skips installing when the user declines for good', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Never';

    await offer(createBaseSession());

    expect(mocks.updateSpy).toHaveBeenCalledWith(AUTO_INSTALL_KEY, 'never', 1);
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('persists "always" and installs when the user opts in for good', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Always';

    await offer(createBaseSession());

    expect(mocks.updateSpy).toHaveBeenCalledWith(AUTO_INSTALL_KEY, 'always', 1);
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('installs once without changing the setting when the user installs this time', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';

    await offer(createBaseSession());

    expect(mocks.updateSpy).not.toHaveBeenCalled();
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the user dismisses the offer', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = undefined;

    await offer(createBaseSession());

    expect(mocks.updateSpy).not.toHaveBeenCalled();
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('refreshes silently and re-latches gtAvailable when nothing is pending', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    const base = createBaseSession();

    await offer(base);

    expect(wasRefreshPrompted()).toBe(false);
    expect(sessionManager.abort).toHaveBeenCalledWith(base.id);
    expect(base.gtAvailable).toBe(true);
    expect(mocks.executeCommand).toHaveBeenCalledWith('setContext', 'gemstone.gtAvailable', true);
  });

  it('prompts before discarding uncommitted changes, then refreshes on confirm', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    mocks.state.refreshChoice = 'Refresh';
    mocks.executeFetchString.mockReturnValueOnce('true');
    const base = createBaseSession();

    await offer(base);

    expect(wasRefreshPrompted()).toBe(true);
    expect(sessionManager.abort).toHaveBeenCalledWith(base.id);
    expect(base.gtAvailable).toBe(true);
  });

  it('leaves the session untouched when the user declines the discard prompt', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    mocks.state.refreshChoice = 'Later';
    mocks.executeFetchString.mockReturnValueOnce('true');
    const base = createBaseSession();

    await offer(base);

    expect(wasRefreshPrompted()).toBe(true);
    expect(abortMock).not.toHaveBeenCalled();
    expect(base.gtAvailable).toBe(false);
  });

  it('prompts instead of refreshing silently when it cannot tell if work is pending', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    mocks.state.refreshChoice = 'Later';
    mocks.executeFetchString.mockImplementationOnce(() => {
      throw new Error('session busy');
    });
    const base = createBaseSession();

    await offer(base);

    expect(wasRefreshPrompted()).toBe(true);
    expect(abortMock).not.toHaveBeenCalled();
  });

  it('does not crash when the working session was logged out during install', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    abortMock.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    const base = createBaseSession();

    await expect(offer(base)).resolves.toBeUndefined();

    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(base.gtAvailable).toBe(false);
  });

  it('does not mark support available when the refresh abort reports failure', async () => {
    mocks.state.config[AUTO_INSTALL_KEY] = 'ask';
    mocks.state.offerChoice = 'Install';
    abortMock.mockReturnValueOnce({ success: false, err: { number: 1 } });
    const base = createBaseSession();

    await offer(base);

    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(base.gtAvailable).toBe(false);
  });
});

describe('configureEnhancedInspectorAutoInstall', () => {
  // Accessor for the QuickPick the command creates, typed loosely so tests can
  // drive its selection and lifecycle.
  type Picker = Record<string, unknown> & {
    title: string;
    items: Array<{ mode: string; label: string }>;
    selectedItems: unknown[];
    hide: () => void;
    __accept: () => Promise<void>;
  };
  const picker = () => mocks.quickPick.current as unknown as Picker;

  it('records the chosen mode and confirms it in the picker before closing', async () => {
    vi.useFakeTimers();
    const done = configureEnhancedInspectorAutoInstall();
    const qp = picker();
    qp.selectedItems = [{ mode: 'always', label: 'Always install' }];
    await qp.__accept();

    expect(mocks.updateSpy).toHaveBeenCalledWith(AUTO_INSTALL_KEY, 'always', 1);
    expect(qp.title).toContain('Always install');
    expect(qp.items.find((i) => i.mode === 'always')?.label).toContain('$(check)');
    expect((qp.activeItems as Array<{ mode: string }>)[0]?.mode).toBe('always');

    vi.advanceTimersByTime(900);
    await done;
    vi.useRealTimers();
  });

  it('does not rewrite the setting when the current mode is re-selected', async () => {
    vi.useFakeTimers();
    mocks.state.config[AUTO_INSTALL_KEY] = 'never';
    const done = configureEnhancedInspectorAutoInstall();
    const qp = picker();
    qp.selectedItems = [{ mode: 'never', label: 'Never' }];
    await qp.__accept();

    expect(mocks.updateSpy).not.toHaveBeenCalled();
    expect(qp.title).toContain('Never');

    vi.advanceTimersByTime(900);
    await done;
    vi.useRealTimers();
  });

  it('leaves the setting unchanged when the picker is dismissed', async () => {
    const done = configureEnhancedInspectorAutoInstall();
    const qp = picker();

    qp.hide();
    await done;

    expect(mocks.updateSpy).not.toHaveBeenCalled();
  });

  it('surfaces an error and closes when saving the setting fails', async () => {
    mocks.updateSpy.mockImplementationOnce(() => Promise.reject(new Error('settings are read-only')));
    const done = configureEnhancedInspectorAutoInstall();
    const qp = picker();
    qp.selectedItems = [{ mode: 'always', label: 'Always install' }];
    await qp.__accept();

    expect(mocks.showErrorMessage).toHaveBeenCalled();
    await done;
  });
});

describe('runInstallEnhancedInspector', () => {
  const run = () => runInstallEnhancedInspector(sessionManager, EXTENSION_PATH);

  // Second GciTsLogin call (the prompted password) succeeds; the first (the
  // default password) uses whatever createBaseSession(false) returns.
  function succeedOnPromptedLogin(base: ActiveSession): void {
    (base.gci.GciTsLogin as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ session: null, err: { number: 4051, message: 'bad password' } })
      .mockReturnValueOnce({ session: {}, err: { number: 0 } });
  }

  it('reports an error and installs nothing when no session is selected', async () => {
    getSelectedSessionMock.mockReturnValue(undefined);

    await run();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      'No active GemStone session — connect to a stone first.',
    );
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('installs into the selected session without prompting when the default password works', async () => {
    getSelectedSessionMock.mockReturnValue(createBaseSession());

    await run();

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('prompts for the SystemUser password when the default is rejected, then installs', async () => {
    const base = createBaseSession(false);
    succeedOnPromptedLogin(base);
    getSelectedSessionMock.mockReturnValue(base);
    mocks.showInputBox.mockResolvedValueOnce('the real password');

    await run();

    expect(mocks.showInputBox).toHaveBeenCalledTimes(1);
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('reports an error and installs nothing when the prompted password is also rejected', async () => {
    getSelectedSessionMock.mockReturnValue(createBaseSession(false));
    mocks.showInputBox.mockResolvedValueOnce('still wrong');

    await run();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Could not log in as SystemUser'),
    );
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });

  it('does nothing when the user cancels the SystemUser password prompt', async () => {
    getSelectedSessionMock.mockReturnValue(createBaseSession(false));
    mocks.showInputBox.mockResolvedValueOnce(undefined);

    await run();

    expect(mocks.installSupport).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a clear error and never logs in when the payload files are missing', async () => {
    mocks.existsSync.mockReturnValue(false);
    const base = createBaseSession();
    getSelectedSessionMock.mockReturnValue(base);

    await run();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('payload not found'),
    );
    expect(base.gci.GciTsLogin).not.toHaveBeenCalled();
    expect(mocks.installSupport).not.toHaveBeenCalled();
  });
});
