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
  renderVariables(
    varsEl: HTMLElement,
    groups: { title: string; kind: string; collapsed?: boolean;
      vars: { name: string; value: string; oop: string }[] }[],
    onInspect?: (oop: string, name: string) => void,
  ): void;
  selectFrame(listEl: HTMLElement, level: number): HTMLElement | null;
  showMenu(menuEl: HTMLElement, x: number, y: number): void;
  hideMenu(menuEl: HTMLElement): void;
  frameLevelOf(target: Element | null): number | null;
  init(refs: Refs, vscode: {
    postMessage: (m: unknown) => void;
    getState?: () => unknown;
    setState?: (s: unknown) => void;
  }): {
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
  toolbar: HTMLElement;
  variables: HTMLElement;
  evalInput: HTMLInputElement;
  evalResult: HTMLElement;
  evalbar?: HTMLElement;
  main?: HTMLElement;
  splitter?: HTMLElement;
  hsplitter?: HTMLElement;
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
    <div id="toolbar">
      <button data-cmd="resume">Resume</button>
      <button data-cmd="stepOver">Over</button>
      <button data-cmd="stepInto">Into</button>
      <button data-cmd="stepThrough">Through</button>
      <button data-cmd="restartFrame">Restart Frame</button>
      <button data-cmd="terminate">Terminate</button>
    </div>
    <div id="error"></div>
    <div class="main"><ul id="stack"></ul><div id="variables"></div></div>
    <input id="evalInput"><div id="evalResult"></div>
    <div id="ctxmenu"><div id="copyFrameItem">Copy Frame</div></div>`;
  const refs: Refs = {
    list: document.getElementById('stack')!,
    menu: document.getElementById('ctxmenu')!,
    copyFrameItem: document.getElementById('copyFrameItem')!,
    copyBtn: document.getElementById('copyBtn')!,
    error: document.getElementById('error')!,
    toolbar: document.getElementById('toolbar')!,
    variables: document.getElementById('variables')!,
    evalInput: document.getElementById('evalInput') as HTMLInputElement,
    evalResult: document.getElementById('evalResult')!,
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

describe('DebuggerView.renderVariables', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="variables"></div>'; });

  it('renders each group with a title and its rows (name / value / dim oop)', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'a JasperDebugDemo', oop: '100' }] },
      { title: 'Arguments & Temps', kind: 'argtemps', vars: [{ name: 'amount', value: '75', oop: '124' }] },
    ]);
    const titles = el.querySelectorAll('.var-group-title');
    expect([...titles].map(t => t.textContent)).toEqual(['Receiver', 'Arguments & Temps']);

    const rows = el.querySelectorAll('.var');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.var-name')!.classList.contains('self')).toBe(true);
    expect(rows[0].querySelector('.var-name')!.textContent).toBe('self');
    expect(rows[0].querySelector('.var-value')!.textContent).toBe('a JasperDebugDemo');
    expect(rows[0].querySelector('.var-oop')!.textContent).toBe('100');
    expect((rows[0] as HTMLElement).dataset.oop).toBe('100');
    expect(rows[1].querySelector('.var-name')!.textContent).toBe('amount');
    expect(rows[1].querySelector('.var-oop')!.textContent).toBe('124');
  });

  it('renders the stack-temps group collapsed; clicking its title expands it', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, [
      { title: '(stack temps)', kind: 'stacktemps', collapsed: true,
        vars: [{ name: '.t1', value: '7', oop: '36' }] },
    ]);
    const group = el.querySelector('.var-group')!;
    expect(group.classList.contains('collapsed')).toBe(true);
    (group.querySelector('.var-group-title') as HTMLElement).click();
    expect(group.classList.contains('collapsed')).toBe(false);
  });

  it('clicking a variable row calls onInspect with the row oop + name', () => {
    const el = document.getElementById('variables')!;
    const onInspect = vi.fn();
    api().renderVariables(el, [
      { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] },
    ], onInspect);
    (el.querySelector('.var') as HTMLElement).click();
    expect(onInspect).toHaveBeenCalledWith('100', 'self');
  });

  it('shows an empty-state message when there are no groups', () => {
    const el = document.getElementById('variables')!;
    api().renderVariables(el, []);
    expect(el.querySelector('.empty')!.textContent).toBe('No variables.');
  });
});

describe('DebuggerView.init — toolbar', () => {
  it('posts each toolbar command with the selected frame level', () => {
    const { refs, vscode } = setup(); // default-selects top frame (level 1)
    const click = (cmd: string) =>
      refs.toolbar.querySelector(`button[data-cmd="${cmd}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    click('stepOver');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'stepOver', level: 1 });
    click('resume');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'resume', level: 1 });
    click('terminate');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'terminate', level: 1 });
  });

  it('resolves the command when the click lands on a child of the button (the SVG icon)', () => {
    const { refs, vscode } = setup(); // default-selects top frame (level 1)
    const btn = refs.toolbar.querySelector('button[data-cmd="stepInto"]')!;
    // Production buttons hold an inline <svg> glyph, so the real click target is
    // the child element, not the button — the handler must walk up via closest().
    const icon = document.createElement('span');
    btn.appendChild(icon);
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'stepInto', level: 1 });
  });
});

describe('DebuggerView.init — eval bar', () => {
  it('posts evalInFrame for the selected frame on Enter (trimmed, non-empty)', () => {
    const { refs, vscode } = setup();
    refs.evalInput.value = '  amount * 2  ';
    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'evalInFrame', level: 1, expr: 'amount * 2' });
  });

  it('does not post on Enter when the input is blank', () => {
    const { refs, vscode } = setup();
    vi.mocked(vscode.postMessage).mockClear();
    refs.evalInput.value = '   ';
    refs.evalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});

describe('DebuggerView.init — inbound variables / evalResult', () => {
  it('renders grouped variables pushed from the host', () => {
    const { refs } = setup();
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'variables', groups: [
        { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] },
        { title: 'Arguments & Temps', kind: 'argtemps', vars: [{ name: 'n', value: '7', oop: '20' }] },
      ] },
    }));
    expect(refs.variables.querySelectorAll('.var')).toHaveLength(2);
  });

  it('clicking a pushed variable row posts inspectVariable to the host', () => {
    const { refs, vscode } = setup();
    vi.mocked(vscode.postMessage).mockClear();
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'variables', groups: [
        { title: 'Receiver', kind: 'receiver', vars: [{ name: 'self', value: 'x', oop: '100' }] },
      ] },
    }));
    (refs.variables.querySelector('.var') as HTMLElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'inspectVariable', oop: '100', name: 'self' });
  });

  it('shows an eval result, flagging errors', () => {
    const { refs } = setup();
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'evalResult', value: '150', isError: false },
    }));
    expect(refs.evalResult.textContent).toBe('150');
    expect(refs.evalResult.classList.contains('error')).toBe(false);

    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'evalResult', value: 'Error: nope', isError: true },
    }));
    expect(refs.evalResult.textContent).toBe('Error: nope');
    expect(refs.evalResult.classList.contains('error')).toBe(true);
  });

  it('renders an empty string (not "undefined") when an evalResult has no value', () => {
    const { refs } = setup();
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'evalResult', isError: false },
    }));
    expect(refs.evalResult.textContent).toBe('');
  });

  it('clears stale variables and eval output on a fresh init (refresh)', () => {
    const { refs } = setup();
    refs.variables.innerHTML = '<div class="var">stale</div>';
    refs.evalResult.textContent = 'stale';
    refs.evalResult.classList.add('error');

    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'init', errorMessage: '', stack: STACK },
    }));
    expect(refs.variables.querySelector('.var')).toBeNull();
    expect(refs.evalResult.textContent).toBe('');
    expect(refs.evalResult.classList.contains('error')).toBe(false);
  });
});

describe('DebuggerView.init — resizable splitter', () => {
  // Build a panel DOM that includes the .main container + splitter, and a fake
  // vscode that records postMessage and round-trips getState/setState. jsdom
  // getBoundingClientRect returns zeros, so stub .main's rect to a real width.
  function setupSplit(initialState?: { stackBasis?: string; evalHeight?: string }) {
    document.body.innerHTML = `
      <div id="error"></div>
      <div class="main" id="main" style="--stack-basis: 60%;">
        <ul id="stack"></ul>
        <div id="splitter"></div>
        <div id="variables"></div>
      </div>
      <div id="hsplitter"></div>
      <div id="evalbar" style="--eval-height: 7rem;">
        <input id="evalInput"><div id="evalResult"></div>
      </div>
      <div id="ctxmenu"><div id="copyFrameItem"></div></div>
      <button id="copyBtn"></button><div id="toolbar"></div>`;
    const main = document.getElementById('main')!;
    main.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON() {} });
    const evalbar = document.getElementById('evalbar')!;
    // jsdom rects are all-zero; give the eval bar a real height so the hsplitter
    // baseline (the live eval-bar height at mousedown) is meaningful.
    evalbar.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 200, bottom: 200, width: 200, height: 100, x: 0, y: 100, toJSON() {} });
    const refs: Refs = {
      list: document.getElementById('stack')!,
      menu: document.getElementById('ctxmenu')!,
      copyFrameItem: document.getElementById('copyFrameItem')!,
      copyBtn: document.getElementById('copyBtn')!,
      error: document.getElementById('error')!,
      toolbar: document.getElementById('toolbar')!,
      variables: document.getElementById('variables')!,
      evalInput: document.getElementById('evalInput') as HTMLInputElement,
      evalResult: document.getElementById('evalResult')!,
      evalbar,
      main,
      splitter: document.getElementById('splitter')!,
      hsplitter: document.getElementById('hsplitter')!,
    };
    let state: unknown = initialState;
    const vscode = {
      postMessage: vi.fn(),
      getState: vi.fn(() => state),
      setState: vi.fn((s: unknown) => { state = s; }),
    };
    api().init(refs, vscode);
    return { refs, vscode, main };
  }

  function drag(splitter: HTMLElement, toClientX: number) {
    splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 120, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: toClientX, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: toClientX, clientY: 50 }));
  }

  it('restores a previously saved stack basis from webview state on init', () => {
    const { main } = setupSplit({ stackBasis: '35%' });
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('35%');
  });

  it('updates --stack-basis while dragging, clamped to 20–80%', () => {
    const { refs, main } = setupSplit();
    // 50px / 200px width → 25%.
    drag(refs.splitter!, 50);
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('25.0%');
    // Dragging past the right edge clamps to 80%.
    drag(refs.splitter!, 400);
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('80.0%');
  });

  it('persists the basis on drag end via setState and a saveLayout message', () => {
    const { refs, vscode } = setupSplit();
    drag(refs.splitter!, 100); // 100/200 → 50%
    expect(vscode.setState).toHaveBeenCalledWith({ stackBasis: '50.0%' });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'saveLayout', stackBasis: '50.0%' });
  });

  it('a mousemove with no active drag does nothing', () => {
    const { main } = setupSplit();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    expect(main.style.getPropertyValue('--stack-basis').trim()).toBe('60%');
  });

  it('a bare click on the splitter (no movement) does not persist', () => {
    const { refs, vscode } = setupSplit();
    refs.splitter!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 120, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 50 }));
    expect(vscode.setState).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'saveLayout' }),
    );
  });

  // Drag the horizontal splitter from y=50 to the given clientY. The eval bar's
  // baseline height is the stubbed 100px; dragging UP (smaller clientY) grows it.
  function hdrag(hsplitter: HTMLElement, toClientY: number) {
    hsplitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: toClientY }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: toClientY }));
  }

  it('restores a previously saved eval-height from webview state on init', () => {
    const { refs } = setupSplit({ evalHeight: '12rem' });
    expect(refs.evalbar!.style.getPropertyValue('--eval-height').trim()).toBe('12rem');
  });

  it('grows --eval-height when dragging the splitter up (baseline + (startY - y))', () => {
    const { refs } = setupSplit();
    // baseline 100 + (50 - 20) = 130px.
    hdrag(refs.hsplitter!, 20);
    expect(refs.evalbar!.style.getPropertyValue('--eval-height').trim()).toBe('130px');
  });

  it('clamps --eval-height to a 42px floor when dragging down past it', () => {
    const { refs } = setupSplit();
    // baseline 100 + (50 - 300) → below the floor.
    hdrag(refs.hsplitter!, 300);
    expect(refs.evalbar!.style.getPropertyValue('--eval-height').trim()).toBe('42px');
  });

  it('persists the eval-height on horizontal drag end via setState and saveLayout', () => {
    const { refs, vscode } = setupSplit();
    hdrag(refs.hsplitter!, 20); // → 130px
    expect(vscode.setState).toHaveBeenCalledWith({ evalHeight: '130px' });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'saveLayout', evalHeight: '130px' });
  });
});
