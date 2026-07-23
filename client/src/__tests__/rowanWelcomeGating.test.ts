import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// A `when` clause reads an unset context key as false. Before the extension
// activates, `gemstone.workspaceIsRowanProject` is unset — so a welcome gated on
// the bare negation renders "This folder isn't a Rowan project" over a folder
// that is one, until activation sets the key. Gating on a separate "we have
// looked" key keeps that claim off screen until the answer is actually known.
const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

interface Welcome {
  view: string;
  contents: string;
  when?: string;
}

const notAProject: Welcome | undefined = pkg.contributes.viewsWelcome.find(
  (w: Welcome) => w.view === 'gemstoneRowan' && w.contents.includes("isn't a Rowan project"),
);

describe('the Rowan welcome offering to create a project', () => {
  it('is contributed', () => {
    expect(notAProject).toBeDefined();
  });

  it('waits for the project check to have run before calling a folder a non-project', () => {
    expect(notAProject?.when).toContain('gemstone.rowanProjectChecked');
  });

  it('still shows only when the folder is not already a Rowan project', () => {
    expect(notAProject?.when).toContain('!gemstone.workspaceIsRowanProject');
  });
});
