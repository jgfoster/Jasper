import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';

const MAX_PRINT_STRING = 2000;
const PAGE_SIZE = 100;

// oop is sent over postMessage as a string (bigint can't be JSON-serialised).
interface SuperInspectorItem {
  label: string;
  value: string;
  truncated?: boolean;  // value was cut at MAX_PRINT_STRING; Full tab available
  oop?: string;         // present for inspectable objects
  rangeStart?: number;  // present for range-group nodes
  rangeEnd?: number;
}

interface PageResult {
  items: SuperInspectorItem[];
  hasMore: boolean;
  remaining: number;
}

interface NavEntry {
  oop: bigint;
  label: string;
}

type InspectorMessage =
  | { command: 'ready' }
  | { command: 'loadMore' }
  | { command: 'loadRange'; start: number; end: number; listIndex: number }
  | { command: 'toggleRanges' }
  | { command: 'dive'; oop: string; label: string }
  | { command: 'back' }
  | { command: 'inspect'; oop: string; label: string }
  | { command: 'fetchFull'; oop: string };

export class SuperInspector {
  private static panels = new Map<number, Set<SuperInspector>>();
  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  private currentOop: bigint;
  private currentLabel: string;
  private navStack: NavEntry[] = [];
  private indexedLoaded = 0;
  private indexedTotal = 0;
  private showRanges = false;

  static create(session: ActiveSession, oop: bigint, label: string): void {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneSuperInspector',
      'Inspector',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    const inspector = new SuperInspector(panel, session, oop, label);
    if (!SuperInspector.panels.has(session.id)) {
      SuperInspector.panels.set(session.id, new Set());
    }
    SuperInspector.panels.get(session.id)!.add(inspector);
  }

  static disposeForSession(sessionId: number): void {
    const set = SuperInspector.panels.get(sessionId);
    if (set) {
      for (const inspector of set) inspector.panel.dispose();
      SuperInspector.panels.delete(sessionId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    oop: bigint,
    label: string,
  ) {
    this.panel = panel;
    this.sessionId = session.id;
    this.currentOop = oop;
    this.currentLabel = label;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: InspectorMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private handleMessage(msg: InspectorMessage): void {
    switch (msg.command) {
      case 'ready':
        this.postLoadItems(this.buildInitialItems());
        break;

      case 'loadMore':
        this.panel.webview.postMessage({ command: 'appendItems', ...this.buildNextPage() });
        break;

      case 'loadRange': {
        const items = this.fetchRangeItems(msg.start, msg.end);
        this.panel.webview.postMessage({ command: 'expandRange', listIndex: msg.listIndex, items });
        break;
      }

      case 'toggleRanges':
        this.showRanges = !this.showRanges;
        this.indexedLoaded = 0;
        this.postLoadItems(this.buildInitialItems());
        break;

      case 'dive': {
        const diveOop = BigInt(msg.oop);
        this.navStack.push({ oop: this.currentOop, label: this.currentLabel });
        this.currentOop = diveOop;
        this.currentLabel = msg.label;
        this.indexedLoaded = 0;
        this.indexedTotal = 0;
        this.postLoadItems(this.buildInitialItems());
        break;
      }

      case 'back': {
        const prev = this.navStack.pop();
        if (!prev) return;
        this.currentOop = prev.oop;
        this.currentLabel = prev.label;
        this.indexedLoaded = 0;
        this.indexedTotal = 0;
        this.postLoadItems(this.buildInitialItems());
        break;
      }

      case 'inspect':
        SuperInspector.create(this.session, BigInt(msg.oop), msg.label);
        break;

      case 'fetchFull': {
        const value = debug.fetchFullPrintString(this.session, BigInt(msg.oop));
        this.panel.webview.postMessage({ command: 'fullValue', oop: msg.oop, value });
        break;
      }
    }
  }

  private postLoadItems(result: PageResult): void {
    this.panel.webview.postMessage({
      command: 'loadItems',
      ...result,
      canGoBack: this.navStack.length > 0,
      currentLabel: this.currentLabel,
      className: debug.getObjectClassName(this.session, this.currentOop),
      showRanges: this.showRanges,
    });
  }

  private buildInitialItems(): PageResult {
    const items: SuperInspectorItem[] = [];

    // 1. self
    const selfPs = debug.fetchPrintString(this.session, this.currentOop, MAX_PRINT_STRING);
    items.push({ label: 'self', value: selfPs.value, truncated: selfPs.truncated, oop: this.currentOop.toString() });

    // 2. -.oop — computed value, not a separately inspectable object
    items.push({ label: '-.oop', value: this.currentOop.toString() });

    // 3. Named instance variables
    try {
      const names = debug.getInstVarNames(this.session, this.currentOop);
      if (names.length > 0) {
        const varOops = debug.getNamedInstVarOops(this.session, this.currentOop, names.length);
        for (let i = 0; i < names.length && i < varOops.length; i++) {
          const ps = debug.fetchPrintString(this.session, varOops[i], MAX_PRINT_STRING);
          items.push({ label: names[i], value: ps.value, truncated: ps.truncated, oop: varOops[i].toString() });
        }
      }
    } catch { /* ignore */ }

    // 4. Indexed variables — range nodes or individual items
    try {
      this.indexedTotal = debug.getIndexedSize(this.session, this.currentOop);
      if (this.indexedTotal > 0) {
        if (this.showRanges) {
          for (let start = 1; start <= this.indexedTotal; start += PAGE_SIZE) {
            const end = Math.min(start + PAGE_SIZE - 1, this.indexedTotal);
            items.push({ label: `[${start}..${end}]`, value: `${end - start + 1} items`, rangeStart: start, rangeEnd: end });
          }
        } else {
          const limit = Math.min(this.indexedTotal, PAGE_SIZE);
          const elemOops = debug.getIndexedOops(this.session, this.currentOop, 1, limit);
          for (let i = 0; i < elemOops.length; i++) {
            const ps = debug.fetchPrintString(this.session, elemOops[i], MAX_PRINT_STRING);
            items.push({ label: `[${i + 1}]`, value: ps.value, truncated: ps.truncated, oop: elemOops[i].toString() });
          }
          this.indexedLoaded = elemOops.length;
        }
      }
    } catch { /* ignore */ }

    const hasMore = !this.showRanges && this.indexedLoaded < this.indexedTotal;
    return { items, hasMore, remaining: this.indexedTotal - this.indexedLoaded };
  }

  private buildNextPage(): PageResult {
    const items: SuperInspectorItem[] = [];
    try {
      const start = this.indexedLoaded + 1;
      const limit = Math.min(this.indexedTotal - this.indexedLoaded, PAGE_SIZE);
      if (limit > 0) {
        const elemOops = debug.getIndexedOops(this.session, this.currentOop, start, limit);
        for (let i = 0; i < elemOops.length; i++) {
          const ps = debug.fetchPrintString(this.session, elemOops[i], MAX_PRINT_STRING);
          items.push({ label: `[${start + i}]`, value: ps.value, truncated: ps.truncated, oop: elemOops[i].toString() });
        }
        this.indexedLoaded += elemOops.length;
      }
    } catch { /* ignore */ }

    return {
      items,
      hasMore: this.indexedLoaded < this.indexedTotal,
      remaining: this.indexedTotal - this.indexedLoaded,
    };
  }

  private fetchRangeItems(start: number, end: number): SuperInspectorItem[] {
    try {
      const count = end - start + 1;
      const elemOops = debug.getIndexedOops(this.session, this.currentOop, start, count);
      return elemOops.map((oop, i) => {
        const ps = debug.fetchPrintString(this.session, oop, MAX_PRINT_STRING);
        return { label: `[${start + i}]`, value: ps.value, truncated: ps.truncated, oop: oop.toString() };
      });
    } catch {
      return [];
    }
  }

  private dispose(): void {
    SuperInspector.panels.get(this.sessionId)?.delete(this);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Super Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    /* ── Nav bar ─────────────────────────────── */
    .nav-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      min-height: 26px;
    }
    .nav-btn {
      background-color: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: pointer;
      padding: 1px 8px;
      font-size: 0.82em;
      white-space: nowrap;
      flex-shrink: 0;
      font-family: var(--vscode-font-family);
    }
    .nav-btn:hover:not(:disabled) {
      background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
    }
    .nav-btn:disabled { opacity: 0.4; cursor: default; }
    .nav-btn.active {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .obj-title {
      display: flex;
      align-items: baseline;
      gap: 5px;
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }
    .obj-class {
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .obj-sep {
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .obj-label {
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* ── Panes ───────────────────────────────── */
    .panes {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .list-pane {
      width: 40%;
      min-width: 100px;
      overflow-y: auto;
      border-right: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .detail-pane {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 8px 10px;
      gap: 6px;
    }
    /* ── List items ──────────────────────────── */
    .list-item {
      display: flex;
      align-items: baseline;
      padding: 2px 8px;
      cursor: pointer;
      user-select: none;
      gap: 6px;
      overflow: hidden;
    }
    .list-item:hover { background: var(--vscode-list-hoverBackground); }
    .list-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .list-item.range-node { font-style: italic; }
    .item-label { font-weight: 600; flex-shrink: 0; white-space: nowrap; }
    .item-desc {
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .list-item.selected .item-desc { color: inherit; opacity: 0.8; }
    .load-more {
      padding: 4px 8px;
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
      user-select: none;
      font-style: italic;
    }
    .load-more:hover { background: var(--vscode-list-hoverBackground); text-decoration: underline; }
    .load-more.loading { color: var(--vscode-descriptionForeground); cursor: default; pointer-events: none; }
    /* ── Detail pane ─────────────────────────── */
    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 4px;
      flex-shrink: 0;
    }
    .detail-label { font-weight: 600; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
    .detail-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .action-btn {
      background-color: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: pointer;
      padding: 1px 8px;
      font-size: 0.82em;
      white-space: nowrap;
      font-family: var(--vscode-font-family);
    }
    .action-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
    /* ── Detail tabs ─────────────────────────── */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      margin-top: -2px;
    }
    .tab {
      padding: 3px 14px;
      cursor: pointer;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
      user-select: none;
      margin-bottom: -1px;
      white-space: nowrap;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, var(--vscode-button-background));
    }
    /* ── Detail value ────────────────────────── */
    .detail-value {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-all;
      overflow: auto;
      flex: 1;
    }
    .placeholder { padding: 12px 8px; color: var(--vscode-descriptionForeground); font-style: italic; }
    /* ── Context menu ────────────────────────── */
    .ctx-menu {
      position: fixed;
      display: none;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 2px 0;
      z-index: 1000;
      min-width: 120px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .ctx-item {
      padding: 5px 16px;
      cursor: pointer;
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      font-size: 0.9em;
      white-space: nowrap;
    }
    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
  </style>
</head>
<body>
  <div class="nav-bar">
    <button id="backBtn" class="nav-btn" disabled>&#8592; Back</button>
    <button id="rangeBtn" class="nav-btn">Show Ranges</button>
    <div class="obj-title">
      <span id="objClass" class="obj-class"></span>
      <span id="objSep" class="obj-sep" style="display:none">&#8250;</span>
      <span id="objLabel" class="obj-label"></span>
    </div>
  </div>
  <div class="panes">
    <div class="list-pane" id="listPane">
      <div class="placeholder">Loading…</div>
    </div>
    <div class="detail-pane" id="detailPane">
      <div class="placeholder">Select an item to view its value.</div>
    </div>
  </div>
  <div id="ctxMenu" class="ctx-menu">
    <div class="ctx-item" data-action="dive">Dive</div>
    <div class="ctx-item" data-action="inspect">Inspect</div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let items = [];
    let selectedIndex = -1;
    let ctxTarget = null;

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function truncate(s, max) {
      if (s.length <= max) return s;
      return s.slice(0, max) + '…';
    }

    // ── Detail pane ───────────────────────────

    function select(index) {
      if (index < 0 || index >= items.length) return;
      selectedIndex = index;
      document.querySelectorAll('.list-item').forEach((el, i) =>
        el.classList.toggle('selected', i === index));

      const item = items[index];
      const detail = document.getElementById('detailPane');

      let actionsHtml = '';
      if (item.oop) {
        const o = esc(item.oop), l = esc(item.label);
        actionsHtml =
          '<div class="detail-actions">' +
          '<button class="action-btn" id="diveBtn" data-oop="' + o + '" data-label="' + l + '">Dive</button>' +
          '<button class="action-btn" id="inspectBtn" data-oop="' + o + '" data-label="' + l + '">Inspect</button>' +
          '</div>';
      }

      const tabBarHtml = item.truncated
        ? '<div class="tab-bar">' +
          '<div class="tab active" data-tab="value">Value</div>' +
          '<div class="tab" data-tab="full">Full</div>' +
          '</div>'
        : '';

      detail.innerHTML =
        '<div class="detail-header">' +
          '<span class="detail-label">' + esc(item.label) + '</span>' +
          actionsHtml +
        '</div>' +
        tabBarHtml +
        '<div class="detail-value" id="detailValue">' + esc(item.value) + '</div>';
    }

    // Detail pane: Dive, Inspect, and tab clicks (all delegated)
    document.getElementById('detailPane').addEventListener('click', (e) => {
      const diveBtn = e.target.closest('#diveBtn');
      if (diveBtn) { vscode.postMessage({ command: 'dive', oop: diveBtn.dataset.oop, label: diveBtn.dataset.label }); return; }
      const inspBtn = e.target.closest('#inspectBtn');
      if (inspBtn) { vscode.postMessage({ command: 'inspect', oop: inspBtn.dataset.oop, label: inspBtn.dataset.label }); return; }

      const tab = e.target.closest('.tab');
      if (tab) {
        const item = items[selectedIndex];
        if (!item) return;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        const contentEl = document.getElementById('detailValue');
        if (!contentEl) return;
        if (tab.dataset.tab === 'value') {
          contentEl.innerHTML = esc(item.value);
        } else if (tab.dataset.tab === 'full') {
          if (item.fullValue !== undefined) {
            contentEl.innerHTML = esc(item.fullValue);
          } else {
            contentEl.innerHTML = '<span style="color:var(--vscode-descriptionForeground);font-style:italic">Loading…</span>';
            vscode.postMessage({ command: 'fetchFull', oop: item.oop });
          }
        }
      }
    });

    // ── List rendering ────────────────────────

    function makeItemHtml(item, index) {
      if (item.rangeStart !== undefined) {
        const arrow = item.expanded ? '&#9660;' : '&#9654;';
        const hint  = item.expanded ? 'click to collapse' : 'click to expand';
        return '<div class="list-item range-node" data-index="' + index + '">' +
          '<span class="item-label">' + arrow + ' ' + esc(item.label) + '</span>' +
          '<span class="item-desc">' + hint + '</span>' +
          '</div>';
      }
      return '<div class="list-item" data-index="' + index + '">' +
        '<span class="item-label">' + esc(item.label) + '</span>' +
        '<span class="item-desc">' + esc(truncate(item.value, 50)) + '</span>' +
        '</div>';
    }

    function makeLoadMoreHtml(remaining) {
      return '<div class="load-more" id="loadMoreBtn">Load next ${PAGE_SIZE}… (' + remaining + ' remaining)</div>';
    }

    const listPane = document.getElementById('listPane');

    listPane.addEventListener('click', (e) => {
      hideCtxMenu();
      const itemEl = e.target.closest('.list-item');
      if (!itemEl) {
        const lm = e.target.closest('#loadMoreBtn');
        if (lm && !lm.classList.contains('loading')) {
          lm.classList.add('loading');
          lm.textContent = 'Loading…';
          vscode.postMessage({ command: 'loadMore' });
        }
        return;
      }
      const idx = parseInt(itemEl.dataset.index, 10);
      const item = items[idx];
      if (!item) return;
      if (item.rangeStart !== undefined) {
        if (item.expanded) {
          items.splice(idx + 1, item.expandedCount);
          item.expanded = false;
          item.expandedCount = 0;
          rerenderList(false, 0);
          select(idx);
        } else {
          itemEl.querySelector('.item-desc').textContent = 'loading…';
          vscode.postMessage({ command: 'loadRange', start: item.rangeStart, end: item.rangeEnd, listIndex: idx });
        }
      } else {
        select(idx);
      }
    });

    listPane.addEventListener('dblclick', (e) => {
      const itemEl = e.target.closest('.list-item');
      if (!itemEl) return;
      const idx = parseInt(itemEl.dataset.index, 10);
      const item = items[idx];
      if (item && item.oop) vscode.postMessage({ command: 'dive', oop: item.oop, label: item.label });
    });

    listPane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const itemEl = e.target.closest('.list-item');
      if (!itemEl) { hideCtxMenu(); return; }
      const idx = parseInt(itemEl.dataset.index, 10);
      const item = items[idx];
      if (!item || !item.oop) { hideCtxMenu(); return; }
      ctxTarget = item;
      showCtxMenu(e.clientX, e.clientY);
    });

    function showCtxMenu(x, y) {
      const menu = document.getElementById('ctxMenu');
      menu.style.display = 'block';
      const w = menu.offsetWidth || 130;
      const h = menu.offsetHeight || 68;
      menu.style.left = Math.min(x, window.innerWidth  - w - 4) + 'px';
      menu.style.top  = Math.min(y, window.innerHeight - h - 4) + 'px';
    }
    function hideCtxMenu() {
      document.getElementById('ctxMenu').style.display = 'none';
      ctxTarget = null;
    }

    document.addEventListener('click', hideCtxMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtxMenu(); });

    document.getElementById('ctxMenu').addEventListener('click', (e) => {
      const menuItem = e.target.closest('.ctx-item');
      if (!menuItem || !ctxTarget) return;
      const action = menuItem.dataset.action;
      if (action === 'dive')    vscode.postMessage({ command: 'dive',    oop: ctxTarget.oop, label: ctxTarget.label });
      if (action === 'inspect') vscode.postMessage({ command: 'inspect', oop: ctxTarget.oop, label: ctxTarget.label });
      hideCtxMenu();
    });

    // ── Nav bar buttons ───────────────────────

    document.getElementById('backBtn').addEventListener('click', () =>
      vscode.postMessage({ command: 'back' }));

    document.getElementById('rangeBtn').addEventListener('click', () =>
      vscode.postMessage({ command: 'toggleRanges' }));

    // ── Full render ───────────────────────────

    function rerenderList(hasMore, remaining) {
      let html = items.map((item, i) => makeItemHtml(item, i)).join('');
      if (hasMore) html += makeLoadMoreHtml(remaining);
      listPane.innerHTML = html;
    }

    function render(newItems, hasMore, remaining, canGoBack, currentLabel, showRanges, className) {
      items = newItems;
      selectedIndex = -1;
      document.getElementById('backBtn').disabled = !canGoBack;
      document.getElementById('objClass').textContent = className || '';
      const hasLabel = !!currentLabel;
      document.getElementById('objSep').style.display = hasLabel ? '' : 'none';
      document.getElementById('objLabel').textContent = hasLabel ? currentLabel : '';
      const rangeBtn = document.getElementById('rangeBtn');
      rangeBtn.textContent = showRanges ? 'Hide Ranges' : 'Show Ranges';
      rangeBtn.classList.toggle('active', showRanges);

      if (items.length === 0) {
        listPane.innerHTML = '<div class="placeholder">No items.</div>';
        document.getElementById('detailPane').innerHTML =
          '<div class="placeholder">Select an item to view its value.</div>';
        return;
      }
      rerenderList(hasMore, remaining);
      document.getElementById('detailPane').innerHTML =
        '<div class="placeholder">Select an item to view its value.</div>';
      select(0);
    }

    // ── Incremental append (non-ranged load-more) ─

    function appendItems(newItems, hasMore, remaining) {
      const startIndex = items.length;
      items.push(...newItems);
      const existing = document.getElementById('loadMoreBtn');
      if (existing) existing.remove();
      const frag = document.createDocumentFragment();
      const tmp = document.createElement('div');
      tmp.innerHTML = newItems.map((item, i) => makeItemHtml(item, startIndex + i)).join('');
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      if (hasMore) { tmp.innerHTML = makeLoadMoreHtml(remaining); frag.appendChild(tmp.firstChild); }
      listPane.appendChild(frag);
    }

    // ── Range expansion ───────────────────────

    function expandRange(listIndex, rangeItems) {
      items[listIndex].expanded = true;
      items[listIndex].expandedCount = rangeItems.length;
      items.splice(listIndex + 1, 0, ...rangeItems);
      rerenderList(false, 0);
      select(listIndex + 1);
    }

    // ── Message handler ───────────────────────

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if      (msg.command === 'loadItems')   render(msg.items, msg.hasMore, msg.remaining, msg.canGoBack, msg.currentLabel, msg.showRanges, msg.className);
      else if (msg.command === 'appendItems') appendItems(msg.items, msg.hasMore, msg.remaining);
      else if (msg.command === 'expandRange') expandRange(msg.listIndex, msg.items);
      else if (msg.command === 'fullValue') {
        // Cache on the item so re-selecting it doesn't re-fetch
        const item = items.find(it => it.oop === msg.oop);
        if (!item) return;
        item.fullValue = msg.value;
        // Update the visible content if this item is still selected and Full tab is active
        if (items[selectedIndex] === item) {
          const activeTab = document.querySelector('.tab.active');
          if (activeTab && activeTab.dataset.tab === 'full') {
            const contentEl = document.getElementById('detailValue');
            if (contentEl) contentEl.innerHTML = esc(msg.value);
          }
        }
      }
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
