import { test, expect } from '../helpers/vscode';
import { readContainerStone } from '../helpers/containerStone';
import { connectToStone, addRepoFromGit, loadRepo } from '../helpers/rowan';
import { startSeasideServer } from '../helpers/seaside';

/**
 * The Seaside milestone, end to end: install Seaside and a Hello World Seaside
 * app through Jasper (as Rowan projects), serve it from GemStone, and view it
 * in VS Code's integrated browser. Needs the in-container Rowan-3 stone.
 */
const stone = readContainerStone();
const SEASIDE_GIT = 'https://github.com/srbaker/seaside-rowan.git';
const HELLO_GIT = 'https://github.com/srbaker/hello-seaside-rowan.git';
const PORT = 8383;
const HELLO_URL = `http://localhost:${PORT}/hello`;

test.describe('Seaside Hello World in the integrated browser', () => {
  test.skip(!stone, 'no in-container Rowan stone (run npm run test:acceptance:seaside)');
  test.setTimeout(900_000);

  test.use({
    workspaceSettings: {
      'gemstone.rootPath': stone ? stone.globalDir : undefined,
      'gemstone.gciLibraries': stone ? { [stone.version]: stone.gciLibraryPath } : {},
      'gemstone.logins': stone
        ? [
            {
              version: stone.version,
              gem_host: stone.host,
              stone: stone.stone,
              gs_user: stone.user,
              gs_password: stone.password,
              netldi: stone.netldi,
            },
          ]
        : [],
    },
  });

  test('installs Seaside + Hello World via Jasper and serves it in the browser', async ({
    window,
  }) => {
    await test.step('connect', async () => {
      await connectToStone(window);
    });

    await test.step('install Seaside (seaside-rowan)', async () => {
      await addRepoFromGit(window, SEASIDE_GIT);
      await loadRepo(window, SEASIDE_GIT);
    });

    await test.step('install Hello World (hello-seaside-rowan)', async () => {
      await addRepoFromGit(window, HELLO_GIT);
      await loadRepo(window, HELLO_GIT);
    });

    await test.step('serve it from GemStone', async () => {
      await startSeasideServer(PORT);
    });

    await test.step('view it in the integrated browser', async () => {
      // Open VS Code's integrated browser and navigate it to the Seaside app.
      await window.keyboard.press('Control+Shift+P');
      await window.locator('.quick-input-widget input').fill('>Browser: Open Integrated Browser');
      await window
        .getByRole('option', { name: 'Browser: Open Integrated Browser', exact: true })
        .first()
        .click();

      const urlBar = window.getByRole('textbox', { name: 'Search or enter URL' });
      await urlBar.fill(HELLO_URL);
      await urlBar.press('Enter');

      // The integrated browser renders in a native view (not a DOM webview), so
      // we can't read its HTML from here. But it navigates and adopts the page's
      // own <title> — so the browser tab reads "Seaside (localhost:8383)", which
      // proves it loaded our Seaside app. The 'serve it' step already proved that
      // URL returns "Hello World from Seaside" (and the trace screenshot shows it).
      await expect(
        window.getByRole('tab', { name: new RegExp(`Seaside \\(localhost:${PORT}\\)`) }),
      ).toBeVisible({ timeout: 30_000 });
    });
  });
});
