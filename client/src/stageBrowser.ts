import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { ALL_METHODS_CATEGORY, SESSION_METHODS_CATEGORY } from './systemBrowser';
import { escapeSelectorSlashes, buildClassDefinitionUri } from './gemstoneFileSystemProvider';
import { filterMatches } from './stageBrowserFilter';

const VIEW_DICTS = 'gemstoneStageDicts';
const VIEW_CATEGORIES = 'gemstoneStageCategories';
const VIEW_CLASSES = 'gemstoneStageClasses';
const VIEW_METHODS = 'gemstoneStageMethods';
const STAGE_VIEWS = [VIEW_DICTS, VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS];

// ── Stage Browser (Stage 1) ────────────────────────────────────────────────
//
// A set of interconnected navigation panes that cascade left-to-right:
//   Dictionaries → Class Categories → Classes → Methods (side ▸ category ▸ sel)
// Selecting a method opens its source in an editor; the ↗ inline action (or
// right-click ▸ Open to the Side) opens it in a second editor group. Later
// Stages add the working-set "stage" pane; this Stage is navigation through to
// open source panes.
//
// The panes live in their own `gemstoneStage` sidebar container. All four share
// one controller that holds the cascade state, the current dictionary's
// class→category listing, and the selected class's per-method metadata
// (categories, override arrows, session-method flags).

interface StageState {
  dictName?: string;
  dictIndex?: number;             // 1-based symbolList position
  classCategory?: string;         // undefined = show all classes in dict
  className?: string;
  selectedSelector?: string;      // last method opened (shown in Methods title)
}

// Per-selector metadata derived from the class's environment data.
interface SelectorInfo {
  selector: string;
  category: string;               // real method category (for the source URI)
  overrideBits: number;           // 1 = overrides super, 2 = overridden below
  sessionBit: number;             // 0 = none, 1 = extension, 2 = override
}

// ── Tree item payload classes ───────────────────────────────────────────────

class DictItem extends vscode.TreeItem {
  constructor(public readonly dictName: string, public readonly dictIndex: number) {
    super(dictName, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
  }
}

class ClassCategoryItem extends vscode.TreeItem {
  constructor(public readonly category: string) {
    super(category, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('symbol-folder');
  }
}

class ClassItem extends vscode.TreeItem {
  constructor(public readonly className: string) {
    super(className, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('symbol-class');
  }
}

// Method pane is a 3-level tree: side ▸ method-category ▸ selector.
class MethodSideItem extends vscode.TreeItem {
  constructor(public readonly isMeta: boolean) {
    // Instance side opens expanded (so ALL METHODS shows immediately); the
    // class side starts collapsed to keep the default view focused.
    super(
      isMeta ? 'class' : 'instance',
      isMeta
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.iconPath = new vscode.ThemeIcon(isMeta ? 'symbol-constructor' : 'symbol-method');
  }
}

class MethodCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly isMeta: boolean,
    public readonly category: string,
    public readonly computed: boolean,
  ) {
    // ALL METHODS is the default landing view — expand it so selecting a class
    // immediately lists every method.
    super(
      category,
      category === ALL_METHODS_CATEGORY
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.iconPath = new vscode.ThemeIcon(computed ? 'list-flat' : 'symbol-folder');
  }
}

class MethodItem extends vscode.TreeItem {
  constructor(public readonly isMeta: boolean, public readonly info: SelectorInfo) {
    super(info.selector, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'stageMethod';

    // Indicators (tree items can't render italics, so we surface override/
    // session state via a compact glyph description + an explanatory tooltip).
    const marks: string[] = [];
    if (info.overrideBits & 1) marks.push('▲');
    if (info.overrideBits & 2) marks.push('▼');
    if (info.sessionBit === 1) marks.push('+');
    if (info.sessionBit === 2) marks.push('±');
    this.description = marks.join(' ');

    const lines = ['Click to open · $(split-horizontal) button opens to the side'];
    if (info.overrideBits & 1) lines.push('▲ overrides a superclass implementation');
    if (info.overrideBits & 2) lines.push('▼ overridden in a subclass');
    if (info.sessionBit === 1) lines.push('+ session method (extension — adds new behavior)');
    if (info.sessionBit === 2) lines.push('± session method (overrides a persistent base method)');
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    tooltip.supportThemeIcons = true;
    this.tooltip = tooltip;

    if (info.sessionBit) {
      this.iconPath = new vscode.ThemeIcon(
        'symbol-method',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
  }
}

type MethodNode = MethodSideItem | MethodCategoryItem | MethodItem;

// Views the controller updates with the current selection (shown as the greyed
// description beside each pane title).
interface StageViews {
  dict: vscode.TreeView<DictItem>;
  category: vscode.TreeView<ClassCategoryItem>;
  klass: vscode.TreeView<ClassItem>;
  method: vscode.TreeView<MethodNode>;
}

// ── Controller ───────────────────────────────────────────────────────────────

class StageBrowserController {
  readonly state: StageState = {};
  // className → category for the current dictionary; fetched once per dict.
  private classCategoryEntries: queries.ClassCategoryEntry[] = [];
  // Per-method metadata for the selected class; fetched once per class.
  private envLines: queries.EnvCategoryLine[] = [];
  private views?: StageViews;
  // Active filter pattern per pane (view id → pattern); empty/absent = no filter.
  private readonly filters = new Map<string, string>();
  // The pane whose filter input is currently open (so its header shows the
  // live "Filter: …" label while typing, even if a method is already selected).
  private filteringView?: string;

  readonly dictProvider = new DictProvider(this);
  readonly categoryProvider = new CategoryProvider(this);
  readonly classProvider = new ClassProvider(this);
  readonly methodProvider = new MethodProvider(this);

  constructor(private readonly sessionManager: SessionManager) {}

  session(): ActiveSession | undefined {
    return this.sessionManager.getSelectedSession();
  }

  setViews(views: StageViews): void {
    this.views = views;
    this.syncTitles();
  }

  private maxEnv(): number {
    return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
  }

  private syncTitles(): void {
    if (!this.views) return;
    // Show the live "Filter: …" label while this pane's filter input is open
    // (even over a prior selection) or whenever a filter is set with nothing
    // selected; otherwise the selection wins.
    const compose = (viewId: string, selection?: string, fallback = ''): string => {
      const f = this.filters.get(viewId);
      if (f && (this.filteringView === viewId || !selection)) return `Filter: ${f}`;
      return selection || fallback;
    };
    this.views.dict.description = compose(VIEW_DICTS, this.state.dictName);
    this.views.category.description = compose(VIEW_CATEGORIES, this.state.classCategory);
    this.views.klass.description = compose(VIEW_CLASSES, this.state.className);
    // Selected method wins; else the filter label; else the class name.
    this.views.method.description = compose(
      VIEW_METHODS, this.state.selectedSelector, this.state.className ?? '',
    );
  }

  getFilter(viewId: string): string | undefined {
    return this.filters.get(viewId);
  }

  private providerFor(viewId: string): RefreshableProvider<unknown> {
    switch (viewId) {
      case VIEW_DICTS: return this.dictProvider as RefreshableProvider<unknown>;
      case VIEW_CATEGORIES: return this.categoryProvider as RefreshableProvider<unknown>;
      case VIEW_CLASSES: return this.classProvider as RefreshableProvider<unknown>;
      default: return this.methodProvider as RefreshableProvider<unknown>;
    }
  }

  // Set (or clear, with an empty pattern) a pane's filter: updates the map, the
  // `gemstone.stageFiltered.<viewId>` context key that shows/hides its Clear
  // button, then refreshes the pane and titles.
  private setFilterState(viewId: string, pattern: string | undefined): void {
    if (pattern) this.filters.set(viewId, pattern);
    else this.filters.delete(viewId);
    void vscode.commands.executeCommand(
      'setContext', `gemstone.stageFiltered.${viewId}`, !!pattern,
    );
    this.providerFor(viewId).refresh();
    this.syncTitles();
  }

  clearFilter(viewId: string): void {
    this.setFilterState(viewId, undefined);
  }

  private clearFilters(...viewIds: string[]): void {
    for (const id of viewIds) this.setFilterState(id, undefined);
  }

  // Open a live filter input for a pane: prefix match, '*' wildcard. Typing
  // filters the pane immediately; an empty value clears the filter.
  beginFilter(viewId: string): void {
    const box = vscode.window.createInputBox();
    box.title = 'Filter';
    box.placeholder = 'starts with… (use * as a wildcard)';
    box.value = this.filters.get(viewId) ?? '';
    this.filteringView = viewId;
    this.syncTitles();
    box.onDidChangeValue((value) => this.setFilterState(viewId, value.trim() || undefined));
    box.onDidAccept(() => box.hide());
    box.onDidHide(() => {
      this.filteringView = undefined;
      this.syncTitles();
      box.dispose();
    });
    box.show();
  }

  applyFilter(names: string[], viewId: string): string[] {
    const pattern = this.filters.get(viewId);
    return pattern ? names.filter((n) => filterMatches(n, pattern)) : names;
  }

  // Called when the active session changes: reset everything and reload dicts.
  reset(): void {
    this.state.dictName = undefined;
    this.state.dictIndex = undefined;
    this.state.classCategory = undefined;
    this.state.className = undefined;
    this.state.selectedSelector = undefined;
    this.classCategoryEntries = [];
    this.envLines = [];
    this.clearFilters(...STAGE_VIEWS);
    this.dictProvider.refresh();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  selectDict(item: DictItem): void {
    this.state.dictName = item.dictName;
    this.state.dictIndex = item.dictIndex;
    this.state.classCategory = undefined;
    this.state.className = undefined;
    this.state.selectedSelector = undefined;
    this.envLines = [];
    this.clearFilters(VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS);
    const session = this.session();
    this.classCategoryEntries = session
      ? queries.getClassesWithCategory(session, item.dictIndex)
      : [];
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  selectClassCategory(item: ClassCategoryItem): void {
    this.state.classCategory = item.category;
    this.state.className = undefined;
    this.envLines = [];
    this.clearFilters(VIEW_CLASSES, VIEW_METHODS);
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  selectClass(item: ClassItem): void {
    this.state.className = item.className;
    this.state.selectedSelector = undefined;
    this.clearFilters(VIEW_METHODS);
    const session = this.session();
    this.envLines = session && this.state.dictIndex !== undefined
      ? queries.getClassEnvironments(session, this.state.dictIndex, item.className, this.maxEnv())
      : [];
    this.methodProvider.refresh();
    this.syncTitles();
    void this.openClassDefinition();
  }

  // Selecting a class opens its (editable, compilable) class-definition editor.
  private async openClassDefinition(): Promise<void> {
    const session = this.session();
    if (!session || this.state.dictName === undefined
      || this.state.className === undefined || this.state.dictIndex === undefined) {
      return;
    }
    const uri = buildClassDefinitionUri(
      session.id, this.state.dictName, this.state.className, this.state.dictIndex,
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
      preserveFocus: true,
    });
  }

  // Distinct, sorted class-categories for the selected dictionary.
  categories(): string[] {
    const set = new Set(this.classCategoryEntries.map((e) => e.category));
    return this.applyFilter([...set].sort((a, b) => a.localeCompare(b)), VIEW_CATEGORIES);
  }

  // Class names in the selected dictionary, filtered to the selected
  // class-category when one is chosen.
  classNames(): string[] {
    const { classCategory } = this.state;
    const names = this.classCategoryEntries
      .filter((e) => classCategory === undefined || e.category === classCategory)
      .map((e) => e.className);
    return this.applyFilter(
      [...new Set(names)].sort((a, b) => a.localeCompare(b)), VIEW_CLASSES,
    );
  }

  // Method categories for one side, with the computed ALL/SESSION rows on top.
  methodCategories(isMeta: boolean): MethodCategoryItem[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    if (lines.length === 0) return [];
    const real = [...new Set(lines.map((l) => l.category).filter((c) => c && c.length))]
      .sort((a, b) => a.localeCompare(b));
    const hasSession = lines.some(
      (l) => l.sessionMethodBits && Object.keys(l.sessionMethodBits).length > 0,
    );
    const items = [new MethodCategoryItem(isMeta, ALL_METHODS_CATEGORY, true)];
    if (hasSession) items.push(new MethodCategoryItem(isMeta, SESSION_METHODS_CATEGORY, true));
    return items.concat(real.map((c) => new MethodCategoryItem(isMeta, c, false)));
  }

  // Selectors under a category (real or computed) with per-method metadata.
  selectorsFor(isMeta: boolean, category: string): SelectorInfo[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    const realCategory: Record<string, string> = {};
    const overrideBits: Record<string, number> = {};
    const sessionBit: Record<string, number> = {};
    for (const line of lines) {
      for (const sel of line.selectors) {
        if (line.category && !realCategory[sel]) realCategory[sel] = line.category;
        if (line.methodOverrideBits?.[sel]) overrideBits[sel] |= line.methodOverrideBits[sel];
        if (line.sessionMethodBits?.[sel]) sessionBit[sel] = line.sessionMethodBits[sel];
      }
    }

    let selectors: string[];
    if (category === ALL_METHODS_CATEGORY) {
      selectors = Object.keys(realCategory);
    } else if (category === SESSION_METHODS_CATEGORY) {
      selectors = Object.keys(sessionBit);
    } else {
      selectors = [
        ...new Set(lines.filter((l) => l.category === category).flatMap((l) => l.selectors)),
      ];
    }

    return selectors
      .sort((a, b) => a.localeCompare(b))
      .map((sel) => ({
        selector: sel,
        category: realCategory[sel] || 'as yet unclassified',
        overrideBits: overrideBits[sel] || 0,
        sessionBit: sessionBit[sel] || 0,
      }));
  }

  async openMethod(node: MethodItem, toSide = false): Promise<void> {
    const session = this.session();
    if (!session || this.state.dictName === undefined || this.state.className === undefined) {
      return;
    }
    this.state.selectedSelector = node.info.selector;
    this.syncTitles();
    const side = node.isMeta ? 'class' : 'instance';
    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(this.state.dictName)}/` +
      `${encodeURIComponent(this.state.className)}/${side}/` +
      `${encodeURIComponent(node.info.category)}/` +
      `${encodeURIComponent(escapeSelectorSlashes(node.info.selector))}`,
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      // Single-click swaps in place (preview); "open to the side" pins a real
      // tab in the neighbouring group so methods can be compared.
      viewColumn: toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      preview: !toSide,
      // Keep keyboard focus in the tree on a plain click so type-to-filter,
      // Ctrl+F, and arrow-key navigation keep working (the editor still updates
      // live). An explicit open-to-side takes you into the new editor.
      preserveFocus: !toSide,
    });
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────

abstract class RefreshableProvider<T> implements vscode.TreeDataProvider<T> {
  protected _onDidChangeTreeData = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  abstract getChildren(element?: T): T[];
  getTreeItem(element: T): vscode.TreeItem {
    return element as unknown as vscode.TreeItem;
  }
}

class DictProvider extends RefreshableProvider<DictItem> {
  constructor(private readonly ctl: StageBrowserController) {
    super();
  }
  getChildren(element?: DictItem): DictItem[] {
    if (element) return [];
    const session = this.ctl.session();
    if (!session) return [];
    return queries
      .getDictionaryNames(session)
      .map((name, i) => new DictItem(name, i + 1))
      .filter((d) => filterMatches(d.dictName, this.ctl.getFilter(VIEW_DICTS)));
  }
}

class CategoryProvider extends RefreshableProvider<ClassCategoryItem> {
  constructor(private readonly ctl: StageBrowserController) {
    super();
  }
  getChildren(element?: ClassCategoryItem): ClassCategoryItem[] {
    if (element || this.ctl.state.dictName === undefined) return [];
    return this.ctl.categories().map((c) => new ClassCategoryItem(c));
  }
}

class ClassProvider extends RefreshableProvider<ClassItem> {
  constructor(private readonly ctl: StageBrowserController) {
    super();
  }
  getChildren(element?: ClassItem): ClassItem[] {
    if (element || this.ctl.state.dictName === undefined) return [];
    return this.ctl.classNames().map((n) => new ClassItem(n));
  }
}

class MethodProvider extends RefreshableProvider<MethodNode> {
  constructor(private readonly ctl: StageBrowserController) {
    super();
  }
  getChildren(element?: MethodNode): MethodNode[] {
    if (this.ctl.state.className === undefined) return [];

    if (!element) {
      return [new MethodSideItem(false), new MethodSideItem(true)];
    }
    if (element instanceof MethodSideItem) {
      // With a filter active, drop the category grouping and show matching
      // selectors directly under each side — "everything starting with r".
      const filter = this.ctl.getFilter(VIEW_METHODS);
      if (filter) {
        return this.ctl
          .selectorsFor(element.isMeta, ALL_METHODS_CATEGORY)
          .filter((info) => filterMatches(info.selector, filter))
          .map((info) => new MethodItem(element.isMeta, info));
      }
      return this.ctl.methodCategories(element.isMeta);
    }
    if (element instanceof MethodCategoryItem) {
      return this.ctl
        .selectorsFor(element.isMeta, element.category)
        .map((info) => new MethodItem(element.isMeta, info));
    }
    return [];
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerStageBrowser(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): void {
  const ctl = new StageBrowserController(sessionManager);

  // Gate the downstream panes (and swap the Dictionaries welcome) on whether a
  // session is available to browse.
  const syncActiveContext = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.stageBrowserActive',
      sessionManager.getSelectedSession() !== undefined,
    );
  };
  syncActiveContext();

  const dictView = vscode.window.createTreeView('gemstoneStageDicts', {
    treeDataProvider: ctl.dictProvider,
  });
  const categoryView = vscode.window.createTreeView('gemstoneStageCategories', {
    treeDataProvider: ctl.categoryProvider,
  });
  const classView = vscode.window.createTreeView('gemstoneStageClasses', {
    treeDataProvider: ctl.classProvider,
  });
  const methodView = vscode.window.createTreeView('gemstoneStageMethods', {
    treeDataProvider: ctl.methodProvider,
    showCollapseAll: true,
  });
  ctl.setViews({ dict: dictView, category: categoryView, klass: classView, method: methodView });

  dictView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectDict(e.selection[0]);
  });
  categoryView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectClassCategory(e.selection[0]);
  });
  classView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectClass(e.selection[0]);
  });
  methodView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    if (node instanceof MethodItem) void ctl.openMethod(node);
  });

  context.subscriptions.push(
    dictView,
    categoryView,
    classView,
    methodView,
    sessionManager.onDidChangeSelection(() => {
      syncActiveContext();
      ctl.reset();
    }),
    vscode.commands.registerCommand('gemstone.stageBrowser.refresh', () => ctl.reset()),
    // Per-pane filter buttons: open a live filter input (prefix match, '*'
    // wildcard) that filters the pane in place — works regardless of where
    // focus currently sits (e.g. the editor).
    ...STAGE_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.filter`, () => ctl.beginFilter(viewId)),
    ),
    // Clear buttons: shown (via the gemstone.stageFiltered.<viewId> context key)
    // only when that pane has an active filter.
    ...STAGE_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.clearFilter`, () => ctl.clearFilter(viewId)),
    ),
    vscode.commands.registerCommand(
      'gemstone.stageBrowser.openMethodToSide',
      (node: MethodItem) => {
        if (node instanceof MethodItem) void ctl.openMethod(node, true);
      },
    ),
  );
}
