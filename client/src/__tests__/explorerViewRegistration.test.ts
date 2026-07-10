import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// GemStone Explorer views are created eagerly with `vscode.window.createTreeView`
// when the extension activates (gemstoneExplorer.ts / explorerOpenEditors.ts).
// VS Code registers a contributed view only once its `when` clause is satisfied,
// and createTreeView throws "No view is registered with id: <id>" for a view
// whose `when` is still false. So an eagerly-created view must NOT be gated on a
// context key that is false at activation/login.
//
// `gemstone.explorerHasOpenEditors` is exactly such a key — it can only become
// true after a gemstone:// editor is opened, which is never the case at login,
// when nothing is open yet. Gating the Open Editors pane on it made the pane
// error "No view is registered with id: gemstoneExplorerOpenEditors" on every
// login (shipped in 1.8.1). This guards against reintroducing that dependency.
const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const explorerViews: Array<{ id: string; when?: string }> =
  pkg.contributes.views.gemstoneExplorer;

describe('GemStone Explorer views are registrable when created', () => {
  it('registers an Open Editors pane', () => {
    const ids = explorerViews.map((v) => v.id);

    expect(ids).toContain('gemstoneExplorerOpenEditors');
  });

  it('gates the Open Editors pane on an active session, not on open-editor content', () => {
    const openEditors = explorerViews.find((v) => v.id === 'gemstoneExplorerOpenEditors');

    expect(openEditors?.when).toBe('gemstone.explorerActive');
  });

  it.each(explorerViews)('does not gate $id on a content key that is false at login', (view) => {
    expect(view.when ?? '').not.toContain('explorerHasOpenEditors');
  });
});
