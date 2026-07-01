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
  return {
    state,
    updateSpy,
    showInformationMessage,
    showInputBox: vi.fn(() => Promise.resolve(undefined)),
    showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
    executeCommand: vi.fn(() => Promise.resolve(undefined)),
    installSupport: vi.fn(() =>
      Promise.resolve({ success: true, committed: true, verified: true, filedIn: [], message: 'ok' }),
    ),
    // Probed for `System needsCommit` during the post-install refresh; default
    // 'false' = nothing pending (the freshly-logged-in case).
    executeFetchString: vi.fn(() => 'false'),
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
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
  },
  commands: { executeCommand: mocks.executeCommand },
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { Notification: 15 },
}));

vi.mock('fs', () => ({ existsSync: () => true }));

vi.mock('../browserQueries', () => ({
  executeFetchString: mocks.executeFetchString,
  checkGtAvailable: vi.fn(() => true),
}));

vi.mock('../enhancedInspectorInstall', () => ({
  installEnhancedInspectorSupport: mocks.installSupport,
  isEnhancedInspectorInstalled: vi.fn(() => false),
  ENHANCED_INSPECTOR_FILES: ['Announcements.gs'],
}));

import { ActiveSession } from '../sessionManager';
import { maybeOfferEnhancedInspectorInstall } from '../enhancedInspectorCommand';

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
const sessionManager = { abort: abortMock } as unknown as Parameters<
  typeof maybeOfferEnhancedInspectorInstall
>[1];

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
