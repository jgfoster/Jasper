import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel } from './loginTypes';
import {
  deleteLoginPasswords,
  getLoginPasswords,
  loginCredentialAccount,
  storeLoginPasswords,
} from './loginCredentials';

export function hasPlainTextPassword(login: GemStoneLogin): boolean {
  return Boolean(login.gs_password || login.host_password);
}

export class LoginStorage {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getLogins(): GemStoneLogin[] {
    const config = vscode.workspace.getConfiguration('gemstone');
    return config.get<GemStoneLogin[]>('logins', []);
  }

  /**
   * A keychain-backed login must carry both passwords, as the editor's form
   * does: an empty one clears its keychain entry.
   */
  async saveLogin(login: GemStoneLogin, originalLabel?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const logins = [...this.getLogins()];
    const matchLabel = originalLabel ?? loginLabel(login);
    const index = logins.findIndex((l) => loginLabel(l) === matchLabel);
    const replaced = index >= 0 ? logins[index] : undefined;

    if (login.password_in_keychain) {
      await this.storeInKeychain(login, 'Jasper will ask for them when you log in.');
      login = { ...login, gs_password: '', host_password: '' };
    }
    // Keychain entries are keyed by user, host and stone, so a rename or an
    // unchecked box leaves the old entry behind unless it is removed here.
    if (
      replaced?.password_in_keychain &&
      (!login.password_in_keychain ||
        loginCredentialAccount(replaced) !== loginCredentialAccount(login))
    ) {
      await deleteLoginPasswords(this.secrets, replaced);
    }

    if (index >= 0) {
      logins[index] = login;
    } else {
      logins.push(login);
    }

    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
  }

  async deleteLogin(label: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const all = this.getLogins();
    const doomed = all.find((l) => loginLabel(l) === label);
    if (doomed?.password_in_keychain) {
      await deleteLoginPasswords(this.secrets, doomed);
    }
    const logins = all.filter((l) => loginLabel(l) !== label);
    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
  }

  /**
   * Rewrites whichever settings file holds the password, user or workspace.
   * Returns false, leaving that file as it was, if the keychain can't be written.
   */
  async movePasswordsToKeychain(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const inspected = config.inspect<GemStoneLogin[]>('logins');
    const layers: [vscode.ConfigurationTarget, GemStoneLogin[] | undefined][] = [
      [vscode.ConfigurationTarget.Global, inspected?.globalValue],
      [vscode.ConfigurationTarget.Workspace, inspected?.workspaceValue],
    ];
    for (const [target, logins] of layers) {
      if (!logins?.some(hasPlainTextPassword)) continue;
      const moved: GemStoneLogin[] = [];
      for (const login of logins) {
        if (!hasPlainTextPassword(login)) {
          moved.push(login);
          continue;
        }
        // A login already keychain-backed may have only its host password in
        // plain text; storing it must not clear the GemStone password beside it.
        const stored = login.password_in_keychain
          ? await getLoginPasswords(this.secrets, login)
          : { gs_password: '', host_password: '' };
        const full = {
          ...login,
          gs_password: login.gs_password || stored.gs_password,
          host_password: login.host_password || stored.host_password,
        };
        if (!(await this.storeInKeychain(full, 'They are still in your settings file.'))) {
          return false;
        }
        moved.push({ ...login, gs_password: '', host_password: '', password_in_keychain: true });
      }
      await config.update('logins', moved, target);
    }
    return true;
  }

  private async storeInKeychain(login: GemStoneLogin, consequence: string): Promise<boolean> {
    try {
      await storeLoginPasswords(this.secrets, login);
      return true;
    } catch (e) {
      vscode.window.showErrorMessage(
        `Couldn't save the passwords for "${loginLabel(login)}" in the OS keychain ` +
          `(${e instanceof Error ? e.message : e}). ${consequence}`,
      );
      return false;
    }
  }

  getGciLibraryPath(version: string): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = config.get<Record<string, string>>('gciLibraries', {});
    return libraries[version];
  }

  async setGciLibraryPath(version: string, libraryPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = { ...config.get<Record<string, string>>('gciLibraries', {}) };
    libraries[version] = libraryPath;
    await config.update('gciLibraries', libraries, vscode.ConfigurationTarget.Global);
  }

  async removeGciLibraryPath(version: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = { ...config.get<Record<string, string>>('gciLibraries', {}) };
    delete libraries[version];
    await config.update('gciLibraries', libraries, vscode.ConfigurationTarget.Global);
  }
}
