// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Register the ListFilter custom element once by evaluating its source in jsdom.
// We use new Function() (indirect eval) so the code runs in global scope where
// customElements, document, and HTMLElement are all available from jsdom.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  const source = fs.readFileSync(path.resolve(__dirname, '../listFilter.js'), 'utf8');
  new Function(source)();
});

// ── Types ─────────────────────────────────────────────────────

type ListFilterClass = {
  new(): ListFilterInstance;
  clearAllFilters(): void;
  refreshFilterOf(listElement: HTMLElement): void;
};

type ListFilterInstance = HTMLElement & {
  applyFilter(): void;
  clearFilter(): void;
  matchQuery(text: string, query: string): { start: number; end: number; text: string } | null;
  moveFocusedItemBy(offset: number): void;
  matchedItems: HTMLElement[];
  focusedIndex: number;
  searchBox: HTMLInputElement;
};

// ── Helpers ────────────────────────────────────────────────────

function getListFilterClass(): ListFilterClass {
  return customElements.get('list-filter') as unknown as ListFilterClass;
}

function makeList(id: string, items: string[]): HTMLDivElement {
  const list = document.createElement('div');
  list.id = id;
  for (const value of items) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.value = value;
    div.textContent = value;
    list.appendChild(div);
  }
  document.body.appendChild(list);
  return list;
}

function makeFilter(listId: string): ListFilterInstance {
  const el = document.createElement('list-filter');
  el.setAttribute('for', listId);
  document.body.appendChild(el);
  return el as unknown as ListFilterInstance;
}

// ── Tests ─────────────────────────────────────────────────────

describe('ListFilter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('list-filter-styles')?.remove();
  });

  describe('matchQuery', () => {
    let filter: ListFilterInstance;

    beforeEach(() => {
      makeList('items', []);
      filter = makeFilter('items');
    });

    it('returns null when query is not found', () => {
      expect(filter.matchQuery('Array', 'xyz')).toBeNull();
    });

    it('returns match with correct start and end for a substring match', () => {
      // 'collection'.indexOf('lect') === 3
      const result = filter.matchQuery('Collection', 'lect');
      expect(result).toEqual({ start: 3, end: 7, text: 'Collection' });
    });

    it('matches at the start of the string', () => {
      const result = filter.matchQuery('Array', 'arr');
      expect(result).toEqual({ start: 0, end: 3, text: 'Array' });
    });

    it('matches at the end of the string', () => {
      const result = filter.matchQuery('Object', 'ect');
      expect(result).toEqual({ start: 3, end: 6, text: 'Object' });
    });

    it('matches regardless of the case of the text', () => {
      // matchQuery lowercases the text before searching
      expect(filter.matchQuery('Array', 'arr')).not.toBeNull();
      expect(filter.matchQuery('ARRAY', 'arr')).not.toBeNull();
    });

    it('requires the query to be pre-lowercased (callers must normalize)', () => {
      // applyFilter lowercases the query before calling matchQuery
      expect(filter.matchQuery('Array', 'ARR')).toBeNull();
    });

    it('matches the first occurrence when the query appears multiple times', () => {
      const result = filter.matchQuery('abcabc', 'bc');
      expect(result).toEqual({ start: 1, end: 3, text: 'abcabc' });
    });
  });

  describe('applyFilter with empty query', () => {
    it('renders all items as plain text with no highlights', () => {
      makeList('items', ['Array', 'Bag', 'Set']);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const items = document.querySelectorAll('#items .item');
      items.forEach(item => {
        expect(item.querySelector('.match-highlight')).toBeNull();
        expect(item.textContent).toBe((item as HTMLElement).dataset.value);
      });
    });

    it('has no matchedItems when query is empty', () => {
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(0);
    });
  });

  describe('applyFilter with a query', () => {
    it('adds matching items to matchedItems', () => {
      makeList('items', ['Array', 'Bag', 'Barcode']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'Ba';
      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(2);
    });

    it('does not include non-matching items in matchedItems', () => {
      makeList('items', ['Array', 'Bag', 'Set']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(1);
      expect((filter.matchedItems[0] as HTMLElement).dataset.value).toBe('Array');
    });

    it('adds a match-highlight span for the matched portion', () => {
      makeList('items', ['Collection']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'lect';
      filter.applyFilter();

      const item = document.querySelector('#items .item')!;
      const highlight = item.querySelector('.match-highlight');
      expect(highlight).not.toBeNull();
      expect(highlight!.textContent).toBe('lect');
    });

    it('renders text before the match as a text node', () => {
      makeList('items', ['Collection']);
      const filter = makeFilter('items');

      // 'lect' matches at index 3: "Col" is before the match
      filter.searchBox.value = 'lect';
      filter.applyFilter();

      const item = document.querySelector('#items .item')!;
      expect(item.firstChild!.nodeType).toBe(Node.TEXT_NODE);
      expect(item.firstChild!.textContent).toBe('Col');
    });

    it('renders text after the match as a text node', () => {
      makeList('items', ['Collection']);
      const filter = makeFilter('items');

      // 'lect' at index 3, end index 7: "ion" remains after
      filter.searchBox.value = 'lect';
      filter.applyFilter();

      const item = document.querySelector('#items .item')!;
      expect(item.lastChild!.nodeType).toBe(Node.TEXT_NODE);
      expect(item.lastChild!.textContent).toBe('ion');
    });

    it('renders no text node before a match at position 0', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      const item = document.querySelector('#items .item')!;
      expect(item.firstChild!.nodeName).toBe('SPAN');
    });

    it('renders no text node after a match at the end', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'ray';
      filter.applyFilter();

      const item = document.querySelector('#items .item')!;
      expect(item.lastChild!.nodeName).toBe('SPAN');
    });

    it('restores non-matching items to plain textContent', () => {
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      const items = document.querySelectorAll('#items .item');
      const bag = Array.from(items).find(el => (el as HTMLElement).dataset.value === 'Bag')!;
      expect(bag.textContent).toBe('Bag');
      expect(bag.querySelector('.match-highlight')).toBeNull();
    });

    it('is case-insensitive', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'ARRAY';
      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(1);
    });
  });

  describe('hiding non-matching items', () => {
    function isHidden(el: Element): boolean {
      return el.classList.contains('filter-hidden');
    }

    it('hides items that do not match the query', () => {
      makeList('items', ['Array', 'Bag', 'Set']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      const items = [...document.querySelectorAll('#items .item')] as HTMLElement[];
      const shown = items.filter(el => !isHidden(el)).map(el => el.dataset.value);
      expect(shown).toEqual(['Array']);
    });

    it('keeps every matching item visible', () => {
      makeList('items', ['Array', 'Bag', 'Barcode']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'ba';
      filter.applyFilter();

      const items = [...document.querySelectorAll('#items .item')] as HTMLElement[];
      const shown = items.filter(el => !isHidden(el)).map(el => el.dataset.value);
      expect(shown).toEqual(['Bag', 'Barcode']);
    });

    it('shows every item again when the query is cleared', () => {
      makeList('items', ['Array', 'Bag', 'Set']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();
      filter.clearFilter();

      const items = [...document.querySelectorAll('#items .item')];
      expect(items.every(el => !isHidden(el))).toBe(true);
    });

    it('re-reveals an item when a later query matches it after an earlier one hid it', () => {
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();
      const bag = [...document.querySelectorAll('#items .item')].find(
        el => (el as HTMLElement).dataset.value === 'Bag')!;
      expect(isHidden(bag)).toBe(true);

      filter.searchBox.value = 'ba';
      filter.applyFilter();
      expect(isHidden(bag)).toBe(false);
    });
  });

  describe('keyboard focus after applyFilter', () => {
    it('sets focusedIndex to 0 when there are matches', () => {
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      expect(filter.focusedIndex).toBe(0);
    });

    it('adds keyboard-cursor class to the first matched item', () => {
      makeList('items', ['Array', 'Bag', 'Barcode']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'ba';
      filter.applyFilter();

      expect(filter.matchedItems[0].classList.contains('keyboard-cursor')).toBe(true);
    });

    it('leaves focusedIndex at -1 when no items match', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'xyz';
      filter.applyFilter();

      expect(filter.focusedIndex).toBe(-1);
    });
  });

  describe('moveFocusedItemBy', () => {
    let filter: ListFilterInstance;

    beforeEach(() => {
      makeList('items', ['Array', 'Bag', 'Set']);
      filter = makeFilter('items');
      filter.searchBox.value = 'a';
      filter.applyFilter(); // 'Array' and 'Bag' match; focusedIndex = 0
    });

    it('moves forward by 1', () => {
      filter.moveFocusedItemBy(1);
      expect(filter.focusedIndex).toBe(1);
    });

    it('wraps from the last item to the first on ArrowDown', () => {
      filter.moveFocusedItemBy(1); // index 1
      filter.moveFocusedItemBy(1); // would be 2, but only 2 items → wraps to 0
      expect(filter.focusedIndex).toBe(0);
    });

    it('wraps from the first item to the last on ArrowUp', () => {
      filter.moveFocusedItemBy(-1); // from 0 → last (index 1)
      expect(filter.focusedIndex).toBe(filter.matchedItems.length - 1);
    });

    it('moves backward by 1 from a mid-list position', () => {
      filter.moveFocusedItemBy(1); // index 1
      filter.moveFocusedItemBy(-1); // back to 0
      expect(filter.focusedIndex).toBe(0);
    });
  });

  describe('clearFilter', () => {
    it('clears the search box value', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.clearFilter();

      expect(filter.searchBox.value).toBe('');
    });

    it('clears matchedItems', () => {
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'a';
      filter.applyFilter();
      expect(filter.matchedItems.length).toBeGreaterThan(0);

      filter.clearFilter();
      expect(filter.matchedItems).toHaveLength(0);
    });

    it('restores items to plain text', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();
      filter.clearFilter();

      const item = document.querySelector('#items .item')!;
      expect(item.querySelector('.match-highlight')).toBeNull();
      expect(item.textContent).toBe('Array');
    });
  });

  describe('clearAllFilters (static)', () => {
    it('calls clearFilter on every list-filter element in the document', () => {
      makeList('list-a', ['Alpha', 'Beta']);
      makeList('list-b', ['One', 'Two']);
      const filterA = makeFilter('list-a');
      const filterB = makeFilter('list-b');

      filterA.searchBox.value = 'al';
      filterA.applyFilter();
      filterB.searchBox.value = 'on';
      filterB.applyFilter();

      expect(filterA.matchedItems).toHaveLength(1);
      expect(filterB.matchedItems).toHaveLength(1);

      getListFilterClass().clearAllFilters();

      expect(filterA.searchBox.value).toBe('');
      expect(filterA.matchedItems).toHaveLength(0);
      expect(filterB.searchBox.value).toBe('');
      expect(filterB.matchedItems).toHaveLength(0);
    });
  });

  describe('has-text CSS class', () => {
    it('adds has-text class when query is non-empty', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();

      expect(filter.classList.contains('has-text')).toBe(true);
    });

    it('removes has-text class when query is empty', () => {
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.applyFilter();
      filter.clearFilter();

      expect(filter.classList.contains('has-text')).toBe(false);
    });
  });

  describe('refreshFilterOf', () => {
    it('applies the current filter to the given list element', () => {
      const list = makeList('items', ['Array', 'Bag', 'Barrage']);
      const filter = makeFilter('items');
      filter.searchBox.value = 'arr';

      getListFilterClass().refreshFilterOf(list);

      expect(filter.matchedItems).toHaveLength(2);
      expect(filter.matchedItems.map(el => (el as HTMLElement).dataset.value)).toEqual(['Array', 'Barrage']);
    });

    it('picks up a changed query when called after searchBox value changes', () => {
      const list = makeList('items', ['Array', 'Bag', 'Barrage']);
      const filter = makeFilter('items');
      filter.searchBox.value = 'arr';
      filter.applyFilter();
      expect(filter.matchedItems).toHaveLength(2);

      filter.searchBox.value = 'bag';
      getListFilterClass().refreshFilterOf(list);

      expect(filter.matchedItems).toHaveLength(1);
      expect((filter.matchedItems[0] as HTMLElement).dataset.value).toBe('Bag');
    });

    it('re-applies the active filter against new children after list repopulation', () => {
      const list = makeList('items', ['OldClass']);
      const filter = makeFilter('items');
      filter.searchBox.value = 'arr';
      filter.applyFilter(); // user has an active query

      // Server repopulates the list — replace contents using makeList's schema
      list.innerHTML = '';
      makeList('items-tmp', ['Array', 'Bag', 'Barrage'])
        .querySelectorAll('.item')
        .forEach(el => list.appendChild(el));

      getListFilterClass().refreshFilterOf(list);

      expect(filter.matchedItems).toHaveLength(2);
      expect(filter.matchedItems.map(el => (el as HTMLElement).dataset.value)).toEqual(['Array', 'Barrage']);
    });

    it('does nothing when no filter is associated with the list element', () => {
      const list = makeList('unfiltered-list', ['Array', 'Bag']);
      const before = list.innerHTML;

      getListFilterClass().refreshFilterOf(list);

      expect(list.innerHTML).toBe(before);
    });

    it('does nothing when the list element has no id', () => {
      const list = document.createElement('div');
      const before = list.innerHTML;

      getListFilterClass().refreshFilterOf(list);

      expect(list.innerHTML).toBe(before);
    });

    it('throws when more than one filter is defined for the same list', () => {
      const list = makeList('items', ['Array', 'Bag']);
      makeFilter('items');
      makeFilter('items');

      expect(() => getListFilterClass().refreshFilterOf(list)).toThrow('Found 2 list-filter elements for #items — only one filter per list is supported.');
    });

    it('finds the filter when the list id contains a double quote', () => {
      const list = makeList('list"items', ['Array', 'Bag']);
      const filter = makeFilter('list"items');
      filter.searchBox.value = 'arr';

      getListFilterClass().refreshFilterOf(list);

      expect(filter.matchedItems).toHaveLength(1);
      expect((filter.matchedItems[0] as HTMLElement).dataset.value).toBe('Array');
    });
  });

  describe('list() lazy loading', () => {
    it('does nothing when the list element is not yet in the DOM', () => {
      const filter = makeFilter('items');
      filter.searchBox.value = 'arr';

      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(0);
    });

    it('applies the filter once the list is added to the DOM after a failed lookup', () => {
      const filter = makeFilter('items');
      filter.searchBox.value = 'arr';
      filter.applyFilter(); // list not in DOM yet — no-op

      makeList('items', ['Array', 'Bag']);
      filter.applyFilter();

      expect(filter.matchedItems).toHaveLength(1);
      expect((filter.matchedItems[0] as HTMLElement).dataset.value).toBe('Array');
    });
  });

  describe('connectedCallback', () => {
    it('renders an input and a clear button', () => {
      makeList('items', []);
      const filter = makeFilter('items');

      expect(filter.querySelector('input')).not.toBeNull();
      expect(filter.querySelector('.clear-btn')).not.toBeNull();
    });

    it('injects styles into the document head exactly once', () => {
      makeList('a', []);
      makeList('b', []);
      makeFilter('a');
      makeFilter('b');

      expect(document.querySelectorAll('#list-filter-styles')).toHaveLength(1);
    });
  });

  describe('input debounce', () => {
    it('does not apply the filter immediately when typing', () => {
      vi.useFakeTimers();
      makeList('items', ['Array']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.searchBox.dispatchEvent(new Event('input'));

      // matchedItems hasn't changed yet (debounce pending)
      expect(filter.matchedItems).toHaveLength(0);

      vi.useRealTimers();
    });

    it('applies the filter after 150 ms', () => {
      vi.useFakeTimers();
      makeList('items', ['Array', 'Bag']);
      const filter = makeFilter('items');

      filter.searchBox.value = 'arr';
      filter.searchBox.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(150);

      expect(filter.matchedItems).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  // The method list prepends override-indicator arrows (▲/▼) as leading
  // children of each item. ListFilter rewrites item text on every render, so it
  // must preserve those arrows rather than wipe them.
  describe('override-arrow preservation', () => {
    function makeListWithArrows(
      id: string, specs: Array<{ selector: string; dirs: Array<'up' | 'down'> }>,
    ): HTMLDivElement {
      const list = document.createElement('div');
      list.id = id;
      for (const { selector, dirs } of specs) {
        const div = document.createElement('div');
        div.className = 'item';
        div.dataset.value = selector;
        for (const dir of dirs) {
          const span = document.createElement('span');
          span.className = 'override-arrow ' + dir;
          span.textContent = dir === 'up' ? '▲' : '▼';
          div.appendChild(span);
        }
        div.appendChild(document.createTextNode(selector));
        list.appendChild(div);
      }
      document.body.appendChild(list);
      return list;
    }

    it('keeps the arrow and rebuilds selector text on an unmatched (empty) render', () => {
      makeListWithArrows('items', [{ selector: 'size', dirs: ['up'] }]);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.querySelectorAll('.override-arrow')).toHaveLength(1);
      expect(item.firstElementChild?.textContent).toBe('▲');
      expect(item.textContent).toBe('▲size');
    });

    it('keeps the arrow and still highlights the match on a matched render', () => {
      makeListWithArrows('items', [{ selector: 'size', dirs: ['down'] }]);
      const filter = makeFilter('items');

      filter.searchBox.value = 'iz';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.querySelectorAll('.override-arrow')).toHaveLength(1);
      expect(item.firstElementChild?.classList.contains('override-arrow')).toBe(true);
      expect(item.querySelector('.match-highlight')?.textContent).toBe('iz');
      // Arrow precedes the rebuilt selector text.
      expect(item.textContent).toBe('▼size');
    });

    it('preserves both arrows for a selector that is overridden and overriding', () => {
      makeListWithArrows('items', [{ selector: 'new', dirs: ['up', 'down'] }]);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const arrows = document.querySelectorAll('#items .item .override-arrow');
      expect([...arrows].map(a => a.textContent)).toEqual(['▲', '▼']);
      expect((document.querySelector('#items .item') as HTMLElement).textContent).toBe('▲▼new');
    });
  });

  // Session methods prepend a glyph (+ extension / ± override) as a leading
  // child, the same way override arrows do. ListFilter must preserve it too.
  describe('session-glyph preservation', () => {
    function makeListWithSession(
      id: string, specs: Array<{ selector: string; glyph: string; arrow?: boolean }>,
    ): HTMLDivElement {
      const list = document.createElement('div');
      list.id = id;
      for (const { selector, glyph, arrow } of specs) {
        const div = document.createElement('div');
        div.className = 'item';
        div.dataset.value = selector;
        if (arrow) {
          const a = document.createElement('span');
          a.className = 'override-arrow up';
          a.textContent = '▲';
          div.appendChild(a);
        }
        const g = document.createElement('span');
        g.className = 'session-indicator';
        g.textContent = glyph;
        div.appendChild(g);
        div.appendChild(document.createTextNode(selector));
        list.appendChild(div);
      }
      document.body.appendChild(list);
      return list;
    }

    it('keeps the session glyph and rebuilds selector text on an empty render', () => {
      makeListWithSession('items', [{ selector: 'jasperGreeting', glyph: '+' }]);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.querySelectorAll('.session-indicator')).toHaveLength(1);
      expect(item.textContent).toBe('+jasperGreeting');
    });

    it('keeps the session glyph and highlights the match on a matched render', () => {
      makeListWithSession('items', [{ selector: 'isVowel', glyph: '±' }]);
      const filter = makeFilter('items');

      filter.searchBox.value = 'vow';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.querySelectorAll('.session-indicator')).toHaveLength(1);
      expect(item.querySelector('.match-highlight')?.textContent).toBe('Vow');
    });

    it('preserves an override arrow and the session glyph together, arrow first', () => {
      makeListWithSession('items', [{ selector: 'printOn:', glyph: '+', arrow: true }]);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      const leading = [...item.children].map(c => c.className);
      expect(leading).toEqual(['override-arrow up', 'session-indicator']);
      expect(item.textContent).toBe('▲+printOn:');
    });
  });

  // The methods column wraps its indicators in a fixed-width .method-gutter so
  // names align. ListFilter must keep that gutter (and its contents) intact.
  describe('indicator-gutter preservation', () => {
    function makeListWithGutter(id: string, selector: string, arrow: boolean): HTMLDivElement {
      const list = document.createElement('div');
      list.id = id;
      const div = document.createElement('div');
      div.className = 'item';
      div.dataset.value = selector;
      const gutter = document.createElement('span');
      gutter.className = 'method-gutter';
      if (arrow) {
        const a = document.createElement('span');
        a.className = 'override-arrow up';
        a.textContent = '▲';
        gutter.appendChild(a);
      }
      div.appendChild(gutter);
      div.appendChild(document.createTextNode(selector));
      list.appendChild(div);
      document.body.appendChild(list);
      return list;
    }

    it('keeps a populated gutter and rebuilds the selector text on a matched render', () => {
      makeListWithGutter('items', 'size', true);
      const filter = makeFilter('items');

      filter.searchBox.value = 'iz';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.querySelectorAll('.method-gutter')).toHaveLength(1);
      expect(item.querySelector('.method-gutter .override-arrow')?.textContent).toBe('▲');
      expect(item.querySelector('.match-highlight')?.textContent).toBe('iz');
      expect(item.textContent).toBe('▲size');
    });

    it('keeps an empty gutter so an indicator-free name still aligns after filtering', () => {
      makeListWithGutter('items', 'name', false);
      const filter = makeFilter('items');

      filter.searchBox.value = '';
      filter.applyFilter();

      const item = document.querySelector('#items .item') as HTMLElement;
      expect(item.firstElementChild?.className).toBe('method-gutter');
      expect(item.textContent).toBe('name');
    });
  });
});
