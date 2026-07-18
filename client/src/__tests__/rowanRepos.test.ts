import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import { RowanRepoRegistry, TrackedRepo } from '../rowanRepos';

// A Memento good enough for the registry: get with default + update.
function fakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (store.has(key) ? store.get(key) : defaultValue) as T,
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  } as vscode.Memento;
}

describe('RowanRepoRegistry', () => {
  let registry: RowanRepoRegistry;

  beforeEach(() => {
    registry = new RowanRepoRegistry(fakeMemento());
  });

  it('starts empty', () => {
    expect(registry.list()).toEqual([]);
  });

  it('tracks an added repository', async () => {
    const repo: TrackedRepo = { name: 'seaside-rowan', path: '/repos/seaside-rowan' };

    await registry.add(repo);

    expect(registry.list()).toEqual([repo]);
  });

  it('keeps the git URL for repos added by cloning', async () => {
    await registry.add({
      name: 'seaside-rowan',
      path: '/repos/seaside-rowan',
      gitUrl: 'git@github.com:x/seaside-rowan.git',
    });

    expect(registry.list()[0].gitUrl).toBe('git@github.com:x/seaside-rowan.git');
  });

  it('updates in place when the same path is added again', async () => {
    await registry.add({ name: 'old-name', path: '/repos/p' });

    await registry.add({ name: 'new-name', path: '/repos/p', gitUrl: 'https://x/p.git' });

    expect(registry.list()).toEqual([
      { name: 'new-name', path: '/repos/p', gitUrl: 'https://x/p.git' },
    ]);
  });

  it('stops tracking a repository by path', async () => {
    await registry.add({ name: 'a', path: '/repos/a' });
    await registry.add({ name: 'b', path: '/repos/b' });

    const removed = await registry.remove('/repos/a');

    expect(removed).toBe(true);
    expect(registry.list()).toEqual([{ name: 'b', path: '/repos/b' }]);
  });

  it('reports when there was nothing to remove', async () => {
    expect(await registry.remove('/repos/nope')).toBe(false);
  });
});
