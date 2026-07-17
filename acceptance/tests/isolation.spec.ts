import { test, expect } from '../helpers/vscode';

/**
 * A run must not touch the developer's own machine. The Versions panel is the
 * tell: if the isolated GemStone root leaked to the real one, a locally
 * installed release would show "extracted and ready to use". With isolation
 * intact, every release reads as merely available for download.
 */
test("does not surface the machine's installed GemStone versions", async ({ window }) => {
  await window.getByRole('tab', { name: /GemStone/ }).click();

  const sidebar = window.locator('.sidebar');
  const anyVersion = sidebar.getByRole('treeitem', { name: /^\d+\.\d+/ }).first();
  await expect(anyVersion).toBeVisible();

  await expect(sidebar.getByText(/extracted and ready to use/)).toHaveCount(0);
});
