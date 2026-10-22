import * as vscode from 'vscode';
import { loginLabel } from './loginTypes';
import { LoginStorage, hasPlainTextPassword } from './loginStorage';

export const OFFERED_KEY = 'gemstone.plainTextPasswordsOffered';
export const MOVE = 'Move to keychain';

/** Asks once per login, so one kept in plain text on purpose isn't asked about again. */
export async function offerToMovePlainTextPasswords(
  storage: LoginStorage,
  state: vscode.Memento,
  refresh: () => void,
): Promise<void> {
  const offered = new Set(state.get<string[]>(OFFERED_KEY, []));
  const plain = storage.getLogins().filter(hasPlainTextPassword);
  const fresh = plain.map(loginLabel).filter((label) => !offered.has(label));
  if (fresh.length === 0) return;
  await state.update(OFFERED_KEY, [...offered, ...fresh]);

  const which =
    plain.length === 1
      ? `The GemStone login "${loginLabel(plain[0])}" keeps its password`
      : `${plain.length} GemStone logins keep their passwords`;
  const choice = await vscode.window.showInformationMessage(
    `${which} as plain text in your VS Code settings.`,
    MOVE,
  );
  if (choice !== MOVE) return;
  if (await storage.movePasswordsToKeychain()) {
    refresh();
    vscode.window.showInformationMessage('Login passwords moved to the OS keychain.');
  }
}
