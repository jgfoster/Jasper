import { test as base, _electron as electron, Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Repo root — the extension-development path VS Code loads Jasper from. */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * The Electron binary that ships alongside the CLI launcher `@vscode/test-electron`
 * hands back. We exec it directly (never via macOS `open`/LaunchServices, which
 * would collide with a running VS Code — same bundle id — and drop our args).
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
 * A Playwright fixture that gives each test a live VS Code window with Jasper
 * loaded, driven over CDP, and torn down afterwards.
 *
 * Non-disruptive on macOS: the moment the app is up we switch it to the
 * "accessory" activation policy — the runtime equivalent of LSUIElement — and
 * hide it. An accessory app has no Dock icon and never becomes the active
 * application, so its window can't steal focus or sit on your desktop while you
 * work. Playwright drives it over CDP, which is unaffected by any of that.
 *
 * Isolated from your own machine — not just VS Code's settings:
 *   - a fresh user-data dir (no personal settings, theme, or window state)
 *   - a fresh extensions dir (only Jasper loads)
 *   - a throwaway workspace folder
 *   - HOME pointed at the profile, so `~/.claude.json` and `~/Documents/GemStone`
 *     resolve to empty throwaway paths (no MCP write to your real config)
 *   - `gemstone.rootPath` at an empty temp dir, so the Versions and Databases
 *     panels never surface your real GemStone installs
 *   - secrets kept in an in-profile file store, never the macOS login keychain
 *
 * Fixtures:
 *   - `workspaceSettings` — seeds the workspace's `.vscode/settings.json` before
 *      launch (override with `test.use({ workspaceSettings })`) to declare
 *      logins, GCI library paths, etc. Its keys win over the isolation defaults.
 *   - `window` — the workbench page, ready to drive (`.monaco-workbench` present)
 */
export const test = base.extend<{
  workspaceSettings: Record<string, unknown>;
  window: Page;
}>({
  workspaceSettings: [{}, { option: true }],

  window: async ({ workspaceSettings }, use) => {
    const vscodeCliPath = await downloadAndUnzipVSCode('stable');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-acceptance-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-workspace-'));

    const gemstoneRoot = path.join(profile, 'gemstone-root');
    fs.mkdirSync(gemstoneRoot, { recursive: true });
    const settings = {
      'gemstone.rootPath': gemstoneRoot,
      'gemstone.mcp.registerWithClaudeDesktop': false,
      ...workspaceSettings,
    };
    const dotVscode = path.join(workspace, '.vscode');
    fs.mkdirSync(dotVscode, { recursive: true });
    fs.writeFileSync(path.join(dotVscode, 'settings.json'), JSON.stringify(settings, null, 2));

    // Clean env: drop ELECTRON_RUN_AS_NODE (it makes VS Code's Electron boot as
    // plain Node and reject every CLI flag), and point HOME at the throwaway
    // profile so nothing home-relative touches the real machine.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
    }
    env.HOME = profile;
    env.USERPROFILE = profile;

    const app = await electron.launch({
      executablePath: electronBinary(vscodeCliPath),
      env,
      args: [
        `--extensionDevelopmentPath=${repoRoot}`,
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
        '--no-sandbox',
        // Keep secrets in an in-profile file store instead of the macOS login
        // keychain, which --user-data-dir does NOT isolate.
        '--password-store=basic',
        workspace,
      ],
    });

    if (process.platform === 'darwin') {
      // Make it an accessory app (no Dock icon, never the active app) so its
      // window can't steal focus.
      await app.evaluate(({ app }) => {
        app.setActivationPolicy?.('accessory');
        app.dock?.hide?.();
      });
    }

    const page = await app.firstWindow();

    if (process.platform === 'darwin') {
      // Move the window off every display so it isn't on the visible desktop.
      // (Off-screen, not hidden: a hidden window reports its contents as
      // non-visible, which would make Playwright's actionability checks hang.)
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.setPosition(-20000, -20000);
      });
    }

    await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

    // Trace manually so the flip-through report survives regardless of the
    // launch path (leaving the runner's auto-trace off avoids double-starting).
    const context = page.context();
    await context.tracing.start({ screenshots: true, snapshots: true });

    await use(page);

    const tracePath = test.info().outputPath('trace.zip');
    await context.tracing.stop({ path: tracePath });
    await test.info().attach('trace', { path: tracePath, contentType: 'application/zip' });

    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  },
});

export const expect = test.expect;
