// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate methodListView.js in jsdom so it registers the global MethodListView,
// exactly as the webview does when it injects the file as a <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../methodListView.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(source)();
});

type ClickMessage =
  | { command: 'showHierarchyImpls'; selector: string; direction: string }
  | { command: 'selectMethod'; selector: string }
  | null;

type MethodListViewApi = {
  makeOverrideArrow(selector: string, dir: 'up' | 'down'): HTMLSpanElement;
  applyOverrideArrows(div: HTMLElement, selector: string, methodOverrideBit: number): void;
  methodListClickMessage(event: { target: Element }, listEl: HTMLElement): ClickMessage;
};

function api(): MethodListViewApi {
  return (globalThis as unknown as { MethodListView: MethodListViewApi }).MethodListView;
}

// Build a method-list <div class="item"> the way populateColumn does, applying
// the override bits so arrows (if any) become real leading children.
function makeItem(selector: string, methodOverrideBit = 0): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'item';
  div.dataset.value = selector;
  if (methodOverrideBit) {
    api().applyOverrideArrows(div, selector, methodOverrideBit);
  } else {
    div.textContent = selector;
  }
  return div;
}

describe('MethodListView.makeOverrideArrow', () => {
  it('builds an up arrow (▲) carrying the selector and direction', () => {
    const span = api().makeOverrideArrow('printOn:', 'up');
    expect(span.textContent).toBe('▲');
    expect(span.className).toBe('override-arrow up');
    expect(span.dataset.value).toBe('printOn:');
    expect(span.dataset.dir).toBe('up');
    expect(span.title).toContain('Overrides a superclass');
  });

  it('builds a down arrow (▼) with the subclass tooltip', () => {
    const span = api().makeOverrideArrow('printOn:', 'down');
    expect(span.textContent).toBe('▼');
    expect(span.className).toBe('override-arrow down');
    expect(span.dataset.dir).toBe('down');
    expect(span.title).toContain('Overridden in a subclass');
  });
});

describe('MethodListView.applyOverrideArrows', () => {
  it('bit 1 renders only ▲ before the selector text', () => {
    const div = makeItem('size', 1);
    expect(div.querySelectorAll('.override-arrow')).toHaveLength(1);
    expect(div.querySelector('.override-arrow')!.textContent).toBe('▲');
    expect(div.textContent).toBe('▲size');
  });

  it('bit 2 renders only ▼ before the selector text', () => {
    const div = makeItem('size', 2);
    const arrows = div.querySelectorAll('.override-arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0].textContent).toBe('▼');
    expect(div.textContent).toBe('▼size');
  });

  it('bit 3 renders both ▲ and ▼ (in that order) then the selector', () => {
    const div = makeItem('new', 3);
    const arrows = [...div.querySelectorAll('.override-arrow')];
    expect(arrows.map(a => a.textContent)).toEqual(['▲', '▼']);
    expect(arrows.map(a => (a as HTMLElement).dataset.dir)).toEqual(['up', 'down']);
    // Selector text follows the arrows.
    expect(div.lastChild?.textContent).toBe('new');
    expect(div.textContent).toBe('▲▼new');
  });

  it('keeps dataset.value the bare selector so filtering/selection still match', () => {
    const div = makeItem('at:put:', 3);
    expect(div.dataset.value).toBe('at:put:');
  });
});

describe('MethodListView.methodListClickMessage', () => {
  it('clicking an arrow posts showHierarchyImpls with selector and direction', () => {
    const list = document.createElement('div');
    const item = makeItem('printOn:', 1);
    list.appendChild(item);
    const arrow = item.querySelector('.override-arrow')!;

    const msg = api().methodListClickMessage({ target: arrow }, list);

    expect(msg).toEqual({
      command: 'showHierarchyImpls',
      selector: 'printOn:',
      direction: 'up',
    });
  });

  it('clicking an arrow does NOT change the row selection', () => {
    const list = document.createElement('div');
    const item = makeItem('printOn:', 2);
    list.appendChild(item);
    const arrow = item.querySelector('.override-arrow')!;

    api().methodListClickMessage({ target: arrow }, list);

    expect(item.classList.contains('selected')).toBe(false);
  });

  it('clicking the selector text posts selectMethod and marks the row selected', () => {
    const list = document.createElement('div');
    const item = makeItem('size', 0);
    list.appendChild(item);

    const msg = api().methodListClickMessage({ target: item }, list);

    expect(msg).toEqual({ command: 'selectMethod', selector: 'size' });
    expect(item.classList.contains('selected')).toBe(true);
  });

  it('selecting a row clears the previously selected row', () => {
    const list = document.createElement('div');
    const first = makeItem('size', 0);
    const second = makeItem('name', 0);
    first.classList.add('selected');
    list.append(first, second);

    api().methodListClickMessage({ target: second }, list);

    expect(first.classList.contains('selected')).toBe(false);
    expect(second.classList.contains('selected')).toBe(true);
  });

  it('clicking empty space (neither arrow nor item) returns null', () => {
    const list = document.createElement('div');
    const msg = api().methodListClickMessage({ target: list }, list);
    expect(msg).toBeNull();
  });
});
