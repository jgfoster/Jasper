// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate browserColumnResize.js in jsdom so it registers the global
// BrowserColumnResize, exactly as the webview does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../browserColumnResize.js'), 'utf8');
  new Function(source)();
});

type ResizeApi = {
  nextVisibleColumn(column: Element): Element | null;
  clampResize(startA: number, startB: number, delta: number, minWidth: number): { a: number; b: number };
  applyPairWidths(colA: HTMLElement, colB: HTMLElement, wA: number, wB: number): void;
  addHandles(container: Element, doc: Document): void;
  setupColumnResize(options: { container: Element | null; document?: Document; minWidth?: number }): void;
};

function api(): ResizeApi {
  return (globalThis as unknown as { BrowserColumnResize: ResizeApi }).BrowserColumnResize;
}

// Build a `.columns` container with `count` columns; mark the indices in
// `hidden` with the `hidden` class (as the Hierarchy column is in category mode).
function makeColumns(count: number, hidden: number[] = []): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'columns';
  for (let i = 0; i < count; i++) {
    const col = document.createElement('div');
    col.className = 'column' + (hidden.includes(i) ? ' hidden' : '');
    col.dataset.index = String(i);
    container.appendChild(col);
  }
  return container;
}

describe('BrowserColumnResize.nextVisibleColumn', () => {
  it('returns the immediate next column when it is visible', () => {
    const container = makeColumns(3);

    const next = api().nextVisibleColumn(container.children[0]);

    expect((next as HTMLElement).dataset.index).toBe('1');
  });

  it('skips a hidden column and returns the next visible one', () => {
    const container = makeColumns(4, [1]);

    const next = api().nextVisibleColumn(container.children[0]);

    expect((next as HTMLElement).dataset.index).toBe('2');
  });

  it('returns null for the last column', () => {
    const container = makeColumns(3);

    expect(api().nextVisibleColumn(container.children[2])).toBeNull();
  });
});

describe('BrowserColumnResize.clampResize', () => {
  it('moves the boundary by the delta while preserving the pair total', () => {
    const { a, b } = api().clampResize(200, 200, 30, 80);

    expect(a).toBe(230);
    expect(b).toBe(170);
    expect(a + b).toBe(400);
  });

  it('does not let the left column drop below the minimum width', () => {
    const { a, b } = api().clampResize(200, 200, -300, 80);

    expect(a).toBe(80);
    expect(b).toBe(320);
  });

  it('does not let the right column drop below the minimum width', () => {
    const { a, b } = api().clampResize(200, 200, 300, 80);

    expect(a).toBe(320);
    expect(b).toBe(80);
  });
});

describe('BrowserColumnResize.applyPairWidths', () => {
  it('pins both columns to fixed pixel bases so only they resize', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');

    api().applyPairWidths(a, b, 250, 150);

    expect(a.style.flex).toBe('0 0 250px');
    expect(b.style.flex).toBe('0 0 150px');
  });
});

describe('BrowserColumnResize.addHandles', () => {
  it('adds a resize handle to every column except the last', () => {
    const container = makeColumns(4);

    api().addHandles(container, document);

    const handles = container.querySelectorAll('.column-resizer');
    expect(handles).toHaveLength(3);
    expect(container.children[3].querySelector('.column-resizer')).toBeNull();
  });

  it('is idempotent — a second call does not duplicate handles', () => {
    const container = makeColumns(3);

    api().addHandles(container, document);
    api().addHandles(container, document);

    expect(container.querySelectorAll('.column-resizer')).toHaveLength(2);
  });
});

describe('BrowserColumnResize.setupColumnResize', () => {
  it('installs handles on the container', () => {
    const container = makeColumns(3);

    api().setupColumnResize({ container, document });

    expect(container.querySelectorAll('.column-resizer')).toHaveLength(2);
  });

  it('does nothing when given no container', () => {
    expect(() => api().setupColumnResize({ container: null })).not.toThrow();
  });

  it('dragging a handle resizes the pair by the pointer delta, then releases', () => {
    const container = makeColumns(3);
    document.body.appendChild(container);
    const colA = container.children[0] as HTMLElement;
    const colB = container.children[1] as HTMLElement;
    // jsdom has no layout, so stand in for the rendered widths.
    colA.getBoundingClientRect = (() => ({ width: 200 })) as unknown as () => DOMRect;
    colB.getBoundingClientRect = (() => ({ width: 200 })) as unknown as () => DOMRect;
    api().setupColumnResize({ container, document, minWidth: 80 });
    const handle = colA.querySelector('.column-resizer')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 140 }));

    expect(colA.style.flex).toBe('0 0 240px');
    expect(colB.style.flex).toBe('0 0 160px');
    expect(handle.classList.contains('active')).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(handle.classList.contains('active')).toBe(false);
  });

  it('ignores a drag that starts on a handle whose only neighbours are hidden', () => {
    const container = makeColumns(2, [1]);
    document.body.appendChild(container);
    const colA = container.children[0] as HTMLElement;
    api().setupColumnResize({ container, document, minWidth: 80 });
    const handle = colA.querySelector('.column-resizer')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 140 }));

    expect(colA.style.flex).toBe('');
  });
});
