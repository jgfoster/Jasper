import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Databases tree's running-Stone row exposes inline action buttons whose
// left-to-right order VS Code derives from the `inline@<n>` suffix (ascending —
// lowest number is leftmost). Online Extent Backup — a snapshot of a live,
// locally-managed stone — lives here rather than on the Sessions row: it copies
// the stone's extent files on the stone's own host, so it only makes sense for a
// Jasper-managed local database. Pin its placement so a future package.json edit
// can't quietly move or drop it.

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

describe('running stone row inline button order', () => {
  it('offers an online extent backup ahead of the lifecycle stop action', () => {
    const order = inlineOrderFor('viewItem == gemstoneDbStoneRunning');

    expect(order).toEqual(['gemstone.onlineExtentBackup', 'gemstone.stopStone']);
  });

  it('surfaces the online extent backup on the running stone, not on the session row', () => {
    const onSession = itemContext.some(
      (m) =>
        m.command === 'gemstone.onlineExtentBackup' &&
        (m.when ?? '').includes('viewItem == gemstoneSession'),
    );
    const onRunningStone = itemContext.some(
      (m) =>
        m.command === 'gemstone.onlineExtentBackup' &&
        (m.when ?? '').includes('viewItem == gemstoneDbStoneRunning'),
    );

    expect(onSession).toBe(false);
    expect(onRunningStone).toBe(true);
  });
});
