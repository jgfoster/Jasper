// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate methodListView.js in jsdom so it registers the global MethodListView,
// exactly as the webview does when it injects the file as a <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../methodListView.js'), 'utf8');
  new Function(source)();
});

type ClickMessage =
  | { command: 'showHierarchyImpls'; selector: string; direction: string }
  | { command: 'selectMethod'; selector: string }
  | null;

type MethodListViewApi = {
  makeOverrideArrow(selector: string, dir: 'up' | 'down'): HTMLSpanElement;
  makeSessionIndicator(selector: string, sessionBit: number): HTMLSpanElement;
  applyOverrideArrows(div: HTMLElement, selector: string, methodOverrideBit: number): void;
  applyMethodIndicators(
    div: HTMLElement,
    selector: string,
    methodOverrideBit: number,
    sessionBit: number,
  ): void;
  methodListClickMessage(event: { target: Element }, listEl: HTMLElement): ClickMessage;
};

function api(): MethodListViewApi {
  return (globalThis as unknown as { MethodListView: MethodListViewApi }).MethodListView;
}

// Build a method-list <div class="item"> the way populateColumn does for the
// methods column: always render the indicator gutter (empty when there are no
// indicators) so names align.
function makeItem(selector: string, methodOverrideBit = 0, sessionBit = 0): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'item';
  div.dataset.value = selector;
  api().applyMethodIndicators(div, selector, methodOverrideBit, sessionBit);
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

  it('carries the triangle in an inner glyph so shrinking it never narrows the slot', () => {
    const span = api().makeOverrideArrow('size', 'up');
    const glyph = span.querySelector('.indicator-glyph');

    expect(glyph).not.toBeNull();
    expect(glyph!.textContent).toBe('▲');
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
    expect(arrows.map((a) => a.textContent)).toEqual(['▲', '▼']);
    expect(arrows.map((a) => (a as HTMLElement).dataset.dir)).toEqual(['up', 'down']);
    // Selector text follows the arrows.
    expect(div.lastChild?.textContent).toBe('new');
    expect(div.textContent).toBe('▲▼new');
  });

  it('keeps dataset.value the bare selector so filtering/selection still match', () => {
    const div = makeItem('at:put:', 3);
    expect(div.dataset.value).toBe('at:put:');
  });
});

describe('MethodListView.makeSessionIndicator', () => {
  it('builds the extension glyph (+) with the extension tooltip', () => {
    const span = api().makeSessionIndicator('isVowel', 1);
    expect(span.textContent).toBe('+');
    expect(span.className).toBe('session-indicator extension');
    expect(span.title).toContain('adds new behavior');
  });

  it('builds the override glyph (±) whose tooltip names the ± icon and the compare action', () => {
    const span = api().makeSessionIndicator('isVowel', 2);
    expect(span.textContent).toBe('±');
    expect(span.className).toBe('session-indicator override');
    expect(span.title).toContain('±');
    expect(span.title).toContain('compare');
  });
});

describe('MethodListView.applyMethodIndicators session methods', () => {
  it('marks an extension row italic and prefixes the + glyph', () => {
    const div = makeItem('isVowel', 0, 1);
    expect(div.classList.contains('session-extension')).toBe(true);
    expect(div.querySelector('.session-indicator')!.textContent).toBe('+');
    expect(div.textContent).toBe('+isVowel');
  });

  it('marks an override row italic and prefixes the ± glyph', () => {
    const div = makeItem('isVowel', 0, 2);
    expect(div.classList.contains('session-override')).toBe(true);
    expect(div.querySelector('.session-indicator')!.textContent).toBe('±');
  });

  it('describes the session method on the whole row, without the click hint (that lives on the ± glyph)', () => {
    const div = makeItem('isVowel', 0, 2);
    expect(div.title).toContain('overrides a persistent base method');
    expect(div.title.toLowerCase()).not.toContain('click');
  });

  it('renders override arrows before the session glyph when a method is both', () => {
    const div = makeItem('printOn:', 1, 1);
    const slots = [...div.querySelector('.method-gutter')!.children];
    expect(slots[0].textContent).toBe('▲');
    expect(slots[1].textContent).toBe('');
    expect(slots[2].textContent).toBe('+');
    expect(div.textContent).toBe('▲+printOn:');
    expect(div.classList.contains('session-extension')).toBe(true);
  });

  it('leaves a non-session row unstyled and glyph-free', () => {
    const div = makeItem('size', 1, 0);
    expect(div.querySelector('.session-indicator')).toBeNull();
    expect(div.classList.contains('session-extension')).toBe(false);
    expect(div.classList.contains('session-override')).toBe(false);
  });

  it('keeps dataset.value the bare selector so filtering/selection still match', () => {
    const div = makeItem('at:put:', 0, 2);
    expect(div.dataset.value).toBe('at:put:');
  });
});

describe('MethodListView indicator gutter', () => {
  it('holds three fixed slots in up, down, session order when all markers are present', () => {
    const div = makeItem('new', 3, 2);
    const gutters = div.querySelectorAll('.method-gutter');

    expect(gutters).toHaveLength(1);
    expect([...gutters[0].children].map((c) => c.textContent)).toEqual(['▲', '▼', '±']);
  });

  it('renders three empty slots for a method with no markers so its name still aligns', () => {
    const div = makeItem('size', 0, 0);
    const gutter = div.querySelector('.method-gutter')!;

    expect(gutter.children).toHaveLength(3);
    expect(gutter.textContent).toBe('');
    expect(gutter.querySelector('.override-arrow, .session-indicator')).toBeNull();
    expect(div.textContent).toBe('size');
  });

  it('keeps the down arrow in the second slot even when the up arrow is absent', () => {
    const upOnly = [...makeItem('a', 1, 0).querySelector('.method-gutter')!.children];
    const downOnly = [...makeItem('b', 2, 0).querySelector('.method-gutter')!.children];

    expect(upOnly.map((s) => s.textContent)).toEqual(['▲', '', '']);
    expect(downOnly.map((s) => s.textContent)).toEqual(['', '▼', '']);
  });

  it('keeps the session glyph in the third slot regardless of the arrows', () => {
    const sessionOnly = [...makeItem('x', 0, 1).querySelector('.method-gutter')!.children];

    expect(sessionOnly.map((s) => s.textContent)).toEqual(['', '', '+']);
  });

  it('fills an absent marker with a non-interactive placeholder slot, not an arrow/glyph', () => {
    const div = makeItem('b', 2, 0);
    const gutter = div.querySelector('.method-gutter')!;
    const emptyUpSlot = gutter.children[0];
    const emptySessionSlot = gutter.children[2];

    expect(emptyUpSlot.classList.contains('indicator-slot')).toBe(true);
    expect(emptyUpSlot.classList.contains('override-arrow')).toBe(false);
    // Each placeholder matches the width class of the marker it stands in for.
    expect(emptyUpSlot.classList.contains('arrow')).toBe(true);
    expect(emptySessionSlot.classList.contains('session')).toBe(true);
  });

  it('places the selector text after the gutter, not inside it', () => {
    const div = makeItem('printOn:', 1, 0);

    expect(div.firstElementChild!.className).toBe('method-gutter');
    expect(div.lastChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(div.lastChild!.textContent).toBe('printOn:');
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

  it('clicking the inner triangle glyph still posts showHierarchyImpls for its arrow', () => {
    const list = document.createElement('div');
    const item = makeItem('printOn:', 2);
    list.appendChild(item);
    const glyph = item.querySelector('.override-arrow .indicator-glyph')!;

    const msg = api().methodListClickMessage({ target: glyph }, list);

    expect(msg).toEqual({
      command: 'showHierarchyImpls',
      selector: 'printOn:',
      direction: 'down',
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

  it('clicking the override glyph asks to compare with the base method', () => {
    const list = document.createElement('div');
    const item = makeItem('isVowel', 0, 2);
    list.appendChild(item);
    const glyph = item.querySelector('.session-indicator')!;

    const msg = api().methodListClickMessage({ target: glyph }, list);

    expect(msg).toEqual({ command: 'compareSessionOverride', selector: 'isVowel' });
    expect(item.classList.contains('selected')).toBe(true);
  });

  it('clicking the extension glyph just selects the method (no base to compare)', () => {
    const list = document.createElement('div');
    const item = makeItem('jasperGreeting', 0, 1);
    list.appendChild(item);
    const glyph = item.querySelector('.session-indicator')!;

    const msg = api().methodListClickMessage({ target: glyph }, list);

    expect(msg).toEqual({ command: 'selectMethod', selector: 'jasperGreeting' });
    expect(item.classList.contains('selected')).toBe(true);
  });

  it('clicking empty space (neither arrow nor item) returns null', () => {
    const list = document.createElement('div');
    const msg = api().methodListClickMessage({ target: list }, list);
    expect(msg).toBeNull();
  });

  it('clicking an empty indicator slot just selects the method', () => {
    const list = document.createElement('div');
    const item = makeItem('size', 2, 0);
    list.appendChild(item);
    const emptyUpSlot = item.querySelector('.method-gutter')!.children[0];

    const msg = api().methodListClickMessage({ target: emptyUpSlot }, list);

    expect(msg).toEqual({ command: 'selectMethod', selector: 'size' });
    expect(item.classList.contains('selected')).toBe(true);
  });
});
