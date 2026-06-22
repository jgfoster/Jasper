// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate debuggerView.js in jsdom so it registers the global DebuggerView,
// exactly as the webview does when it injects the file as a <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../debuggerView.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(source)();
});

interface FrameSummary { level: number; label: string; position: string; }

interface DebuggerViewApi {
  renderStack(listEl: HTMLElement, stack: FrameSummary[]): void;
  selectFrame(listEl: HTMLElement, level: number): HTMLElement | null;
  showMenu(menuEl: HTMLElement, x: number, y: number): void;
  hideMenu(menuEl: HTMLElement): void;
  frameLevelOf(target: Element | null): number | null;
  init(refs: Refs, vscode: { postMessage: (m: unknown) => void }): {
    selectedLevel(): number | null;
    select(level: number): void;
  };
}

interface Refs {
  list: HTMLElement;
  menu: HTMLElement;
  copyFrameItem: HTMLElement;
  copyBtn: HTMLElement;
  error: HTMLElement;
}

function api(): DebuggerViewApi {
  return (globalThis as unknown as { DebuggerView: DebuggerViewApi }).DebuggerView;
}

const STACK: FrameSummary[] = [
  { level: 1, label: '[] in JasperDebugDemo>>#finish', position: '@2 line 12' },
  { level: 2, label: 'SmallInteger (Object)>>#halt', position: '@2 line 12' },
  { level: 3, label: 'JasperDebugDemo>>#accumulateFrom:to:', position: '' },
];

// Build the panel's DOM (the elements debuggerPanel.ts's getHtml renders) and
// wire DebuggerView to a fake vscode whose postMessage we can assert on.
function setup(stack: FrameSummary[] = STACK) {
  document.body.innerHTML = `
    <button id="copyBtn">Copy Stack</button>
    <div id="error"></div>
    <ul id="stack"></ul>
    <div id="ctxmenu"><div id="copyFrameItem">Copy Frame</div></div>`;
  const refs: Refs = {
    list: document.getElementById('stack')!,
    menu: document.getElementById('ctxmenu')!,
    copyFrameItem: document.getElementById('copyFrameItem')!,
    copyBtn: document.getElementById('copyBtn')!,
    error: document.getElementById('error')!,
  };
  const vscode = { postMessage: vi.fn() };
  const ctrl = api().init(refs, vscode);
  // Deliver the host's init payload, as the webview does on load.
  window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'init', errorMessage: 'boom', stack },
  }));
  return { refs, vscode, ctrl };
}

function frame(refs: Refs, level: number): HTMLElement {
  return refs.list.querySelector(`.frame[data-level="${level}"]`) as HTMLElement;
}

describe('DebuggerView.renderStack', () => {
  beforeEach(() => { document.body.innerHTML = '<ul id="stack"></ul>'; });

  it('renders one .frame per stack entry, tagged with its level', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);

    const frames = list.querySelectorAll('.frame');
    expect(frames).toHaveLength(3);
    expect([...frames].map(f => (f as HTMLElement).dataset.level)).toEqual(['1', '2', '3']);
    expect(frames[0].querySelector('.level')!.textContent).toBe('1');
    expect(frames[0].querySelector('.label')!.textContent).toBe('[] in JasperDebugDemo>>#finish');
  });

  it('renders a dimmed .pos only when the frame has a position', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);

    expect(list.querySelector('.frame[data-level="1"] .pos')!.textContent).toBe('@2 line 12');
    expect(list.querySelector('.frame[data-level="3"] .pos')).toBeNull();
  });

  it('shows an empty-state message for an empty stack', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, []);

    expect(list.querySelectorAll('.frame')).toHaveLength(0);
    expect(list.querySelector('.empty')!.textContent).toBe('No stack frames available.');
  });

  it('clears prior content on re-render', () => {
    const list = document.getElementById('stack')!;
    api().renderStack(list, STACK);
    api().renderStack(list, [STACK[0]]);
    expect(list.querySelectorAll('.frame')).toHaveLength(1);
  });
});

describe('DebuggerView.init — init payload', () => {
  it('renders the stack, shows the error, default-selects the top frame, and posts selectFrame', () => {
    const { refs, ctrl, vscode } = setup();

    expect(refs.error.textContent).toBe('boom');
    expect(refs.list.querySelectorAll('.frame')).toHaveLength(3);
    expect(frame(refs, 1).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(1);
    // Default-selecting the top frame drives the companion source editor.
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 1 });
  });

  it('does not select anything when the stack is empty', () => {
    const { refs, ctrl } = setup([]);
    expect(refs.list.querySelector('.selected')).toBeNull();
    expect(ctrl.selectedLevel()).toBeNull();
  });
});

describe('DebuggerView.init — frame selection', () => {
  it('left-click selects a frame, moves selection off the previous one, and posts selectFrame', () => {
    const { refs, ctrl, vscode } = setup();      // top frame (1) selected by default
    frame(refs, 3).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(frame(refs, 1).classList.contains('selected')).toBe(false);
    expect(frame(refs, 3).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(3);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 3 });
  });
});

describe('DebuggerView.init — right-click copy popup', () => {
  it('right-click selects the frame and shows the menu at the cursor', () => {
    const { refs, ctrl, vscode } = setup();
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
    frame(refs, 2).dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);           // native menu suppressed
    expect(frame(refs, 2).classList.contains('selected')).toBe(true);
    expect(ctrl.selectedLevel()).toBe(2);
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectFrame', level: 2 });
    expect(refs.menu.classList.contains('show')).toBe(true);
    expect(refs.menu.style.left).toBe('40px');
    expect(refs.menu.style.top).toBe('60px');
  });

  it('Copy Frame posts copyFrame for the selected level and hides the menu', () => {
    const { refs, vscode } = setup();
    frame(refs, 2).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    refs.copyFrameItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'copyFrame', level: 2 });
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('an outside click hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('Escape hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('a scroll hides the menu', () => {
    const { refs } = setup();
    api().showMenu(refs.menu, 0, 0);
    window.dispatchEvent(new Event('scroll'));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });

  it('a right-click outside any frame does not open the menu', () => {
    const { refs } = setup();
    refs.list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(refs.menu.classList.contains('show')).toBe(false);
  });
});

describe('DebuggerView.init — copy stack button', () => {
  it('posts copyStack and flashes "Copied" on the button', () => {
    vi.useFakeTimers();
    try {
      const { refs, vscode } = setup();
      refs.copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'copyStack' });
      expect(refs.copyBtn.textContent).toBe('Copied');
      vi.advanceTimersByTime(1200);
      expect(refs.copyBtn.textContent).toBe('Copy Stack');
    } finally {
      vi.useRealTimers();
    }
  });
});
