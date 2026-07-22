import * as vscode from 'vscode';
import { isSharedMemoryConfigured, getRemoveIpcConfigured } from './sharedMemoryTreeProvider';

/** Resolve once a terminal with the given name is closed. */
function waitForTerminalClose(name: string): Promise<void> {
  return new Promise((resolve) => {
    const disposable = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal.name === name) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

/**
 * Ensure the OS is configured before a stone is started.
 *
 * On macOS and Linux, GemStone needs at least 1 GB of shared memory — and, on
 * Linux, `RemoveIPC=no` so systemd does not destroy that memory when the login
 * session ends. When something is missing we explain that a terminal will open
 * to run a setup script with `sudo` (so the user must enter their password) and
 * offer Continue/Cancel.
 *
 * Returns `true` if the stone may start, `false` if the user cancelled or
 * shared-memory setup did not succeed (a wrong password, an aborted `sudo`,
 * etc.). Shared memory is the hard requirement that gates the start; the
 * Linux `RemoveIPC` step is offered in the same flow but treated as advisory,
 * so it never blocks a start on its own.
 *
 * On Windows this is a no-op — the "Configure OS" view handles WSL setup — and
 * it always returns `true`.
 */
export async function ensureStonePreconditions(): Promise<boolean> {
  if (process.platform === 'win32') return true;

  const isLinux = process.platform === 'linux';
  const sharedMemoryOk = await isSharedMemoryConfigured();
  const removeIpcOk = isLinux ? getRemoveIpcConfigured() : true;

  if (sharedMemoryOk && removeIpcOk) return true;

  const steps: string[] = [];
  if (!sharedMemoryOk) steps.push('  • raise shared memory to at least 1 GB');
  if (!removeIpcOk) steps.push('  • set RemoveIPC=no so the stone survives logout');

  const choice = await vscode.window.showWarningMessage(
    'Starting a stone needs some operating-system configuration that is not in place yet:\n\n' +
      steps.join('\n') +
      '\n\nJasper will open a terminal and run a setup script with sudo, so you will be ' +
      'prompted for your password. Continue?',
    { modal: true },
    'Continue',
  );
  if (choice !== 'Continue') return false; // Cancel or dismissed

  if (!sharedMemoryOk) {
    await vscode.commands.executeCommand(
      isLinux ? 'gemstone.runSetSharedMemoryLinux' : 'gemstone.runSetSharedMemory',
    );
    await waitForTerminalClose('GemStone: Shared Memory Setup');
  }
  if (!removeIpcOk) {
    await vscode.commands.executeCommand('gemstone.runSetRemoveIPC');
    await waitForTerminalClose('GemStone: RemoveIPC Setup');
  }

  // Shared memory is required; if it is still under 1 GB the setup did not
  // succeed, so cancel the start rather than let it fail confusingly.
  if (!sharedMemoryOk && !(await isSharedMemoryConfigured())) {
    vscode.window.showErrorMessage(
      'Shared memory is still below 1 GB, so the stone was not started. ' +
        'Configure shared memory and run Start Stone again.',
    );
    return false;
  }

  return true;
}
