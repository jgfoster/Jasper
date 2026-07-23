// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderClassEditorHtml } from '../renameClassEditorHtml';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameClassEditorView.js'), 'utf8');
  new Function(source)();
});

interface EditorApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    formatError: () => string;
    submit: () => void;
    handleMessage: (m: unknown) => void;
    refreshOptWarn: () => void;
  };
}
function api(): EditorApi {
  return (globalThis as unknown as { RenameClassEditor: EditorApi }).RenameClassEditor;
}

function mount(dictName?: string) {
  const full = renderClassEditorHtml({ oldName: 'Account', dictName, nonce: 'test', script: '' });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode, full };
}

function setName(v: string) {
  const input = document.getElementById('name') as HTMLInputElement;
  input.value = v;
  input.dispatchEvent(new Event('input'));
}

describe('rename-class editor', () => {
  it('defaults the reference scope to whole system', () => {
    const { full } = mount();

    expect(full).toContain('<option value="wholeSystem" selected>');
  });

  it('rejects a name that is not a valid identifier', () => {
    const { handle } = mount();

    setName('2bad');

    expect(handle.formatError()).toMatch(/must be a letter/i);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects renaming to the same name', () => {
    const { handle } = mount();

    setName('Account');

    expect(handle.formatError()).toMatch(/different/i);
  });

  it('submits the new name, scope, and options once valid', () => {
    const { vscode } = mount();

    setName('BankAccount');
    (document.getElementById('ok') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'ok',
      newName: 'BankAccount',
      scope: { kind: 'wholeSystem' },
      options: {
        copyMethods: true,
        recompileSubclasses: true,
        migrateInstances: true,
        removeOldFromHistory: false,
      },
    });
  });

  it('defaults options to copy=on, recompile=on, migrate=on, remove-from-history=off', () => {
    const { full } = mount();

    const opts = full.match(/<fieldset class="options">[\s\S]*?<\/fieldset>/)![0];
    expect(opts).toMatch(/id="optCopyMethods" checked/);
    expect(opts).toMatch(/id="optRecompileSubclasses" checked/);
    expect(opts).toMatch(/id="optMigrateInstances" checked/);
    expect(opts).toMatch(/id="optRemoveOldFromHistory">/); // no "checked"
  });

  it('reflects unchecked options in the submitted payload', () => {
    const { vscode } = mount();
    setName('BankAccount');
    (document.getElementById('optMigrateInstances') as HTMLInputElement).checked = false;
    (document.getElementById('optCopyMethods') as HTMLInputElement).checked = false;
    (document.getElementById('ok') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ migrateInstances: false, copyMethods: false }),
      }),
    );
  });

  it('shows a host rejection (name already in use) and re-enables OK to try again', () => {
    const { handle } = mount();
    setName('Existing');

    handle.handleMessage({ command: 'invalid', message: 'The name Existing is already in use.' });

    expect(document.getElementById('error')?.textContent).toMatch(/already in use/i);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a dictionary scope option when a dictionary name is given', () => {
    const { full } = mount('MyDict');

    expect(full).toContain('This dictionary (MyDict)');
  });

  it('warns when removing old versions without migrating (orphans instances)', () => {
    mount();

    (document.getElementById('optMigrateInstances') as HTMLInputElement).checked = false;
    (document.getElementById('optMigrateInstances') as HTMLInputElement).dispatchEvent(
      new Event('change'),
    );
    (document.getElementById('optRemoveOldFromHistory') as HTMLInputElement).checked = true;
    (document.getElementById('optRemoveOldFromHistory') as HTMLInputElement).dispatchEvent(
      new Event('change'),
    );

    expect(document.getElementById('optWarn')?.textContent).toMatch(/orphan/i);
  });

  it('clears the orphan warning once migrate is re-enabled', () => {
    const { handle } = mount();

    (document.getElementById('optRemoveOldFromHistory') as HTMLInputElement).checked = true;
    (document.getElementById('optMigrateInstances') as HTMLInputElement).checked = true;
    handle.refreshOptWarn();

    expect(document.getElementById('optWarn')?.textContent).toBe('');
  });
});
