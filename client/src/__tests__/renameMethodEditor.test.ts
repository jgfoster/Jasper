// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderMethodEditorHtml } from '../renameMethodEditorHtml';

// Evaluate renameMethodEditorView.js in jsdom so it registers the global
// RenameMethodEditor, exactly as the webview does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameMethodEditorView.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(source)();
});

interface EditorApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): {
    parts: () => string[];
    originalIndices: () => number[];
    updatePreview: () => void;
    move: (li: Element, dir: number) => void;
  };
}

function api(): EditorApi {
  return (globalThis as unknown as { RenameMethodEditor: EditorApi }).RenameMethodEditor;
}

function mount(oldSelector: string, argNames: string[], dictName?: string) {
  const html = renderMethodEditorHtml({
    className: 'Foo', oldSelector, isMeta: false, argNames, dictName, nonce: 'test',
    script: '',
  });
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode };
}

describe('keyword-part editor', () => {
  it('shows the current selector and its parts initially', () => {
    const { handle } = mount('copyFrom:to:', ['start', 'stop']);

    expect(handle.parts()).toEqual(['copyFrom:', 'to:']);
    expect(handle.originalIndices()).toEqual([1, 2]);
    expect(document.getElementById('sel')?.textContent).toBe('copyFrom:to:');
  });

  it('rebuilds the previewed selector as parts are edited', () => {
    mount('copyFrom:to:', ['start', 'stop']);
    const inputs = document.querySelectorAll<HTMLInputElement>('input.part');

    inputs[0].value = 'copyTo:';
    inputs[1].value = 'from:';
    inputs[0].dispatchEvent(new Event('input'));

    expect(document.getElementById('sel')?.textContent).toBe('copyTo:from:');
  });

  it('moves a keyword and its argument together when reordering', () => {
    const { handle } = mount('copyFrom:to:', ['start', 'stop']);
    const rows = document.querySelectorAll('li.kwrow');

    handle.move(rows[1], -1);

    expect(handle.parts()).toEqual(['to:', 'copyFrom:']);
    expect(handle.originalIndices()).toEqual([2, 1]);
  });

  it('reports parts, permutation, and scope on confirm', () => {
    const { handle, vscode } = mount('copyFrom:to:', ['start', 'stop']);
    const inputs = document.querySelectorAll<HTMLInputElement>('input.part');
    inputs[0].value = 'copyTo:';
    inputs[1].value = 'from:';
    const rows = document.querySelectorAll('li.kwrow');
    handle.move(rows[1], -1);

    (document.getElementById('ok') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'ok',
      parts: ['from:', 'copyTo:'],
      originalIndices: [2, 1],
      scope: { kind: 'hierarchy' },
    });
  });

  it('has no arguments and an empty permutation for a unary selector', () => {
    const { handle } = mount('size', []);

    expect(handle.parts()).toEqual(['size']);
    expect(handle.originalIndices()).toEqual([]);
  });

  it('disables confirm when a part is emptied', () => {
    mount('copyFrom:to:', ['start', 'stop']);
    const input = document.querySelector<HTMLInputElement>('input.part')!;

    input.value = '';
    input.dispatchEvent(new Event('input'));

    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });
});
