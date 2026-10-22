import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  KEYCHAIN_SERVICE,
  loginCredentialAccount,
  storeLoginPasswords,
  getLoginPasswords,
  deleteLoginPasswords,
} from '../loginCredentials';
import { GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    label: 'Test',
    version: '3.7.4',
    gem_host: 'localhost',
    stone: 'gs64stone',
    gs_user: 'DataCurator',
    gs_password: 'swordfish',
    netldi: 'gs64ldi',
    host_user: '',
    host_password: '',
    ...overrides,
  };
}

function makeSecrets() {
  return {
    get: vi.fn(async (_k: string) => undefined as string | undefined),
    store: vi.fn(async (_k: string, _v: string) => undefined),
    delete: vi.fn(async (_k: string) => undefined),
    onDidChange: vi.fn(),
  };
}

describe('loginCredentials', () => {
  let secrets: ReturnType<typeof makeSecrets>;

  beforeEach(() => {
    secrets = makeSecrets();
  });

  describe('KEYCHAIN_SERVICE', () => {
    it('is distinct from the MCP service', () => {
      expect(KEYCHAIN_SERVICE).toBe('jasper-gemstone-login');
    });
  });

  describe('loginCredentialAccount', () => {
    it('combines user, host, and stone', () => {
      expect(loginCredentialAccount(makeLogin())).toBe('DataCurator@localhost/gs64stone');
    });

    it('differs for different users on the same stone', () => {
      const a = loginCredentialAccount(makeLogin({ gs_user: 'DataCurator' }));
      const b = loginCredentialAccount(makeLogin({ gs_user: 'SystemUser' }));
      expect(a).not.toBe(b);
    });

    it('differs for the same user on different stones', () => {
      const a = loginCredentialAccount(makeLogin({ stone: 'dev' }));
      const b = loginCredentialAccount(makeLogin({ stone: 'prod' }));
      expect(a).not.toBe(b);
    });
  });

  const GS_KEY = 'jasper-gemstone-login:DataCurator@localhost/gs64stone';
  const HOST_KEY = `${GS_KEY}#host`;

  describe('storeLoginPasswords', () => {
    it('stores both passwords under keys namespaced by KEYCHAIN_SERVICE and the account', async () => {
      await storeLoginPasswords(secrets, makeLogin({ host_password: 'hostpw' }));

      expect(secrets.store).toHaveBeenCalledWith(GS_KEY, 'swordfish');
      expect(secrets.store).toHaveBeenCalledWith(HOST_KEY, 'hostpw');
    });

    it('deletes the entry of a password left empty', async () => {
      await storeLoginPasswords(secrets, makeLogin({ host_password: '' }));

      expect(secrets.store).toHaveBeenCalledWith(GS_KEY, 'swordfish');
      expect(secrets.delete).toHaveBeenCalledWith(HOST_KEY);
    });

    it('throws when SecretStorage cannot be written', async () => {
      secrets.store.mockRejectedValueOnce(new Error('no keyring'));
      await expect(storeLoginPasswords(secrets, makeLogin())).rejects.toThrow('no keyring');
    });
  });

  describe('getLoginPasswords', () => {
    it('returns both stored passwords', async () => {
      secrets.get.mockImplementation(async (k: string) =>
        k === GS_KEY ? 'stored-pw' : k === HOST_KEY ? 'stored-host' : undefined,
      );

      expect(await getLoginPasswords(secrets, makeLogin())).toEqual({
        gs_password: 'stored-pw',
        host_password: 'stored-host',
      });
    });

    it('returns an empty string for a password that is not stored', async () => {
      expect(await getLoginPasswords(secrets, makeLogin())).toEqual({
        gs_password: '',
        host_password: '',
      });
    });

    it('returns an empty string when SecretStorage throws', async () => {
      secrets.get.mockRejectedValue(new Error('SecretStorage unavailable'));
      expect((await getLoginPasswords(secrets, makeLogin())).gs_password).toBe('');
    });
  });

  describe('deleteLoginPasswords', () => {
    it('deletes both entries and returns true on success', async () => {
      const ok = await deleteLoginPasswords(secrets, makeLogin());

      expect(secrets.delete).toHaveBeenCalledWith(GS_KEY);
      expect(secrets.delete).toHaveBeenCalledWith(HOST_KEY);
      expect(ok).toBe(true);
    });

    it('returns false when SecretStorage throws', async () => {
      secrets.delete.mockRejectedValueOnce(new Error('no entry'));
      expect(await deleteLoginPasswords(secrets, makeLogin())).toBe(false);
    });
  });
});
