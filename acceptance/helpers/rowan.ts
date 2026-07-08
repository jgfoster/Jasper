import { Page, expect } from '@playwright/test';

/** Log in to the seeded GemStone stone and wait for the session to appear. */
export async function connectToStone(window: Page): Promise<void> {
  const sidebar = window.locator('.sidebar');
  await window.getByRole('tab', { name: /GemStone/ }).click();
  const loginRow = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
  await loginRow.hover();
  await loginRow.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(sidebar.getByText(/Session \d+/)).toBeVisible({ timeout: 60_000 });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Add a Rowan repository from a git URL via the Rowan view's title button. */
export async function addRepoFromGit(window: Page, gitUrl: string): Promise<void> {
  const sidebar = window.locator('.sidebar');
  const rowanSection = sidebar.getByRole('button', { name: 'Rowan Section' });
  await rowanSection.scrollIntoViewIfNeeded();
  if ((await rowanSection.getAttribute('aria-expanded')) === 'false') {
    await rowanSection.click();
  }
  await rowanSection.hover();
  await sidebar.getByRole('button', { name: /Add Rowan Repository/ }).click();
  await window.getByRole('option', { name: /Clone from Git URL/ }).click();
  const input = window.locator('.quick-input-widget input');
  await input.fill(gitUrl);
  await input.press('Enter');
}

/**
 * Load a tracked repo (identified by its git URL, so `seaside-rowan` and
 * `hello-seaside-rowan` rows don't collide) into the image, then accept the
 * "refresh this session" prompt so the working session sees the new project.
 * Fails fast on a load error.
 */
export async function loadRepo(window: Page, gitUrl: string): Promise<void> {
  const sidebar = window.locator('.sidebar');
  const repoRow = sidebar.getByRole('treeitem', { name: new RegExp(escapeRegex(gitUrl)) });
  await expect(repoRow).toBeVisible({ timeout: 180_000 });
  await repoRow.hover();
  await repoRow.getByRole('button', { name: /Load into Image/ }).click();

  const refresh = window
    .locator('.notifications-toasts')
    .getByRole('button', { name: 'Refresh', exact: true });
  const loadError = window.getByText(/Load of .* failed/i);
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    if (await refresh.count()) {
      await refresh.click();
      return;
    }
    if (await loadError.count()) {
      throw new Error((await loadError.allInnerTexts()).join(' '));
    }
    await window.waitForTimeout(1_000);
  }
  throw new Error(`load of ${gitUrl} did not finish in time`);
}
