import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Repo root — the extension-development path VS Code loads Jasper from. */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * `@vscode/test-electron` downloads VS Code and hands back its CLI launcher.
 * Playwright's Electron support needs the actual Electron binary that ships in
 * the same install, so map from one to the other. The macOS layout is the
 * verified path; the others follow the documented extraction layout.
 */
function electronBinary(vscodeCliPath: string): string {
  if (process.platform === 'darwin') {
    const appRoot = vscodeCliPath.slice(0, vscodeCliPath.indexOf('.app/') + '.app'.length);
    return path.join(appRoot, 'Contents', 'MacOS', 'Electron');
  }
  const installRoot = path.dirname(path.dirname(vscodeCliPath));
  return process.platform === 'win32'
    ? path.join(installRoot, 'Code.exe')
    : path.join(installRoot, 'code');
}

/**
 * A Playwright fixture that launches a real VS Code window with Jasper loaded
 * and tears it down afterwards. Each test gets a throwaway user-data profile
 * and an empty workspace folder, so no run inherits another's window state,
 * open editors, or installed extensions.
 *
 * Fixtures:
 *   - `app`    — the Electron application handle
 *   - `window` — the workbench window, ready to drive (`.monaco-workbench` present)
 */
export const test = base.extend<{ app: ElectronApplication; window: Page }>({
  app: async ({}, use) => {
    const vscodeCliPath = await downloadAndUnzipVSCode('stable');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-acceptance-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-workspace-'));

    const app = await electron.launch({
      executablePath: electronBinary(vscodeCliPath),
      args: [
        `--extensionDevelopmentPath=${repoRoot}`,
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
        '--no-sandbox',
        workspace,
      ],
    });

    await use(app);

    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });
    await use(window);
  },
});

export const expect = test.expect;
