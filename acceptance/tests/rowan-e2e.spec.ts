import { test, expect } from '../helpers/vscode';
import { readContainerStone } from '../helpers/containerStone';

/**
 * The full Rowan workflow, end to end against a real Rowan-3 stone: connect,
 * add the seaside-rowan project from GitHub, wait for the clone, load it into
 * the image, and prove Seaside is actually there. Needs the in-container stone
 * from stone-entrypoint.sh, so it skips elsewhere.
 */
const stone = readContainerStone();

test.describe('Rowan end to end', () => {
  test.skip(!stone, 'no in-container Rowan stone (run npm run test:acceptance:rowan)');
  test.setTimeout(600_000);

  test.use({
    workspaceSettings: {
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

  test('adds seaside-rowan from git, loads it, and Seaside is in the image', async ({ window }) => {
    const sidebar = window.locator('.sidebar');

    await test.step('connect to the stone', async () => {
      await window.getByRole('tab', { name: /GemStone/ }).click();
      const loginRow = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
      await loginRow.hover();
      await loginRow.getByRole('button', { name: 'Login', exact: true }).click();
      await expect(sidebar.getByText(/Session \d+/)).toBeVisible({ timeout: 60_000 });
    });

    await test.step('add seaside-rowan from git', async () => {
      await sidebar.getByRole('button', { name: 'Rowan Section' }).click();
      await sidebar.getByRole('button', { name: /Add Rowan Repository/ }).click();

      await window.getByRole('option', { name: /Clone from Git URL/ }).click();
      const input = window.locator('.quick-input-widget input');
      await input.fill('https://github.com/srbaker/seaside-rowan.git');
      await input.press('Enter');
    });

    await test.step('wait for the clone to land as a tracked repo', async () => {
      await expect(sidebar.getByRole('treeitem', { name: /seaside-rowan/ })).toBeVisible({
        timeout: 180_000,
      });
    });

    await test.step('load it into the image', async () => {
      const repoRow = sidebar.getByRole('treeitem', { name: /seaside-rowan/ });
      await repoRow.hover();
      await repoRow.getByRole('button', { name: /Load into Image/ }).click();
    });

    await test.step('prove Seaside is loaded', async () => {
      await expect(sidebar.getByRole('treeitem', { name: /^Seaside/ })).toBeVisible({
        timeout: 480_000,
      });
    });
  });
});
