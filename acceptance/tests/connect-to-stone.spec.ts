import { test, expect } from '../helpers/vscode';
import { readTestStone } from '../helpers/testStone';

/**
 * The core workflow: a user with a configured login connects, and a live
 * session appears under it. This needs the stone provisioned by
 * `npm run test:server:start`; without it the spec skips rather than fails.
 */
const stone = readTestStone();

test.describe('connecting to a stone', () => {
  test.skip(!stone, 'no test stone provisioned (run npm run test:server:start)');

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

  test('logging in opens a live session under the login', async ({ window }) => {
    await window.getByRole('tab', { name: /GemStone/ }).click();

    const sidebar = window.locator('.sidebar');
    const loginRow = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
    await loginRow.hover();
    const loginButton = loginRow.getByRole('button', { name: 'Login', exact: true });
    await expect(loginButton).toBeVisible();
    await loginButton.click();

    await expect(sidebar.getByText(/Session \d+/)).toBeVisible({ timeout: 45_000 });
  });
});
