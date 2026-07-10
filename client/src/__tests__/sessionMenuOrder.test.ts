import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Logins tree exposes inline action buttons whose left-to-right order VS
// Code derives from the `inline@<n>` suffix (ascending — lowest number is
// leftmost). That order is a deliberate UX decision: the most-used and safe
// actions lead, and the session-ending / destructive actions trail so they are
// not the first thing the cursor reaches. Pin the sequence here so a future
// edit to package.json can't silently scramble it.

interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const itemContext: MenuItem[] = pkg.contributes.menus['view/item/context'];

function inlineRank(group: string): number {
  const match = /inline@(\d+)/.exec(group);
  return match ? Number(match[1]) : 0;
}

function inlineOrderFor(viewItemClause: string): string[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && (m.when ?? '').includes(viewItemClause))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
    .map((m) => m.command);
}

describe('session row inline button order', () => {
  it('leads with the most-used safe actions, groups the backup/restore pair, and trails with Logout', () => {
    const order = inlineOrderFor('viewItem == gemstoneSession');

    expect(order).toEqual([
      'gemstone.openBrowser',
      'gemstone.sessionOpenWorkspace',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
      'gemstone.sessionPing',
      'gemstone.fullLogicalBackup',
      'gemstone.fullLogicalRestore',
      'gemstone.sessionLogout',
    ]);
  });
});

describe('login row inline button order', () => {
  it('leads with Login and trails with the destructive Delete', () => {
    const order = inlineOrderFor('viewItem == gemstoneLogin');

    expect(order).toEqual([
      'gemstone.login',
      'gemstone.editLogin',
      'gemstone.deleteLogin',
    ]);
  });
});
