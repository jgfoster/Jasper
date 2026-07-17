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
  // Clones a project from the internet and loads Seaside, which is minutes and
  // a network dependency — too much for the routine run, so it opts in.
  test.skip(
    !stone || !process.env.JASPER_ONLINE_SPECS,
    'clones from the internet (run npm run test:acceptance:rowan)',
  );
  test.setTimeout(600_000);

  test.use({
    workspaceSettings: {
      // Jasper's login forces GEMSTONE_GLOBAL_DIR from rootPath; point it at the
      // stone's global dir so the GCI library can resolve the NetLDI's port.
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

  test('adds seaside-rowan from git, loads it, and Seaside is in the image', async ({ window }) => {
    const sidebar = window.locator('.sidebar');

    await test.step('connect to the stone', async () => {
      await window.getByRole('tab', { name: /GemStone/ }).click();
      const loginRow = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
      await loginRow.hover();
      await loginRow.getByRole('button', { name: 'Login', exact: true }).click();

      // While waiting for the session, surface any dialog/notification so a
      // failed login says why instead of just timing out.
      const session = sidebar.getByText(/Session \d+/);
      const deadline = Date.now() + 60_000;
      let seen = '';
      while (Date.now() < deadline) {
        if (await session.count()) break;
        const parts = [
          ...(await window
            .locator('.notifications-toasts')
            .allInnerTexts()
            .catch(() => [])),
          ...(await window
            .locator('.quick-input-widget')
            .allInnerTexts()
            .catch(() => [])),
          ...(await window
            .locator('.monaco-dialog-box')
            .allInnerTexts()
            .catch(() => [])),
        ].filter(Boolean);
        const joined = parts.join(' ||| ');
        if (joined && joined !== seen) {
          console.log('[login-ui] ' + joined.replace(/\s+/g, ' '));
          seen = joined;
        }
        await window.waitForTimeout(500);
      }
      await expect(session).toBeVisible({ timeout: 5_000 });
    });

    await test.step('add seaside-rowan from git', async () => {
      const rowanSection = sidebar.getByRole('button', { name: 'Rowan Section' });
      await rowanSection.scrollIntoViewIfNeeded();
      if ((await rowanSection.getAttribute('aria-expanded')) === 'false') {
        await rowanSection.click();
      }
      await rowanSection.hover();
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

      // The load runs server-side (minutes) in a separate session, then offers
      // to refresh the working session so the new project is visible — accept
      // it. Fail fast if a load error surfaces instead of burning the timeout.
      const refresh = window
        .locator('.notifications-toasts')
        .getByRole('button', { name: 'Refresh', exact: true });
      const loadError = window.getByText(/Load of .* failed/i);
      const deadline = Date.now() + 480_000;
      while (Date.now() < deadline) {
        if (await refresh.count()) {
          await refresh.click();
          break;
        }
        if (await loadError.count()) {
          throw new Error((await loadError.allInnerTexts()).join(' '));
        }
        await window.waitForTimeout(1_000);
      }
    });

    await test.step('prove Seaside is loaded', async () => {
      await expect(sidebar.getByRole('treeitem', { name: /^Seaside/ })).toBeVisible({
        timeout: 60_000,
      });
    });
  });
});
