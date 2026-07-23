/**
 * Page Object over VS Code's built-in Source Control view. Jasper adds nothing
 * here — a Rowan project is committed with the editor's own git support — so
 * this only names the controls a scenario drives.
 */
import { Page, Locator, expect } from '@playwright/test';
import { touch } from '../helpers/vscode';

export class SourceControlView {
  constructor(private readonly page: Page) {}

  private get sidebar(): Locator {
    return this.page.locator('.sidebar');
  }

  /**
   * The activity-bar tab. Its accessible name carries the pending-change count
   * ("Source Control (Ctrl+Shift+G) - 7 pending changes"), which is the one
   * place the whole repository's state is summarized.
   */
  get tab(): Locator {
    return this.page.getByRole('tab', { name: /^Source Control/ });
  }

  /**
   * Show the Source Control view. Clicking the activity-bar tab of the view
   * that is already showing *closes* the sidebar, so only click when it isn't —
   * which is what its own controls being on screen tells us.
   */
  async open(): Promise<void> {
    const alreadyShowing =
      (await this.messageBox.count()) > 0 || (await this.initializeButton.count()) > 0;
    if (!alreadyShowing) {
      await touch(this.tab);
    }
    await expect(this.sidebar).toBeVisible();
  }

  /** Offered when the open folder isn't a git repository yet. */
  get initializeButton(): Locator {
    return this.sidebar.getByRole('button', { name: 'Initialize Repository' });
  }

  /**
   * Re-reads the working tree. Git notices most edits on its own, but a file
   * written by an extension can be missed — the container's file watching is
   * not as reliable as a desktop's — and this is the button a user hits when
   * the view looks out of date.
   */
  get refreshButton(): Locator {
    // The Graph section has a Refresh of its own, so scope to the Changes one.
    return this.sidebar
      .getByRole('toolbar', { name: 'Changes actions' })
      .getByRole('button', { name: 'Refresh', exact: true });
  }

  /** A file listed as changed, by name. */
  change(fileName: string): Locator {
    return this.sidebar.getByRole('treeitem', { name: new RegExp(fileName) });
  }

  /**
   * The commit message field. It is a Monaco editor whose own textbox is
   * unnamed, so the named row around it is what a scenario clicks and what the
   * storyboard can call by name.
   */
  get messageBox(): Locator {
    return this.sidebar.getByRole('treeitem', { name: 'Source Control Input' });
  }

  /** Named for the branch it commits to, e.g. `Commit Changes on "main"`. */
  get commitButton(): Locator {
    return this.sidebar.getByRole('button', { name: /^Commit Changes on/ });
  }
}
