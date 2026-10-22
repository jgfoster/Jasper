/**
 * Secret storage for Jasper login passwords, backed by VS Code's
 * SecretStorage API (which delegates to the OS keychain on each platform).
 *
 * Keys are namespaced with `KEYCHAIN_SERVICE` so they don't collide with
 * other secrets the extension might store in the future.
 */

import * as vscode from 'vscode';
import { GemStoneLogin } from './loginTypes';

export const KEYCHAIN_SERVICE = 'jasper-gemstone-login';

type LoginIdentity = Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>;

export type LoginPasswords = Pick<GemStoneLogin, 'gs_password' | 'host_password'>;

/** Build a unique account identifier for a login. */
export function loginCredentialAccount(login: LoginIdentity): string {
  return `${login.gs_user}@${login.gem_host}/${login.stone}`;
}

// The GemStone password's key has no suffix: entries saved before the host
// password could be kept here must still be found.
function secretKeys(login: LoginIdentity): Record<keyof LoginPasswords, string> {
  const base = `${KEYCHAIN_SERVICE}:${loginCredentialAccount(login)}`;
  return { gs_password: base, host_password: `${base}#host` };
}

/** An empty password deletes its entry. Throws when SecretStorage can't be written. */
export async function storeLoginPasswords(
  secrets: vscode.SecretStorage,
  login: GemStoneLogin,
): Promise<void> {
  const keys = secretKeys(login);
  for (const field of ['gs_password', 'host_password'] as const) {
    if (login[field]) {
      await secrets.store(keys[field], login[field]);
    } else {
      await secrets.delete(keys[field]);
    }
  }
}

/** A password missing or unreadable comes back ''. */
export async function getLoginPasswords(
  secrets: vscode.SecretStorage,
  login: LoginIdentity,
): Promise<LoginPasswords> {
  const keys = secretKeys(login);
  const read = async (key: string) => {
    try {
      return (await secrets.get(key)) ?? '';
    } catch {
      return '';
    }
  };
  return {
    gs_password: await read(keys.gs_password),
    host_password: await read(keys.host_password),
  };
}

/** Returns false when SecretStorage throws. */
export async function deleteLoginPasswords(
  secrets: vscode.SecretStorage,
  login: LoginIdentity,
): Promise<boolean> {
  const keys = secretKeys(login);
  try {
    await secrets.delete(keys.gs_password);
    await secrets.delete(keys.host_password);
    return true;
  } catch {
    return false;
  }
}
