import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __configUpdates, __resetConfig, __setConfig, window } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { fakeSecretStorage } from './support/secretStorage';
import { GemStoneLogin, DEFAULT_LOGIN, loginLabel } from '../loginTypes';

// Plain text by default: most tests here are about the list, not the keychain.
function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, password_in_keychain: false, ...overrides };
}

const GS_KEY = 'jasper-gemstone-login:DataCurator@localhost/gs64stone';
const HOST_KEY = `${GS_KEY}#host`;

describe('LoginStorage', () => {
  let storage: LoginStorage;
  let secrets: ReturnType<typeof fakeSecretStorage>;

  beforeEach(() => {
    __resetConfig();
    vi.clearAllMocks();
    secrets = fakeSecretStorage();
    storage = new LoginStorage(secrets);
  });

  describe('getLogins', () => {
    it('returns empty array when no logins configured', () => {
      expect(storage.getLogins()).toEqual([]);
    });

    it('returns configured logins', () => {
      const logins = [makeLogin({ stone: 'stoneA' }), makeLogin({ stone: 'stoneB' })];
      __setConfig('gemstone', 'logins', logins);
      expect(storage.getLogins()).toEqual(logins);
    });
  });

  describe('saveLogin', () => {
    it('adds a new login to empty list', async () => {
      const login = makeLogin({ stone: 'mystone' });
      await storage.saveLogin(login);
      expect(storage.getLogins()).toEqual([login]);
    });

    it('adds a new login to existing list', async () => {
      const existing = makeLogin({ stone: 'stoneA' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ stone: 'stoneB' });
      await storage.saveLogin(newLogin);

      expect(storage.getLogins()).toEqual([existing, newLogin]);
    });

    it('updates an existing login by matching generated label', async () => {
      const login = makeLogin({ stone: 'prod', gem_host: 'old-host' });
      __setConfig('gemstone', 'logins', [login]);

      const updated = makeLogin({ stone: 'prod', gem_host: 'old-host', gs_password: 'newpass' });
      await storage.saveLogin(updated);

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].gs_password).toBe('newpass');
    });

    it('supports renaming via originalLabel', async () => {
      const login = makeLogin({ stone: 'old-stone' });
      __setConfig('gemstone', 'logins', [login]);

      const updated = makeLogin({ stone: 'new-stone' });
      await storage.saveLogin(updated, loginLabel(login));

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].stone).toBe('new-stone');
    });

    it('adds as new if originalLabel not found', async () => {
      const existing = makeLogin({ stone: 'stoneA' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ stone: 'stoneB' });
      await storage.saveLogin(newLogin, 'Nonexistent');

      expect(storage.getLogins()).toHaveLength(2);
    });
  });

  describe('deleteLogin', () => {
    it('removes a login by generated label', async () => {
      __setConfig('gemstone', 'logins', [
        makeLogin({ stone: 'stoneA' }),
        makeLogin({ stone: 'stoneB' }),
        makeLogin({ stone: 'stoneC' }),
      ]);

      await storage.deleteLogin(loginLabel(makeLogin({ stone: 'stoneB' })));

      const result = storage.getLogins();
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.stone)).toEqual(['stoneA', 'stoneC']);
    });

    it('does nothing when label not found', async () => {
      __setConfig('gemstone', 'logins', [makeLogin({ stone: 'stoneA' })]);
      await storage.deleteLogin('Nonexistent');
      expect(storage.getLogins()).toHaveLength(1);
    });

    it('handles deleting from empty list', async () => {
      await storage.deleteLogin('Anything');
      expect(storage.getLogins()).toEqual([]);
    });
  });

  describe('removeGciLibraryPath', () => {
    it('forgets one version and keeps the rest', async () => {
      __setConfig('gemstone', 'gciLibraries', { '3.7.5': '/a.so', '3.7.4': '/b.so' });
      await storage.removeGciLibraryPath('3.7.5');
      expect(storage.getGciLibraryPath('3.7.5')).toBeUndefined();
      expect(storage.getGciLibraryPath('3.7.4')).toBe('/b.so');
    });
  });

  describe('passwords in the keychain', () => {
    const keychainLogin = (overrides: Partial<GemStoneLogin> = {}) =>
      makeLogin({ password_in_keychain: true, host_password: 'hostpw', ...overrides });

    it('stores both passwords in the keychain and saves the login without them', async () => {
      await storage.saveLogin(keychainLogin());

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
      expect(storage.getLogins()[0]).toMatchObject({ gs_password: '', host_password: '' });
    });

    it('moves the entry to the new name when the user, host or stone changes', async () => {
      const before = keychainLogin();
      await storage.saveLogin(before);

      await storage.saveLogin(keychainLogin({ stone: 'renamed' }), loginLabel(before));

      expect([...secrets.entries.keys()].sort()).toEqual([
        'jasper-gemstone-login:DataCurator@localhost/renamed',
        'jasper-gemstone-login:DataCurator@localhost/renamed#host',
      ]);
    });

    it('deletes the entries when the box is unchecked', async () => {
      await storage.saveLogin(keychainLogin());

      await storage.saveLogin(makeLogin({ gs_password: 'plain' }));

      expect(secrets.entries.size).toBe(0);
      expect(storage.getLogins()[0].gs_password).toBe('plain');
    });

    it('deletes the entries with the login', async () => {
      const login = keychainLogin();
      await storage.saveLogin(login);

      await storage.deleteLogin(loginLabel(login));

      expect(secrets.entries.size).toBe(0);
    });

    it('says so, and still keeps the passwords out of settings, when the keychain cannot be written', async () => {
      secrets.store.mockRejectedValueOnce(new Error('no keyring'));

      await storage.saveLogin(keychainLogin());

      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('no keyring'));
      expect(storage.getLogins()[0]).toMatchObject({
        gs_password: '',
        host_password: '',
        password_in_keychain: true,
      });
    });
  });

  describe('movePasswordsToKeychain', () => {
    it('moves plain-text passwords into the keychain, in the settings file that held them', async () => {
      const plain = makeLogin({ host_password: 'hostpw' });
      const empty = makeLogin({ stone: 'other', gs_password: '' });
      __setConfig('gemstone', 'logins', [plain, empty], 'workspace');

      expect(await storage.movePasswordsToKeychain()).toBe(true);

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
      expect(__configUpdates.at(-1)).toMatchObject({ key: 'logins', target: 2 });
      expect(storage.getLogins()).toEqual([
        { ...plain, gs_password: '', host_password: '', password_in_keychain: true },
        empty,
      ]);
    });

    it('keeps a GemStone password already in the keychain when moving the host password beside it', async () => {
      secrets.entries.set(GS_KEY, 'kc-gs');
      __setConfig('gemstone', 'logins', [
        makeLogin({ gs_password: '', host_password: 'hostpw', password_in_keychain: true }),
      ]);

      await storage.movePasswordsToKeychain();

      expect(secrets.entries.get(GS_KEY)).toBe('kc-gs');
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
    });

    it('leaves the settings file alone when the keychain cannot be written', async () => {
      secrets.store.mockRejectedValueOnce(new Error('no keyring'));
      const plain = makeLogin();
      __setConfig('gemstone', 'logins', [plain]);

      expect(await storage.movePasswordsToKeychain()).toBe(false);

      expect(storage.getLogins()).toEqual([plain]);
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('still in your settings file'),
      );
    });
  });
});
