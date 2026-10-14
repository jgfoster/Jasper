import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type * as vscode from 'vscode';
import { window } from '../__mocks__/vscode';
import { LoginEditorPanel } from '../loginEditorPanel';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider } from '../loginTreeProvider';

/**
 * The login editor's script is inline in its HTML, so it is lifted out of the
 * page the panel builds and run against that same page, the way the webview
 * runs it.
 */
async function mount() {
  (LoginEditorPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
  const storage = new LoginStorage();
  await LoginEditorPanel.show(storage, {} as vscode.SecretStorage, new LoginTreeProvider(storage));
  const html: string = window.createWebviewPanel.mock.results.at(-1)?.value.webview.html;

  // `outside-only` leaves the page's own <script> unrun, so it is read back off the
  // DOM and evaluated once `acquireVsCodeApi` exists for it to call.
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const doc = dom.window.document;
  const win = dom.window as unknown as Window & {
    acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
    eval: (source: string) => void;
  };
  const posted: unknown[] = [];
  win.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
  win.eval(doc.querySelector('script')?.textContent ?? '');
  const select = () => doc.getElementById('version') as HTMLSelectElement;

  return {
    posted,
    select,
    send: (data: unknown) => win.dispatchEvent(new dom.window.MessageEvent('message', { data })),
    /** The heading a version is listed under, if any. */
    groupOf: (version: string): string | undefined => {
      const parent = [...select().options].find((o) => o.value === version)?.parentElement;
      return parent?.tagName === 'OPTGROUP' ? (parent as HTMLOptGroupElement).label : undefined;
    },
    save: () => (doc.getElementById('saveBtn') as HTMLButtonElement).click(),
  };
}

function loadData(version: string, versions: string[], downloadable: string[] = []) {
  return { command: 'loadData', data: { label: '', version }, versions, downloadable };
}

describe('the login editor version dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists versions only on the download site under their own heading', async () => {
    const page = await mount();

    page.send(loadData('3.7.5', ['3.7.5'], ['3.7.6']));

    expect(page.groupOf('3.7.5')).toBeUndefined();
    expect(page.groupOf('3.7.6')).toContain('Not installed');
  });

  it('chooses the newest downloadable version when nothing is installed', async () => {
    const page = await mount();
    page.send(loadData('', []));

    page.send({ command: 'downloadableVersions', downloadable: ['3.7.6', '3.7.5'] });

    expect(page.select().value).toBe('3.7.6');
  });

  it('keeps the chosen version when the downloadable versions arrive', async () => {
    const page = await mount();
    page.send(loadData('3.6.2', ['3.7.5', '3.6.2']));

    page.send({ command: 'downloadableVersions', downloadable: ['3.7.6'] });

    expect(page.select().value).toBe('3.6.2');
    expect([...page.select().options].map((o) => o.value)).toEqual(['3.7.5', '3.6.2', '3.7.6']);
  });

  it('saves a version that is not installed yet like any other', async () => {
    const page = await mount();
    page.send(loadData('', []));
    page.send({ command: 'downloadableVersions', downloadable: ['3.7.6'] });

    page.save();

    expect(page.posted.at(-1)).toEqual(
      expect.objectContaining({
        command: 'save',
        data: expect.objectContaining({ version: '3.7.6' }),
      }),
    );
  });
});
