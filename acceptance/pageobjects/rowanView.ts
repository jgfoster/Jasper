/**
 * Page Object over the GemStone sidebar's "Rowan" view. Centralizes the fragile
 * `.sidebar` / ARIA selectors so the specs read as behaviour, not clicks.
 */
import { Page, Locator, expect } from '@playwright/test';
import { touch } from '../helpers/vscode';

export class RowanView {
  constructor(private readonly page: Page) {}

  private get sidebar(): Locator {
    return this.page.locator('.sidebar');
  }

  /** Open the GemStone sidebar and expand the Rowan pane so its body renders. */
  async open(): Promise<void> {
    await touch(this.page.getByRole('tab', { name: /GemStone/ }));
    await expect(this.sidebar).toBeVisible();
    const header = this.sidebar.getByRole('button', { name: 'Rowan Section' });
    await header.scrollIntoViewIfNeeded();
    if ((await header.getAttribute('aria-expanded')) === 'false') {
      await touch(header);
    }
  }

  /** The welcome button offered when the open folder isn't yet a Rowan project. */
  get createProjectButton(): Locator {
    return this.sidebar.getByRole('button', { name: 'Create Rowan Project' });
  }
}
