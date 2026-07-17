import * as vscode from 'vscode';

/**
 * What to do when a dependency has been added to the open project and a
 * database is connected:
 *
 *  - `never`  → leave it on disk; the user loads when they choose to.
 *  - `always` → load without asking.
 *  - `ask`    → offer. The buttons set the answer for next time: "Always" /
 *               "Never" persist; "Load" loads this once, leaving it at `ask`;
 *               dismissing does nothing at all.
 */
export type LoadAfterAddingMode = 'ask' | 'always' | 'never';

const SETTING = 'rowan.loadAfterAddingDependency';

function mode(): LoadAfterAddingMode {
  return vscode.workspace.getConfiguration('gemstone').get<LoadAfterAddingMode>(SETTING, 'ask');
}

function remember(answer: LoadAfterAddingMode): Thenable<void> {
  return vscode.workspace
    .getConfiguration('gemstone')
    .update(SETTING, answer, vscode.ConfigurationTarget.Global);
}

/**
 * Whether to load the open project now that `dependencyName` has been added to
 * it. Adding a dependency only writes a file; until the project is loaded the
 * database doesn't have the code, which is easy to forget — so offer, rather
 * than either loading behind the user's back or leaving them to notice.
 *
 * Only call this while connected: with no database there is nothing to load
 * into, and asking would be noise.
 */
export async function shouldLoadAfterAddingDependency(dependencyName: string): Promise<boolean> {
  const answer = mode();
  if (answer === 'never') return false;
  if (answer === 'always') return true;

  const LOAD = 'Load';
  const ALWAYS = 'Always';
  const NEVER = 'Never';
  // Modal, not a toast: it follows an explicit action and the answer decides
  // whether the database matches the project on disk. A toast auto-hides, and
  // missing it leaves the two quietly out of step.
  const choice = await vscode.window.showInformationMessage(
    `Load this project into the database so "${dependencyName}" takes effect?`,
    {
      modal: true,
      detail:
        `"${dependencyName}" has been added to the project on disk. The database won't have ` +
        'its code until the project is loaded.\n\n' +
        'Choose "Always" or "Never" to remember your answer.',
    },
    LOAD,
    ALWAYS,
    NEVER,
  );

  if (choice === NEVER) {
    await remember('never');
    return false;
  }
  if (choice === ALWAYS) {
    await remember('always');
    return true;
  }
  // "Load" loads once without remembering; dismissing does nothing.
  return choice === LOAD;
}
