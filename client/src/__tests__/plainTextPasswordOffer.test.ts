import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type * as vscode from 'vscode';
import { __resetConfig, __setConfig, window } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import { MOVE, offerToMovePlainTextPasswords } from '../plainTextPasswordOffer';
import { fakeSecretStorage } from './support/secretStorage';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, password_in_keychain: false, ...overrides };
}

function fakeMemento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

describe('offering to move plain-text passwords to the keychain', () => {
  let secrets: ReturnType<typeof fakeSecretStorage>;
  let storage: LoginStorage;
  let state: vscode.Memento;
  const refresh = vi.fn();

  beforeEach(() => {
    __resetConfig();
    vi.clearAllMocks();
    secrets = fakeSecretStorage();
    storage = new LoginStorage(secrets);
    state = fakeMemento();
  });

  it('moves the passwords when the button is clicked', async () => {
    __setConfig('gemstone', 'logins', [makeLogin()]);
    vi.mocked(window.showInformationMessage).mockResolvedValueOnce(MOVE);

    await offerToMovePlainTextPasswords(storage, state, refresh);

    expect(storage.getLogins()[0]).toMatchObject({ gs_password: '', password_in_keychain: true });
    expect(secrets.entries.size).toBe(1);
    expect(refresh).toHaveBeenCalled();
  });

  it('leaves the login alone when the toast is dismissed, and does not ask about it again', async () => {
    const plain = makeLogin();
    __setConfig('gemstone', 'logins', [plain]);

    await offerToMovePlainTextPasswords(storage, state, refresh);
    await offerToMovePlainTextPasswords(storage, state, refresh);

    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(storage.getLogins()).toEqual([plain]);
  });

  it('asks again when another login with a plain-text password appears', async () => {
    __setConfig('gemstone', 'logins', [makeLogin()]);
    await offerToMovePlainTextPasswords(storage, state, refresh);

    __setConfig('gemstone', 'logins', [makeLogin(), makeLogin({ stone: 'other' })]);
    await offerToMovePlainTextPasswords(storage, state, refresh);

    expect(window.showInformationMessage).toHaveBeenCalledTimes(2);
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      '2 GemStone logins keep their passwords as plain text in your VS Code settings.',
      MOVE,
    );
  });

  it('says nothing when no login keeps a password in plain text', async () => {
    __setConfig('gemstone', 'logins', [makeLogin({ gs_password: '', password_in_keychain: true })]);

    await offerToMovePlainTextPasswords(storage, state, refresh);

    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
