import * as vscode from 'vscode';
import { DEFAULT_GS_PW, GemStoneLogin, loginLabel } from './loginTypes';
import {
  deleteLoginPasswords,
  getLoginPasswords,
  loginCredentialAccount,
  storeLoginPasswords,
} from './loginCredentials';

export const SAVE_AS_PLAIN_TEXT = 'Save as plain text';
export const ASK_AT_LOGIN = "Don't save — ask at login";

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
      const error = await this.keychainWriteError(login);
      login = error
        ? await this.afterKeychainFailure(login, error)
        : { ...login, gs_password: '', host_password: '' };
    }
    // Keychain entries are keyed by user, host and stone, so a rename or an
    // unchecked box leaves the old entry behind unless it is removed.
    const stale =
      replaced?.password_in_keychain &&
      (!login.password_in_keychain ||
        loginCredentialAccount(replaced) !== loginCredentialAccount(login))
        ? replaced
        : undefined;

    if (index >= 0) {
      logins[index] = login;
    } else {
      logins.push(login);
    }

    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
    // Only once settings are written: if that throws, they still name the old entry.
    if (stale) await deleteLoginPasswords(this.secrets, stale);
  }

  async deleteLogin(label: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const all = this.getLogins();
    const doomed = all.find((l) => loginLabel(l) === label);
    const logins = all.filter((l) => loginLabel(l) !== label);
    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
    if (doomed?.password_in_keychain) await deleteLoginPasswords(this.secrets, doomed);
  }

  /**
   * Moves the plain-text passwords of the logins named in `labels`, in whichever
   * settings file holds them, user or workspace. Every password is stored before
   * either file is written, so a failure leaves both files as they were.
   */
  async movePasswordsToKeychain(labels: ReadonlySet<string>): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const inspected = config.inspect<GemStoneLogin[]>('logins');
    const layers: [vscode.ConfigurationTarget, GemStoneLogin[] | undefined][] = [
      [vscode.ConfigurationTarget.Global, inspected?.globalValue],
      [vscode.ConfigurationTarget.Workspace, inspected?.workspaceValue],
    ];
    const all = layers.flatMap(([, logins]) => logins ?? []);
    const toMove = (l: GemStoneLogin) => hasPlainTextPassword(l) && labels.has(loginLabel(l));

    // One keychain entry serves the same user, host and stone in both files, so
    // their passwords are merged first rather than the second overwriting the first.
    const byAccount = new Map<string, GemStoneLogin>();
    for (const login of all.filter(toMove)) {
      const account = loginCredentialAccount(login);
      let full = byAccount.get(account);
      if (!full) {
        // A login already keychain-backed may have only its host password in
        // plain text; storing it must not clear the GemStone password beside it.
        const keychainBacked = all.some(
          (l) => l.password_in_keychain && loginCredentialAccount(l) === account,
        );
        full = keychainBacked
          ? { ...login, ...(await getLoginPasswords(this.secrets, login)) }
          : { ...login, gs_password: '', host_password: '' };
      }
      byAccount.set(account, {
        ...full,
        gs_password: login.gs_password || full.gs_password,
        host_password: login.host_password || full.host_password,
      });
    }
    for (const login of byAccount.values()) {
      const error = await this.keychainWriteError(login);
      if (error) {
        vscode.window.showErrorMessage(
          `Couldn't save the passwords for "${loginLabel(login)}" in the OS keychain ` +
            `(${error}). They are still in your settings file.`,
        );
        return false;
      }
    }

    for (const [target, logins] of layers) {
      if (!logins?.some(toMove)) continue;
      const moved = logins.map((l) =>
        toMove(l) ? { ...l, gs_password: '', host_password: '', password_in_keychain: true } : l,
      );
      await config.update('logins', moved, target);
    }
    return true;
  }

  /** Undefined when both passwords were stored. */
  private async keychainWriteError(login: GemStoneLogin): Promise<string | undefined> {
    try {
      await storeLoginPasswords(this.secrets, login);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  /** Lets the user choose plain text or no saved passwords; closing the dialog chooses the latter. */
  private async afterKeychainFailure(login: GemStoneLogin, error: string): Promise<GemStoneLogin> {
    const choice = hasPlainTextPassword(login)
      ? await vscode.window.showWarningMessage(
          `Couldn't save the passwords for "${loginLabel(login)}" in the OS keychain (${error}).`,
          {
            modal: true,
            detail:
              'Save them as plain text in your VS Code settings, or leave them unsaved and ' +
              'be asked for them when you log in.' +
              (login.gs_password === DEFAULT_GS_PW
                ? ` The GemStone password is GemStone's default, ${DEFAULT_GS_PW}.`
                : ''),
          },
          SAVE_AS_PLAIN_TEXT,
          ASK_AT_LOGIN,
        )
      : undefined;
    // The failed write may have stored one of the two, and an older entry may
    // still be there; either would be used at login without asking.
    await deleteLoginPasswords(this.secrets, login);
    return choice === SAVE_AS_PLAIN_TEXT
      ? { ...login, password_in_keychain: false }
      : { ...login, gs_password: '', host_password: '' };
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
