import * as vscode from 'vscode';

// Registry of *tracked* Rowan repositories — the disk-lens half of the Rowan
// view. Tracking is deliberately separate from loading: a tracked repo is just
// a known location (added once, by git URL or local folder) that can be loaded
// into whatever stone the current session points at, today or on a fresh stone
// next week. Entries persist extension-side (globalState): stones are
// disposable, the registry isn't.

export interface TrackedRepo {
  /** Display name; defaults to the directory basename. */
  name: string;
  /** Absolute path of the local checkout. Identity key — one entry per path. */
  path: string;
  /** Set when the repo was added by cloning a git URL. */
  gitUrl?: string;
}

const STORAGE_KEY = 'gemstone.rowanRepos';

export class RowanRepoRegistry {
  constructor(private readonly storage: vscode.Memento) {}

  list(): TrackedRepo[] {
    return this.storage.get<TrackedRepo[]>(STORAGE_KEY, []);
  }

  /**
   * Track a repository. The path is the identity: re-adding an already-tracked
   * path updates its name/gitUrl in place rather than duplicating the entry.
   */
  async add(repo: TrackedRepo): Promise<void> {
    const repos = this.list().filter((r) => r.path !== repo.path);
    repos.push(repo);
    await this.storage.update(STORAGE_KEY, repos);
  }

  /** Stop tracking (does not touch the files on disk). */
  async remove(path: string): Promise<boolean> {
    const repos = this.list();
    const remaining = repos.filter((r) => r.path !== path);
    if (remaining.length === repos.length) return false;
    await this.storage.update(STORAGE_KEY, remaining);
    return true;
  }
}
