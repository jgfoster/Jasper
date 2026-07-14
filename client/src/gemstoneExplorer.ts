import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { ALL_METHODS_CATEGORY, SESSION_METHODS_CATEGORY } from './systemBrowser';
import {
  escapeSelectorSlashes, unescapeSelectorSlashes, buildClassDefinitionUri, buildNewMethodUri,
  buildMethodUri,
} from './gemstoneFileSystemProvider';
import { filterMatches } from './explorerFilter';
import { DoubleClickDetector } from './explorerDoubleClick';
import { categoryChildNodes, categoryParentPath, categoryMatches } from './explorerCategories';
import { registerExplorerOpenEditors } from './explorerOpenEditors';
import { SourceEditorPlacement } from './sourceEditorPlacement';
import { generateAndSaveGrailStub } from './grailStubGenerator';

const VIEW_DICTS = 'gemstoneExplorerDicts';
const VIEW_CATEGORIES = 'gemstoneExplorerCategories';
const VIEW_CLASSES = 'gemstoneExplorerClasses';
const VIEW_METHODS = 'gemstoneExplorerMethods';
// Panes that support the live filter (the Hierarchy pane doesn't).
const EXPLORER_VIEWS = [VIEW_DICTS, VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS];

// Open a gemstone:// source document in the editor area. A plain open replaces
// the active preview tab (keeping focus in the tree for live browsing); an
// open-to-side pins the editor in a balanced column so several editors spread
// across a few of OUR groups instead of clumping. `placement` scopes the
// balancing to editors this Explorer opened, so it doesn't invade the System
// Browser's group (see sourceEditorPlacement.ts).
async function openGemstoneDocument(
  doc: vscode.TextDocument, toSide: boolean, placement: SourceEditorPlacement,
): Promise<void> {
  if (!toSide) {
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active, preview: true, preserveFocus: true,
    });
    placement.remember(doc.uri);
    return;
  }
  const target = placement.balancedColumn();
  if (target === 'new') {
    // Append a fresh group at the far right: focus the last group first so
    // Beside lands to its right. (A numeric column past the end is treated as
    // "beside the active group", which isn't reliably the rightmost.)
    await vscode.commands.executeCommand('workbench.action.focusLastEditorGroup');
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
    });
  } else {
    await vscode.window.showTextDocument(doc, {
      viewColumn: target, preview: false, preserveFocus: false,
    });
  }
  placement.remember(doc.uri);
}

// ── GemStone Explorer ───────────────────────────────────────────────────────
//
// A set of interconnected navigation panes that cascade left-to-right:
//   Dictionaries → Class Categories → Classes → Methods (side ▸ category ▸ sel)
// Selecting a method opens its source in an editor; the ↗ inline action (or
// right-click ▸ Open to the Side) opens it in a balanced editor group. The
// Open Editors pane mirrors the currently-open source editors.
//
// The panes live in their own `gemstoneExplorer` sidebar container. All four share
// one controller that holds the cascade state, the current dictionary's
// class→category listing, and the selected class's per-method metadata
// (categories, override arrows, session-method flags).

interface ExplorerState {
  dictName?: string;
  dictIndex?: number;             // 1-based symbolList position
  classCategory?: string;         // undefined = show all classes in dict
  className?: string;
  selectedSelector?: string;      // last method opened (kept for reference)
  // Context recorded from the Methods pane so New Method / New Method Category
  // land on the right side/category even without a method currently selected.
  selectedIsMeta?: boolean;
  selectedMethodCategory?: string;
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
    // Stable id so TreeView.reveal (used by Find Class) can locate this row.
    this.id = `d:${dictIndex}:${dictName}`;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
  }
}

// Class categories render as a tree keyed on '-' segments: "Announcements-Core"
// is a child of "Announcements". `fullPath` is the whole dash-joined category;
// `segment` is just this node's piece. Selecting a node shows the classes in
// that category AND all of its sub-categories (prefix match).
class ClassCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly segment: string,
    public readonly fullPath: string,
    hasChildren: boolean,
  ) {
    super(segment, hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `c:${fullPath}`;
    this.contextValue = 'explorerCategory';
    this.iconPath = new vscode.ThemeIcon('symbol-folder');
    if (fullPath !== segment) this.tooltip = fullPath;
  }
}

class ClassItem extends vscode.TreeItem {
  // `hasIvars` drives the expansion caret: a class with locally-defined instance
  // variables opens to reveal its ivar sub-tree; one without stays flat. It never
  // affects the stable `id`, so TreeView.reveal still matches regardless.
  constructor(public readonly className: string, hasIvars = false) {
    super(className, hasIvars
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `k:${className}`;
    this.contextValue = 'explorerClass';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    // Fires on every click (selection still drives navigation separately); the
    // controller uses the timing to detect a double-click → open definition.
    this.command = {
      command: 'gemstone.explorer.classClicked',
      title: '',
      arguments: [className],
    };
  }
}

// A locally-defined instance variable, shown as a child of its ClassItem. The
// pencil (inline) action renames it; selecting the row does not navigate.
class IvarItem extends vscode.TreeItem {
  constructor(public readonly className: string, public readonly ivarName: string) {
    super(ivarName, vscode.TreeItemCollapsibleState.None);
    this.id = `k:${className}/iv:${ivarName}`;
    this.contextValue = 'explorerIvar';
    this.iconPath = new vscode.ThemeIcon('symbol-field');
    this.tooltip = `Instance variable defined in ${className}`;
  }
}

type ClassNode = ClassItem | IvarItem;

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
    this.id = `mside:${isMeta}`;
    // Both instance/class side headers use the class icon — distinct from the
    // per-method rows (symbol-method) so a header doesn't read as a method.
    this.iconPath = new vscode.ThemeIcon('symbol-class');
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
    this.id = `mcat:${isMeta}:${category}`;
    this.iconPath = new vscode.ThemeIcon(computed ? 'list-flat' : 'symbol-folder');
  }
}

class MethodItem extends vscode.TreeItem {
  // `displayCategory` is the category node this row is shown *under* (a real
  // category, ALL METHODS, SESSION METHODS, or undefined when flattened by a
  // filter). It's needed so MethodProvider.getParent can walk up for reveal().
  constructor(
    public readonly isMeta: boolean,
    public readonly info: SelectorInfo,
    public readonly displayCategory?: string,
  ) {
    super(info.selector, vscode.TreeItemCollapsibleState.None);
    this.id = `msel:${isMeta}:${displayCategory ?? ''}:${info.selector}`;
    // The context value carries the indicator state so the right-click menu can
    // offer superclass/subclass-implementation browsing only where an override
    // arrow is actually present (▲ overrides super, ▼ overridden below). Base
    // Senders/Implementors are always offered on the plain `explorerMethod` token.
    this.contextValue = 'explorerMethod'
      + (info.overrideBits & 1 ? '.up' : '')
      + (info.overrideBits & 2 ? '.down' : '')
      + (info.sessionBit ? '.session' : '');

    // Indicators (tree items can't render italics, so we surface override/
    // session state via a compact glyph description + an explanatory tooltip).
    const marks: string[] = [];
    if (info.overrideBits & 1) marks.push('▲');
    if (info.overrideBits & 2) marks.push('▼');
    if (info.sessionBit === 1) marks.push('+');
    if (info.sessionBit === 2) marks.push('±');
    this.description = marks.join(' ');

    // Encode the selector/side as a command-link argument so the tooltip lines
    // below are *clickable* (a guaranteed-working path to the browse actions,
    // independent of whether the inline row buttons render).
    const arg = encodeURIComponent(JSON.stringify([{ selector: info.selector, isMeta }]));
    const cmd = (id: string) => `command:gemstone.explorer.${id}?${arg}`;

    const lines = ['Click to open · $(split-horizontal) opens to the side'];
    lines.push(`[Implementors](${cmd('implementorsOf')}) · [Senders](${cmd('sendersOf')})`);
    if (info.overrideBits & 1) {
      lines.push(`[▲ Superclass implementors](${cmd('superImplementors')}) — overrides a superclass method`);
    }
    if (info.overrideBits & 2) {
      lines.push(`[▼ Subclass overrides](${cmd('subOverrides')}) — overridden in a subclass`);
    }
    if (info.sessionBit === 1) lines.push('+ session method (extension — adds new behavior)');
    if (info.sessionBit === 2) lines.push('± session method (overrides a persistent base method)');
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    tooltip.supportThemeIcons = true;
    tooltip.isTrusted = true; // required for command: links to be clickable
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

// ── Hierarchy pane ───────────────────────────────────────────────────────────
// Shows the selected class's lineage: superclasses (root-first) → the class
// itself → its immediate subclasses. Clicking any row navigates to that class.
class HierarchyItem extends vscode.TreeItem {
  constructor(
    public readonly className: string,
    public readonly dictName: string,
    public readonly role: 'ancestor' | 'self' | 'subclass',
    // Position in the ancestor→self chain; -1 for subclasses.
    public readonly chainIndex: number,
    hasChildren: boolean,
  ) {
    super(className, hasChildren
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None);
    this.id = `h:${role}:${chainIndex}:${className}`;
    this.contextValue = 'explorerHierClass';
    // The current class is shown by keeping it *selected* in this pane (synced
    // with the Classes pane), so no extra "current" label is needed; up/down
    // arrows distinguish superclasses from subclasses.
    this.iconPath = new vscode.ThemeIcon(
      role === 'self' ? 'symbol-class'
        : role === 'ancestor' ? 'arrow-small-up' : 'arrow-small-down',
    );
  }
}

// The browse commands accept either a tree item (inline button / right-click) or
// a plain {selector, isMeta} payload (from a tooltip command: link, which can
// only carry JSON). Normalize both to the selector + side.
// Payload carried while dragging a method (same-window drag keeps the object).
interface MethodDragPayload {
  selector: string;
  isMeta: boolean;
  category: string;
  className: string;
  dictName: string;
  dictIndex: number;
}
const METHOD_MIME = 'application/vnd.gemstone.explorermethod';

type MethodCommandArg = MethodItem | { selector: string; isMeta: boolean } | undefined;
function methodArg(arg: MethodCommandArg): { selector: string; isMeta: boolean } | undefined {
  if (arg instanceof MethodItem) return { selector: arg.info.selector, isMeta: arg.isMeta };
  if (arg && typeof arg.selector === 'string') return { selector: arg.selector, isMeta: !!arg.isMeta };
  return undefined;
}

// Views the controller updates with the current selection (shown as the greyed
// description beside each pane title).
interface ExplorerViews {
  dict: vscode.TreeView<DictItem>;
  category: vscode.TreeView<ClassCategoryItem>;
  klass: vscode.TreeView<ClassNode>;
  hierarchy: vscode.TreeView<HierarchyItem>;
  method: vscode.TreeView<MethodNode>;
}

// ── Controller ───────────────────────────────────────────────────────────────

class ExplorerController {
  readonly state: ExplorerState = {};
  // className → category for the current dictionary; fetched once per dict.
  private classCategoryEntries: queries.ClassCategoryEntry[] = [];
  // className → count of locally-defined instance variables, for the current
  // dictionary; fetched once per dict so class rows know whether to show an
  // expansion caret. Names are fetched lazily on expand and memoized here.
  private definedIvarCounts = new Map<string, number>();
  private readonly definedIvarNamesCache = new Map<string, string[]>();
  // Per-method metadata for the selected class; fetched once per class.
  private envLines: queries.EnvCategoryLine[] = [];
  private views?: ExplorerViews;
  // Active filter pattern per pane (view id → pattern); empty/absent = no filter.
  private readonly filters = new Map<string, string>();
  // The pane whose filter input is currently open (so its header shows the
  // live "Filter: …" label while typing, even if a method is already selected).
  private filteringView?: string;
  // Freshly-created (via the + button) class categories that have no class yet,
  // so they still appear in the Class Categories pane. Cleared on dict change.
  private readonly newClassCategories = new Set<string>();
  // Freshly-created method categories, per side, that hold no method yet.
  // Cleared on class change.
  private readonly newMethodCategories = { instance: new Set<string>(), meta: new Set<string>() };
  // URI of an editor we opened ourselves (method/definition click); syncToEditor
  // ignores its own open so a tree click doesn't bounce the selection.
  private selfOpenedUri?: string;
  // Owns where our source editors land. Balances "open to the side" across only
  // our own groups, so we neither clump nor invade the System Browser's group.
  readonly placement = new SourceEditorPlacement();

  readonly dictProvider = new DictProvider(this);
  readonly categoryProvider = new CategoryProvider(this);
  readonly classProvider = new ClassProvider(this);
  readonly hierarchyProvider = new HierarchyProvider(this);
  readonly methodProvider = new MethodProvider(this);

  // Selected class's lineage: [superclasses root-first…, self] and its subclasses.
  private hierChain: queries.ClassHierarchyEntry[] = [];
  private hierSubs: queries.ClassHierarchyEntry[] = [];

  constructor(private readonly sessionManager: SessionManager) {}

  session(): ActiveSession | undefined {
    return this.sessionManager.getSelectedSession();
  }

  setViews(views: ExplorerViews): void {
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
    this.views.hierarchy.description = this.state.className ?? '';
    // The Methods header reflects what is *currently* selected in the tree — not
    // the last method that happened to be opened. So when the filter input is
    // cleared (backspaced to empty) or dismissed with nothing selected, the
    // header goes blank — matching the other three panes — rather than a stale
    // selector or a redundant class name. See `currentMethodSelector`.
    this.views.method.description = compose(VIEW_METHODS, this.currentMethodSelector());
  }

  // The selector of the method row currently selected in the Methods pane, or
  // undefined when nothing (or a non-method row) is selected. Reads the live
  // TreeView selection so it can't go stale. Falls back to the last-opened
  // selector only when the view can't report a selection (e.g. under test mocks).
  private currentMethodSelector(): string | undefined {
    const selection = this.views?.method.selection;
    if (!selection) return this.state.selectedSelector;
    const item = selection.find((n) => n instanceof MethodItem) as MethodItem | undefined;
    return item?.info.selector;
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
  // `gemstone.explorerFiltered.<viewId>` context key that shows/hides its Clear
  // button, then refreshes the pane and titles.
  private setFilterState(viewId: string, pattern: string | undefined): void {
    if (pattern) this.filters.set(viewId, pattern);
    else this.filters.delete(viewId);
    void vscode.commands.executeCommand(
      'setContext', `gemstone.explorerFiltered.${viewId}`, !!pattern,
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
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.classCategoryEntries = [];
    this.definedIvarCounts = new Map();
    this.definedIvarNamesCache.clear();
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.newClassCategories.clear();
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(...EXPLORER_VIEWS);
    this.dictProvider.refresh();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // Re-fetch everything for the CURRENT selection WITHOUT clearing it — the
  // manual Refresh button and a session abort both use this so a stale tree
  // reloads in place (new/removed classes, recompiled methods) while the user
  // stays where they were. Unlike reset(), state and filters are preserved.
  async refreshRetainingSelection(): Promise<void> {
    const session = this.session();
    const { dictName, dictIndex, className } = this.state;
    // Remember the method row currently selected so it can be re-revealed.
    const selectedMethod = this.views?.method.selection
      .find((n) => n instanceof MethodItem) as MethodItem | undefined;
    const revealMethod = selectedMethod
      ? { selector: selectedMethod.info.selector, isMeta: selectedMethod.isMeta }
      : undefined;

    if (!session || dictName === undefined || dictIndex === undefined) {
      // Nothing meaningful selected — just reload the dictionary list.
      this.dictProvider.refresh();
      this.syncTitles();
      return;
    }

    // Reload the dictionary's class listing (+ ivar counts) and, when a class is
    // selected, its method environment and hierarchy. Keep stale data on a failed
    // fetch rather than blanking the tree out from under the user.
    try {
      this.classCategoryEntries = queries.getClassesWithCategory(session, dictIndex);
    } catch { /* keep stale on failure */ }
    this.loadDefinedIvarCounts();
    if (className !== undefined) {
      try {
        this.envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
      } catch { /* keep stale on failure */ }
      this.loadHierarchy();
    }

    this.dictProvider.refresh();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();

    await this.revealRetainedSelection(revealMethod);
    this.syncTitles();
  }

  // Re-highlight the retained dict/category/class/method rows after a refresh.
  // reveal() rejects when a row isn't in the (rebuilt) tree; treat each as a
  // best-effort highlight, exactly like revealClass does.
  private async revealRetainedSelection(
    revealMethod?: { selector: string; isMeta: boolean },
  ): Promise<void> {
    const { dictName, dictIndex, classCategory, className } = this.state;
    if (dictName !== undefined && dictIndex !== undefined) {
      try {
        await this.views?.dict.reveal(new DictItem(dictName, dictIndex), { select: true });
      } catch { /* ignore */ }
    }
    if (classCategory) {
      const segment = classCategory.split('-').pop() ?? classCategory;
      try {
        await this.views?.category.reveal(
          new ClassCategoryItem(segment, classCategory, false), { select: true, expand: true },
        );
      } catch { /* ignore */ }
    }
    if (className !== undefined) {
      try {
        await this.views?.klass.reveal(
          new ClassItem(className, this.classHasDefinedIvars(className)), { select: true },
        );
      } catch { /* ignore */ }
    }
    void this.revealHierarchySelf();
    if (revealMethod) {
      const info = this.selectorsFor(revealMethod.isMeta, ALL_METHODS_CATEGORY)
        .find((i) => i.selector === revealMethod.selector);
      if (info) {
        try {
          await this.views?.method.reveal(
            new MethodItem(revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
            { select: true, focus: false, expand: true },
          );
        } catch { /* ignore */ }
      }
    }
  }

  // A session abort discards uncommitted changes and refreshes the session's
  // view of the repository, so the Explorer's cached listing can be stale.
  // Reload in place (keeping the selection) when it's OUR current session.
  onSessionAborted(sessionId: number): void {
    const session = this.session();
    if (!session || session.id !== sessionId) return;
    void this.refreshRetainingSelection();
  }

  selectDict(item: DictItem): void {
    this.state.dictName = item.dictName;
    this.state.dictIndex = item.dictIndex;
    this.state.classCategory = undefined;
    this.state.className = undefined;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.newClassCategories.clear();
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS);
    const session = this.session();
    this.classCategoryEntries = session
      ? queries.getClassesWithCategory(session, item.dictIndex)
      : [];
    this.loadDefinedIvarCounts();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  selectClassCategory(item: ClassCategoryItem): void {
    this.state.classCategory = item.fullPath;
    this.state.className = undefined;
    this.envLines = [];
    this.hierChain = [];
    this.hierSubs = [];
    this.clearFilters(VIEW_CLASSES, VIEW_METHODS);
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // Record which side / method-category the user last touched in the Methods
  // pane, so New Method and New Method Category default to the right place.
  recordMethodContext(isMeta: boolean, category?: string): void {
    this.state.selectedIsMeta = isMeta;
    this.state.selectedMethodCategory = category;
  }

  selectClass(item: ClassItem): void {
    this.state.className = item.className;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.clearFilters(VIEW_METHODS);
    const session = this.session();
    this.envLines = session && this.state.dictIndex !== undefined
      ? queries.getClassEnvironments(session, this.state.dictIndex, item.className, this.maxEnv())
      : [];
    this.loadHierarchy();
    this.methodProvider.refresh();
    this.hierarchyProvider.refresh();
    void this.revealHierarchySelf();
    this.syncTitles();
    // NOTE: a plain class click no longer auto-opens the definition editor —
    // that cluttered the editor area with a definition tab per class browsed.
    // Use the inline "Open Definition" button (gemstone.explorer.openDefinition).
  }

  // Resolve a class's dictionary (name + 1-based index). Prefers the given dict
  // name; falls back to a full class-name lookup when it's blank/unresolvable.
  private resolveClassDict(
    className: string, dictName?: string,
  ): { dictName: string; dictIndex: number } | undefined {
    const session = this.session();
    if (!session) return undefined;
    if (dictName) {
      const index = queries.getDictionaryNames(session).indexOf(dictName) + 1;
      if (index > 0) return { dictName, dictIndex: index };
    }
    const match = queries.getAllClassNames(session).find((e) => e.className === className);
    return match ? { dictName: match.dictName, dictIndex: match.dictIndex } : undefined;
  }

  // Open a class's (editable, compilable) definition editor. `item` comes from
  // the inline button (which doesn't change tree selection); falls back to the
  // currently-selected class for Find Class / new-class flows. `toSide` pins it
  // in the neighbouring editor group so several definitions can be compared.
  async openClassDefinition(item?: ClassItem, toSide = false): Promise<void> {
    const className = item?.className ?? this.state.className;
    if (this.state.dictName === undefined
      || className === undefined || this.state.dictIndex === undefined) {
      return;
    }
    await this.openDefinitionFor(className, this.state.dictName, this.state.dictIndex, toSide);
  }

  // Generate an editable Grail `.py` stub for a class. Invoked from the Classes-
  // and Hierarchy-pane context menus (with a tree item) or the Command Palette
  // (no item — falls back to the current selection, then a class picker).
  async generateGrailStub(item?: ClassItem | HierarchyItem): Promise<void> {
    const session = this.session();
    if (!session) {
      void vscode.window.showWarningMessage('No active GemStone session.');
      return;
    }

    let className: string | undefined;
    let dictName: string | undefined;
    let dictIndex: number | undefined;
    if (item instanceof ClassItem) {
      className = item.className;
      dictName = this.state.dictName;
      dictIndex = this.state.dictIndex;
    } else if (item instanceof HierarchyItem) {
      className = item.className;
      const resolved = this.resolveClassDict(item.className, item.dictName);
      dictName = resolved?.dictName;
      dictIndex = resolved?.dictIndex;
    } else if (this.state.className) {
      className = this.state.className;
      dictName = this.state.dictName;
      dictIndex = this.state.dictIndex;
    }

    if (!className) {
      const entry = await this.pickClass(session);
      if (!entry) return;
      ({ className, dictName, dictIndex } = entry);
    }
    if (!dictName || dictIndex === undefined) {
      const resolved = this.resolveClassDict(className, dictName);
      if (!resolved) {
        void vscode.window.showWarningMessage(`Can't locate class ${className}.`);
        return;
      }
      ({ dictName, dictIndex } = resolved);
    }

    await generateAndSaveGrailStub(session, className, dictName, dictIndex);
  }

  // Prompt for a class across the whole symbolList (Command Palette entry point).
  private async pickClass(
    session: ActiveSession,
  ): Promise<{ className: string; dictName: string; dictIndex: number } | undefined> {
    const classes = queries.getAllClassNames(session);
    if (classes.length === 0) {
      void vscode.window.showInformationMessage('No classes found in this session.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      classes.map(c => ({ label: c.className, description: c.dictName, entry: c })),
      { placeHolder: 'Select a class to generate a Grail .py stub for', matchOnDescription: true },
    );
    return picked
      ? { className: picked.entry.className, dictName: picked.entry.dictName, dictIndex: picked.entry.dictIndex }
      : undefined;
  }

  // Open the definition of a class shown in the Hierarchy pane (which may live
  // in a different dictionary than the one currently browsed). Opens to the side
  // like the Classes-pane button, without changing the navigator selection.
  async openHierarchyDefinition(item: HierarchyItem): Promise<void> {
    const resolved = this.resolveClassDict(item.className, item.dictName);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Can't locate class ${item.className}.`);
      return;
    }
    await this.openDefinitionFor(item.className, resolved.dictName, resolved.dictIndex, true);
  }

  private async openDefinitionFor(
    className: string, dictName: string, dictIndex: number, toSide: boolean,
  ): Promise<void> {
    const session = this.session();
    if (!session) return;
    const uri = buildClassDefinitionUri(session.id, dictName, className, dictIndex);
    this.selfOpenedUri = uri.toString();
    const doc = await vscode.workspace.openTextDocument(uri);
    await openGemstoneDocument(doc, toSide, this.placement);
  }

  // Manual double-click detection for the Classes pane: VS Code trees have no
  // double-click event, so a class row's `command` (fired on each click) records
  // the click; two on the same class within the threshold open its definition.
  private readonly classClicks = new DoubleClickDetector(500);
  handleClassClick(className: string): void {
    if (this.classClicks.register(className)) {
      void this.openClassDefinition(new ClassItem(className));
    }
  }

  // ── Hierarchy pane ──────────────────────────────────────────────────────────

  // Fetch the selected class's superclass chain + immediate subclasses.
  private loadHierarchy(): void {
    const session = this.session();
    if (!session || this.state.className === undefined) {
      this.hierChain = [];
      this.hierSubs = [];
      return;
    }
    let entries: queries.ClassHierarchyEntry[];
    try {
      entries = queries.getClassHierarchy(session, this.state.className);
    } catch {
      this.hierChain = [];
      this.hierSubs = [];
      return;
    }
    const supers = entries.filter((e) => e.kind === 'superclass');
    const self = entries.find((e) => e.kind === 'self');
    // chain = superclasses (root-first) then the class itself (last element).
    this.hierChain = self ? [...supers, self] : supers;
    this.hierSubs = entries.filter((e) => e.kind === 'subclass');
  }

  // Children of a hierarchy node (for HierarchyProvider): the chain nests as a
  // single branch (each ancestor's only child is the next), and the class itself
  // parents its subclasses.
  hierarchyChildren(element?: HierarchyItem): HierarchyItem[] {
    if (this.hierChain.length === 0) return [];
    const lastIdx = this.hierChain.length - 1;
    const chainItem = (i: number): HierarchyItem => {
      const e = this.hierChain[i];
      const isSelf = i === lastIdx;
      const hasChildren = !isSelf || this.hierSubs.length > 0;
      return new HierarchyItem(e.className, e.dictName, isSelf ? 'self' : 'ancestor', i, hasChildren);
    };
    if (!element) return [chainItem(0)];
    if (element.role === 'subclass') return [];
    if (element.chainIndex < lastIdx) return [chainItem(element.chainIndex + 1)];
    // element is the current class → list its subclasses.
    return this.hierSubs.map((s) => new HierarchyItem(s.className, s.dictName, 'subclass', -1, false));
  }

  // Select the current class's node in the Hierarchy pane so its selection stays
  // in sync with the Classes pane.
  async revealHierarchySelf(): Promise<void> {
    if (this.hierChain.length === 0) return;
    const lastIdx = this.hierChain.length - 1;
    const e = this.hierChain[lastIdx];
    const self = new HierarchyItem(e.className, e.dictName, 'self', lastIdx, this.hierSubs.length > 0);
    try {
      await this.views?.hierarchy.reveal(self, { select: true, focus: false });
    } catch { /* ignore */ }
  }

  hierarchyParent(element: HierarchyItem): HierarchyItem | undefined {
    if (element.role === 'subclass') {
      const selfIdx = this.hierChain.length - 1;
      if (selfIdx < 0) return undefined;
      const e = this.hierChain[selfIdx];
      return new HierarchyItem(e.className, e.dictName, 'self', selfIdx, true);
    }
    if (element.chainIndex <= 0) return undefined;
    const i = element.chainIndex - 1;
    const e = this.hierChain[i];
    return new HierarchyItem(e.className, e.dictName, 'ancestor', i, true);
  }

  // Clicking a hierarchy node navigates to that class (which reloads the
  // hierarchy centered on it, plus the methods and the other panes).
  selectHierarchyNode(item: HierarchyItem): void {
    if (item.role === 'self') return; // already the current class
    // The hierarchy query supplies a dict name, but it can be blank (a class
    // reachable only in another symbol-list scope); the resolver falls back to a
    // full class-name lookup so nodes like Object always navigate.
    const resolved = this.resolveClassDict(item.className, item.dictName);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Can't locate class ${item.className}.`);
      return;
    }
    void this.revealClass(resolved.dictName, resolved.dictIndex, item.className);
  }

  // All distinct category paths in the current dictionary (incl. just-created).
  private allCategoryPaths(): string[] {
    const set = new Set(
      this.classCategoryEntries.map((e) => e.category).filter((c) => c && c.length),
    );
    for (const c of this.newClassCategories) set.add(c);
    return [...set];
  }

  // When the category pane is filtered, it drops the tree and shows a flat list
  // of matching full category paths (mirrors the Methods pane's filter mode).
  categoryFilterActive(): boolean {
    return this.getFilter(VIEW_CATEGORIES) !== undefined;
  }
  filteredCategoryPaths(): string[] {
    return this.applyFilter(
      this.allCategoryPaths().sort((a, b) => a.localeCompare(b)), VIEW_CATEGORIES,
    );
  }

  // Direct child category-nodes under `parentPath` (undefined = top level),
  // built from the '-' segments of every category path (see explorerCategories).
  categoryChildren(parentPath?: string): { segment: string; fullPath: string; hasChildren: boolean }[] {
    return categoryChildNodes(this.allCategoryPaths(), parentPath);
  }

  // The parent node of a category path (for TreeView.reveal / getParent), or
  // undefined when it's a top-level segment.
  categoryParent(fullPath: string): ClassCategoryItem | undefined {
    const parent = categoryParentPath(fullPath);
    return parent ? new ClassCategoryItem(parent.segment, parent.fullPath, true) : undefined;
  }

  // Class names in the selected dictionary. When a category node is selected,
  // include the classes in that category AND all of its sub-categories (so a
  // "super" category shows everything beneath it). No selection = all classes.
  classNames(): string[] {
    const { classCategory } = this.state;
    const names = this.classCategoryEntries
      .filter((e) => categoryMatches(e.category, classCategory))
      .map((e) => e.className);
    return this.applyFilter(
      [...new Set(names)].sort((a, b) => a.localeCompare(b)), VIEW_CLASSES,
    );
  }

  // ── Instance-variable sub-tree (Classes pane) ────────────────────────────────

  // Reload the per-class defined-ivar counts for the current dictionary (one
  // round trip) and drop any memoized name lists. Called wherever the class
  // listing itself is (re)loaded. A failed probe leaves the counts empty rather
  // than breaking navigation — classes just render flat.
  private loadDefinedIvarCounts(): void {
    const session = this.session();
    this.definedIvarNamesCache.clear();
    if (!session || this.state.dictIndex === undefined) {
      this.definedIvarCounts = new Map();
      return;
    }
    try {
      this.definedIvarCounts = queries.getDefinedInstVarCounts(session, this.state.dictIndex);
    } catch {
      this.definedIvarCounts = new Map();
    }
  }

  // Whether a class has locally-defined instance variables (drives the caret).
  classHasDefinedIvars(className: string): boolean {
    return (this.definedIvarCounts.get(className) ?? 0) > 0;
  }

  // Locally-defined instance variable names for a class, memoized per dict load.
  definedIvarNames(className: string): string[] {
    const cached = this.definedIvarNamesCache.get(className);
    if (cached) return cached;
    const session = this.session();
    let names: string[] = [];
    if (session) {
      try {
        names = queries.getDefinedInstVarNames(session, className);
      } catch { /* leave empty — the row simply shows no children */ }
    }
    this.definedIvarNamesCache.set(className, names);
    return names;
  }

  // Stage A stub: prove the pencil fires with the right (class, ivar), but the
  // rename itself isn't wired yet — the server-side refactoring engine lands with
  // the refactoring branch. The dialog is shown (and made explicit that nothing
  // happens on accept) so the UX flow can be exercised end to end.
  async renameInstVar(item: IvarItem): Promise<void> {
    const entered = await vscode.window.showInputBox({
      title: 'Rename Instance Variable — not available yet',
      prompt: `'${item.ivarName}' in ${item.className}. `
        + 'Renaming is not implemented yet; accepting will not change anything.',
      value: item.ivarName,
      valueSelection: [0, item.ivarName.length],
    });
    // Only stay silent if the user dismissed the box (Esc). Accepting it — whether
    // they changed the name or just pressed Enter — surfaces the not-yet message.
    if (entered === undefined) return;
    void vscode.window.showInformationMessage(
      `Renaming instance variables isn't available yet — '${item.ivarName}' in `
      + `${item.className} was left unchanged. The refactoring engine wiring lands `
      + 'in the next stage.',
    );
  }

  // Method categories for one side, with the computed ALL/SESSION rows on top,
  // plus any just-created (still empty) categories from the + button.
  methodCategories(isMeta: boolean): MethodCategoryItem[] {
    const lines = this.envLines.filter((l) => l.isMeta === isMeta);
    const real = [...new Set(lines.map((l) => l.category).filter((c) => c && c.length))];
    const fresh = [...this.newMethodCategories[isMeta ? 'meta' : 'instance']]
      .filter((c) => !real.includes(c));
    const combined = [...real, ...fresh].sort((a, b) => a.localeCompare(b));
    if (lines.length === 0 && combined.length === 0) return [];
    const hasSession = lines.some(
      (l) => l.sessionMethodBits && Object.keys(l.sessionMethodBits).length > 0,
    );
    const items = [new MethodCategoryItem(isMeta, ALL_METHODS_CATEGORY, true)];
    if (hasSession) items.push(new MethodCategoryItem(isMeta, SESSION_METHODS_CATEGORY, true));
    return items.concat(combined.map((c) => new MethodCategoryItem(isMeta, c, false)));
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
    // Carry the 1-based dictionary index so the method's class is resolved in the
    // right dictionary (some dictionaries — e.g. Python — hold classes whose
    // lookup is ambiguous by bare name). Slash-bearing selectors are escaped.
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: session.id,
      dictName: this.state.dictName,
      className: this.state.className,
      isMeta: node.isMeta,
      category: node.info.category,
      selector: escapeSelectorSlashes(node.info.selector),
      environmentId: 0,
      dictIndex: this.state.dictIndex,
    });
    // This open will fire onDidChangeActiveTextEditor; mark it so syncToEditor
    // doesn't then re-reveal the row under ALL METHODS and steal the selection
    // from the category the user actually clicked.
    this.selfOpenedUri = uri.toString();
    const doc = await vscode.workspace.openTextDocument(uri);
    // Single-click swaps in place (preview, focus stays in the tree so
    // type-to-filter / arrow-nav keep working); open-to-side pins a real tab in
    // a balanced neighbouring group so methods can be compared.
    await openGemstoneDocument(doc, toSide, this.placement);
  }

  // ── Find Class ────────────────────────────────────────────────────────────

  // Show a type-to-filter list of every class (the same UX as the old System
  // Browser "Find Class…"), then cascade the new panes to the chosen class:
  // select its dictionary and class-category, reveal the class row, and open its
  // definition. An explicit `name` arg (programmatic callers) skips the picker.
  async findClass(name?: string): Promise<void> {
    // Resolve rather than require a pre-selected session: if one session is
    // logged in it's chosen automatically (a bare getSelectedSession() no-ops).
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    let entries: queries.ClassNameEntry[];
    try {
      entries = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading class list…',
          cancellable: false,
        },
        () => Promise.resolve(queries.getAllClassNames(session)),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Failed to load classes: ${msg}`);
      return;
    }

    let chosen: queries.ClassNameEntry | undefined;
    if (name && name.trim()) {
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();
      chosen = entries.find((e) => e.className === trimmed)
        ?? entries.find((e) => e.className.toLowerCase() === lower);
      if (!chosen) {
        void vscode.window.showWarningMessage(`No class matching "${trimmed}".`);
        return;
      }
    } else {
      // Live-filtered picker over all classes; description = dictionary name.
      const picked = await vscode.window.showQuickPick(
        entries.map((e) => ({ label: e.className, description: e.dictName, entry: e })),
        { placeHolder: 'Type to find a class…', matchOnDescription: true },
      );
      if (!picked) return;
      chosen = picked.entry;
    }
    await this.revealClass(chosen.dictName, chosen.dictIndex, chosen.className);
  }

  // Set the cascade state to a specific class and reveal it across the panes.
  // Never opens the class-definition editor — that's an explicit action now (the
  // class-row button / menu). `opts.revealMethod` reveals+selects a method row.
  private async revealClass(
    dictName: string, dictIndex: number, className: string,
    opts: { revealMethod?: { selector: string; isMeta: boolean } } = {},
  ): Promise<void> {
    const session = this.session();
    if (!session) return;

    // Fetch first, commit second: if a query fails (e.g. the class can't be
    // resolved in that dictionary), warn and leave the current state intact
    // rather than half-updating it — a half-update was breaking later syncs.
    let entries: queries.ClassCategoryEntry[];
    let envLines: queries.EnvCategoryLine[];
    try {
      entries = queries.getClassesWithCategory(session, dictIndex);
      envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Couldn't open ${className}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    this.state.dictName = dictName;
    this.state.dictIndex = dictIndex;
    this.classCategoryEntries = entries;
    this.loadDefinedIvarCounts();
    const catEntry = this.classCategoryEntries.find((e) => e.className === className);
    // Only pin the category pane when the class has a non-empty one; otherwise
    // leave it on "all classes" so the target row is guaranteed visible.
    this.state.classCategory = catEntry && catEntry.category ? catEntry.category : undefined;
    this.state.className = className;
    this.state.selectedSelector = undefined;
    this.state.selectedIsMeta = undefined;
    this.state.selectedMethodCategory = undefined;
    this.newMethodCategories.instance.clear();
    this.newMethodCategories.meta.clear();
    this.envLines = envLines;
    this.loadHierarchy();
    this.clearFilters(VIEW_CATEGORIES, VIEW_CLASSES, VIEW_METHODS);
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.hierarchyProvider.refresh();
    this.methodProvider.refresh();
    void this.revealHierarchySelf();
    this.syncTitles();

    // reveal() rejects if the element isn't (yet) in the tree; the panes are
    // already correct from state, so treat reveal purely as a highlight nicety.
    try {
      await this.views?.dict.reveal(new DictItem(dictName, dictIndex), { select: true });
    } catch { /* ignore */ }
    if (this.state.classCategory) {
      const path = this.state.classCategory;
      const segment = path.split('-').pop() ?? path;
      try {
        await this.views?.category.reveal(
          new ClassCategoryItem(segment, path, false), { select: true, expand: true },
        );
      } catch { /* ignore */ }
    }
    const focusClass = opts.revealMethod === undefined;
    try {
      await this.views?.klass.reveal(new ClassItem(className), { select: true, focus: focusClass });
    } catch { /* ignore */ }

    if (opts.revealMethod) {
      // Reveal under the always-expanded ALL METHODS node (displayCategory).
      const info = this.selectorsFor(opts.revealMethod.isMeta, ALL_METHODS_CATEGORY)
        .find((i) => i.selector === opts.revealMethod!.selector);
      if (info) {
        try {
          await this.views?.method.reveal(
            new MethodItem(opts.revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
            { select: true, focus: false, expand: true },
          );
          this.syncTitles();
        } catch { /* ignore */ }
      }
    }
  }

  // ── Editor → navigator sync ─────────────────────────────────────────────────

  // When a gemstone:// method/definition editor gains focus, cascade the panels
  // to its location (without reopening the editor). Ignores non-gemstone tabs,
  // template (new-*) URIs, and editors from a different session.
  async syncToEditor(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'gemstone') return;
    // We opened this editor ourselves from a tree click — the tree selection is
    // already correct, so don't bounce it (e.g. onto the ALL METHODS node).
    if (this.selfOpenedUri === uri.toString()) {
      this.selfOpenedUri = undefined;
      return;
    }
    const session = this.session();
    if (!session || String(session.id) !== uri.authority) return;

    const parts = uri.path.split('/').map((p) => decodeURIComponent(p));
    // parts: ['', dictName, className, side|'definition', category, selector...]
    const dictName = parts[1];
    const className = parts[2];
    if (!dictName || !className || className === 'new-class') return;

    let revealMethod: { selector: string; isMeta: boolean } | undefined;
    if (parts.length >= 6) {
      const selector = unescapeSelectorSlashes(parts.slice(5).join('/'));
      if (selector === 'new-method') return; // unsaved template
      revealMethod = { selector, isMeta: parts[3] === 'class' };
    } else if (parts[3] !== 'definition') {
      return; // not a recognizable method/definition URI
    }

    // Already showing this class: just (re)reveal the method row / refresh title.
    if (this.state.className === className && this.state.dictName === dictName) {
      if (revealMethod) {
        const info = this.selectorsFor(revealMethod.isMeta, ALL_METHODS_CATEGORY)
          .find((i) => i.selector === revealMethod!.selector);
        if (info) {
          try {
            await this.views?.method.reveal(
              new MethodItem(revealMethod.isMeta, info, ALL_METHODS_CATEGORY),
              { select: true, focus: false, expand: true },
            );
            this.syncTitles();
          } catch { /* ignore */ }
        }
      }
      return;
    }

    const dictIndex = queries.getDictionaryNames(session).indexOf(dictName) + 1;
    if (dictIndex <= 0) return;
    await this.revealClass(dictName, dictIndex, className, { revealMethod });
  }

  // ── New (+) actions ─────────────────────────────────────────────────────────

  async newDictionary(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const name = (await vscode.window.showInputBox({
      prompt: 'New dictionary name', placeHolder: 'e.g. MyProject',
    }))?.trim();
    if (!name) return;
    queries.addDictionary(session, name);
    this.dictProvider.refresh();
    // Select the new dictionary so its (empty) categories/classes cascade, and
    // highlight its row.
    const names = queries.getDictionaryNames(session);
    const idx = names.indexOf(name);
    if (idx >= 0) {
      const item = new DictItem(name, idx + 1);
      this.selectDict(item);
      try {
        await this.views?.dict.reveal(item, { select: true, focus: true });
      } catch { /* ignore */ }
    }
  }

  async newClassCategory(): Promise<void> {
    if (this.state.dictName === undefined) {
      void vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }
    const name = (await vscode.window.showInputBox({
      prompt: 'New class category name', placeHolder: 'e.g. Model',
    }))?.trim();
    if (!name) return;
    // Class categories in GemStone exist only implicitly (a class names one), so
    // hold the new name locally until a class is filed into it, then select it.
    this.newClassCategories.add(name);
    this.state.classCategory = name;
    this.state.className = undefined;
    this.envLines = [];
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    this.methodProvider.refresh();
    this.syncTitles();
    const segment = name.split('-').pop() ?? name;
    try {
      await this.views?.category.reveal(
        new ClassCategoryItem(segment, name, false), { select: true, expand: true },
      );
    } catch { /* ignore */ }
  }

  newClass(): void {
    const session = this.session();
    if (!session || this.state.dictName === undefined) {
      void vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }
    const category = this.state.classCategory;
    const categoryQuery = category ? `?category=${encodeURIComponent(category)}` : '';
    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(this.state.dictName)}/new-class${categoryQuery}`,
    );
    void vscode.commands.executeCommand('gemstone.openDocument', uri);
  }

  async newMethodCategory(): Promise<void> {
    if (this.state.className === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    const name = (await vscode.window.showInputBox({
      prompt: 'New method category name', placeHolder: 'e.g. accessing',
    }))?.trim();
    if (!name) return;
    const isMeta = this.state.selectedIsMeta ?? false;
    this.newMethodCategories[isMeta ? 'meta' : 'instance'].add(name);
    this.recordMethodContext(isMeta, name);
    this.methodProvider.refresh();
    this.syncTitles();
  }

  async newMethod(): Promise<void> {
    const session = this.session();
    if (!session || this.state.dictName === undefined
      || this.state.className === undefined || this.state.dictIndex === undefined) {
      void vscode.window.showWarningMessage('Select a class first.');
      return;
    }
    // A new-method template editor is always writable (there's no existing
    // method to permission-check), so guard restricted classes here — otherwise
    // a save into e.g. a system/kernel class silently no-ops server-side.
    let writable = true;
    try {
      writable = queries.canClassBeWritten(session, this.state.className, this.state.dictIndex);
    } catch { /* session busy — let the compile itself report any failure */ }
    if (!writable) {
      void vscode.window.showWarningMessage(
        `${this.state.className} is not writable in this repository — cannot add a method.`,
      );
      return;
    }
    // Choose the side: honor the last-touched side if the user was working in the
    // Methods pane, otherwise ask so either an instance or a class method can be
    // created regardless of what's selected.
    let isMeta: boolean;
    if (this.state.selectedIsMeta !== undefined) {
      isMeta = this.state.selectedIsMeta;
    } else {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Instance method', meta: false },
          { label: 'Class method', meta: true },
        ],
        { placeHolder: `New method on ${this.state.className}` },
      );
      if (!pick) return;
      isMeta = pick.meta;
    }
    const category = (this.state.selectedIsMeta === isMeta && this.state.selectedMethodCategory)
      ? this.state.selectedMethodCategory : 'as yet unclassified';
    const uri = buildNewMethodUri(
      session.id, this.state.dictName, this.state.className, isMeta, category, 0,
      this.state.dictIndex,
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
    });
    this.placement.remember(uri);
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  // Drag a method onto another category (move) or onto a class (copy). Both the
  // source method and any class drop-target live in the currently-shown
  // dictionary, so state.dictIndex scopes every lookup.

  dragPayload(item: MethodItem): MethodDragPayload | undefined {
    if (this.state.className === undefined || this.state.dictName === undefined
      || this.state.dictIndex === undefined) {
      return undefined;
    }
    return {
      selector: item.info.selector,
      isMeta: item.isMeta,
      category: item.info.category,
      className: this.state.className,
      dictName: this.state.dictName,
      dictIndex: this.state.dictIndex,
    };
  }

  // Drop on a method category → move the method there (recategorize).
  async dragMoveToCategory(p: MethodDragPayload, category: string): Promise<void> {
    const session = this.session();
    if (!session || category === p.category) return;
    try {
      queries.recategorizeMethod(session, p.className, p.isMeta, p.selector, category, p.dictIndex);
    } catch (e) {
      void vscode.window.showErrorMessage(`Move failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.reloadIfCurrent(p.className, p.dictIndex);
    void vscode.window.showInformationMessage(`Moved #${p.selector} to '${category}'.`);
  }

  // Drop on a class → copy the method into it (preserving source + category).
  async dragCopyToClass(p: MethodDragPayload, targetClass: string): Promise<void> {
    const session = this.session();
    if (!session || targetClass === p.className) return;
    try {
      queries.copyMethodToClass(
        session, p.className, targetClass, p.isMeta, p.selector, 0, p.dictIndex,
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.reloadIfCurrent(targetClass, p.dictIndex);
    void vscode.window.showInformationMessage(`Copied #${p.selector} to ${targetClass}.`);
  }

  // Reload the method list when the class just mutated is the one on screen.
  private reloadIfCurrent(className: string, dictIndex: number): void {
    const session = this.session();
    if (!session || this.state.className !== className || this.state.dictIndex !== dictIndex) return;
    this.envLines = queries.getClassEnvironments(session, dictIndex, className, this.maxEnv());
    this.methodProvider.refresh();
    this.syncTitles();
  }

  // ── Indicator actions (▲ / ▼ / senders / implementors) ──────────────────────

  private sessionId(): number | undefined {
    return this.session()?.id;
  }

  implementorsOf(selector: string): void {
    const sessionId = this.sessionId();
    if (sessionId === undefined) return;
    void vscode.commands.executeCommand('gemstone.implementorsOfSelector', { selector, sessionId });
  }

  sendersOf(selector: string): void {
    const sessionId = this.sessionId();
    if (sessionId === undefined) return;
    void vscode.commands.executeCommand('gemstone.sendersOfSelector', { selector, sessionId });
  }

  // ▲ arrow: implementations of this selector up the superclass chain.
  // ▼ arrow: overrides of this selector down in the subclasses.
  private hierarchy(selector: string, isMeta: boolean, direction: 'up' | 'down'): void {
    const sessionId = this.sessionId();
    if (sessionId === undefined || this.state.className === undefined
      || this.state.dictIndex === undefined) {
      return;
    }
    void vscode.commands.executeCommand('gemstone.hierarchyImplementorsOf', {
      selector,
      className: this.state.className,
      dictIndex: this.state.dictIndex,
      isMeta,
      direction,
      sessionId,
    });
  }

  superImplementors(selector: string, isMeta: boolean): void {
    this.hierarchy(selector, isMeta, 'up');
  }

  subOverrides(selector: string, isMeta: boolean): void {
    this.hierarchy(selector, isMeta, 'down');
  }

  // ── External-compile refresh ────────────────────────────────────────────────
  // The gemstone:// file-system provider fires events after a method or class is
  // compiled (Save). When it's the class we're showing, reload so the new method
  // / class appears in the panels without a manual refresh.

  onExternalMethodCompiled(sessionId: number, className: string): void {
    const session = this.session();
    if (!session || session.id !== sessionId || this.state.className !== className
      || this.state.dictIndex === undefined) {
      return;
    }
    this.envLines = queries.getClassEnvironments(
      session, this.state.dictIndex, className, this.maxEnv(),
    );
    this.methodProvider.refresh();
    this.syncTitles();
  }

  onExternalClassCompiled(sessionId: number, className: string): void {
    const session = this.session();
    if (!session || session.id !== sessionId || this.state.dictIndex === undefined) return;
    this.classCategoryEntries = queries.getClassesWithCategory(session, this.state.dictIndex);
    this.loadDefinedIvarCounts();
    this.categoryProvider.refresh();
    this.classProvider.refresh();
    // If the compiled class lives in the current dictionary, select it so the
    // freshly-created class is highlighted and its methods load.
    if (this.classCategoryEntries.some((e) => e.className === className)
      && this.state.dictName !== undefined) {
      void this.revealClass(this.state.dictName, this.state.dictIndex, className);
    } else {
      this.syncTitles();
    }
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
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  // Flat list — every row is a root. getParent is required for TreeView.reveal.
  getParent(): DictItem | undefined {
    return undefined;
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
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassCategoryItem): ClassCategoryItem | undefined {
    return this.ctl.categoryParent(element.fullPath);
  }
  getChildren(element?: ClassCategoryItem): ClassCategoryItem[] {
    if (this.ctl.state.dictName === undefined) return [];
    // While filtering, drop the tree and list matching full category paths flat.
    if (!element && this.ctl.categoryFilterActive()) {
      return this.ctl.filteredCategoryPaths().map((p) => new ClassCategoryItem(p, p, false));
    }
    return this.ctl
      .categoryChildren(element?.fullPath)
      .map((n) => new ClassCategoryItem(n.segment, n.fullPath, n.hasChildren));
  }
}

class ClassProvider extends RefreshableProvider<ClassNode> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: ClassNode): ClassNode | undefined {
    return element instanceof IvarItem ? new ClassItem(element.className) : undefined;
  }
  getChildren(element?: ClassNode): ClassNode[] {
    if (this.ctl.state.dictName === undefined) return [];
    if (!element) {
      return this.ctl.classNames().map(
        (n) => new ClassItem(n, this.ctl.classHasDefinedIvars(n)),
      );
    }
    // Expand a class to its locally-defined instance variables; ivar rows are leaves.
    if (element instanceof ClassItem) {
      return this.ctl.definedIvarNames(element.className)
        .map((iv) => new IvarItem(element.className, iv));
    }
    return [];
  }
}

class HierarchyProvider extends RefreshableProvider<HierarchyItem> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  getParent(element: HierarchyItem): HierarchyItem | undefined {
    return this.ctl.hierarchyParent(element);
  }
  getChildren(element?: HierarchyItem): HierarchyItem[] {
    return this.ctl.hierarchyChildren(element);
  }
}

class MethodProvider extends RefreshableProvider<MethodNode> {
  constructor(private readonly ctl: ExplorerController) {
    super();
  }
  // Walk up the side ▸ category ▸ selector tree so TreeView.reveal can locate a
  // method row (used by editor-focus → navigator sync). Nodes match by their
  // stable ids, so freshly-built parents resolve to the rendered ones.
  getParent(element: MethodNode): MethodNode | undefined {
    if (element instanceof MethodItem) {
      if (element.displayCategory === undefined) return new MethodSideItem(element.isMeta);
      const computed = element.displayCategory === ALL_METHODS_CATEGORY
        || element.displayCategory === SESSION_METHODS_CATEGORY;
      return new MethodCategoryItem(element.isMeta, element.displayCategory, computed);
    }
    if (element instanceof MethodCategoryItem) return new MethodSideItem(element.isMeta);
    return undefined;
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
        .map((info) => new MethodItem(element.isMeta, info, element.category));
    }
    return [];
  }
}

// ── Drag & drop controllers ─────────────────────────────────────────────────

// Methods pane: drag a method; drop it on another category to MOVE it there.
class MethodDragAndDrop implements vscode.TreeDragAndDropController<MethodNode> {
  readonly dragMimeTypes = [METHOD_MIME];
  readonly dropMimeTypes = [METHOD_MIME];
  constructor(private readonly ctl: ExplorerController) {}

  handleDrag(source: readonly MethodNode[], dataTransfer: vscode.DataTransfer): void {
    const item = source.find((n) => n instanceof MethodItem) as MethodItem | undefined;
    const payload = item && this.ctl.dragPayload(item);
    if (payload) dataTransfer.set(METHOD_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(target: MethodNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const raw = dataTransfer.get(METHOD_MIME);
    if (!raw) return;
    const payload = raw.value as MethodDragPayload;
    // Resolve the drop's target category: a real category row, or the category
    // of the method row it landed on. Dropping on a side/computed row is ignored.
    let category: string | undefined;
    if (target instanceof MethodCategoryItem && !target.computed) category = target.category;
    else if (target instanceof MethodItem) category = target.info.category;
    if (category) await this.ctl.dragMoveToCategory(payload, category);
  }
}

// Classes pane: accept a dragged method and COPY it into the dropped-on class.
class ClassDropController implements vscode.TreeDragAndDropController<ClassNode> {
  readonly dragMimeTypes: readonly string[] = [];
  readonly dropMimeTypes = [METHOD_MIME];
  constructor(private readonly ctl: ExplorerController) {}

  handleDrag(): void { /* classes aren't draggable */ }

  async handleDrop(target: ClassNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!(target instanceof ClassItem)) return;
    const raw = dataTransfer.get(METHOD_MIME);
    if (!raw) return;
    await this.ctl.dragCopyToClass(raw.value as MethodDragPayload, target.className);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

// Handle returned to the extension so it can forward file-system compile events
// (method / class Save) and session lifecycle events (abort) to the controller
// for a live panel refresh.
export interface ExplorerHandle {
  onMethodCompiled(sessionId: number, className: string): void;
  onClassCompiled(sessionId: number, className: string): void;
  onSessionAborted(sessionId: number): void;
}

export function registerGemStoneExplorer(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): ExplorerHandle {
  const ctl = new ExplorerController(sessionManager);

  // The Open Editors pane (last in the container) mirrors the open gemstone://
  // source editors; it is session-independent, so it registers on its own.
  registerExplorerOpenEditors(context);

  // Gate the downstream panes (and swap the Dictionaries welcome) on whether a
  // session is available to browse.
  const syncActiveContext = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.explorerActive',
      sessionManager.getSelectedSession() !== undefined,
    );
  };
  syncActiveContext();

  const dictView = vscode.window.createTreeView('gemstoneExplorerDicts', {
    treeDataProvider: ctl.dictProvider,
  });
  const categoryView = vscode.window.createTreeView('gemstoneExplorerCategories', {
    treeDataProvider: ctl.categoryProvider,
  });
  const classView = vscode.window.createTreeView('gemstoneExplorerClasses', {
    treeDataProvider: ctl.classProvider,
    dragAndDropController: new ClassDropController(ctl),
  });
  const hierarchyView = vscode.window.createTreeView('gemstoneExplorerHierarchy', {
    treeDataProvider: ctl.hierarchyProvider,
  });
  const methodView = vscode.window.createTreeView('gemstoneExplorerMethods', {
    treeDataProvider: ctl.methodProvider,
    showCollapseAll: true,
    dragAndDropController: new MethodDragAndDrop(ctl),
  });
  ctl.setViews({
    dict: dictView, category: categoryView, klass: classView,
    hierarchy: hierarchyView, method: methodView,
  });

  dictView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectDict(e.selection[0]);
  });
  categoryView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectClassCategory(e.selection[0]);
  });
  classView.onDidChangeSelection((e) => {
    // Only a class row navigates; selecting an ivar child is inert (it's acted on
    // via its inline pencil, not selection).
    const node = e.selection[0];
    if (node instanceof ClassItem) ctl.selectClass(node);
  });
  hierarchyView.onDidChangeSelection((e) => {
    if (e.selection[0]) ctl.selectHierarchyNode(e.selection[0]);
  });
  methodView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    // Record the side / category context so New Method(-Category) default there.
    if (node instanceof MethodItem) {
      ctl.recordMethodContext(node.isMeta, node.info.category);
      void ctl.openMethod(node);
    } else if (node instanceof MethodCategoryItem) {
      ctl.recordMethodContext(node.isMeta, node.computed ? undefined : node.category);
    } else if (node instanceof MethodSideItem) {
      ctl.recordMethodContext(node.isMeta, undefined);
    }
  });

  context.subscriptions.push(
    dictView,
    categoryView,
    classView,
    hierarchyView,
    methodView,
    sessionManager.onDidChangeSelection(() => {
      syncActiveContext();
      ctl.reset();
    }),
    // The manual Refresh button reloads in place, keeping the user's selection
    // (a full reset only happens on a session switch, below).
    vscode.commands.registerCommand('gemstone.explorer.refresh', () => void ctl.refreshRetainingSelection()),
    // Per-pane filter buttons: open a live filter input (prefix match, '*'
    // wildcard) that filters the pane in place — works regardless of where
    // focus currently sits (e.g. the editor).
    ...EXPLORER_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.filter`, () => ctl.beginFilter(viewId)),
    ),
    // Clear buttons: shown (via the gemstone.explorerFiltered.<viewId> context key)
    // only when that pane has an active filter.
    ...EXPLORER_VIEWS.map((viewId) =>
      vscode.commands.registerCommand(`${viewId}.clearFilter`, () => ctl.clearFilter(viewId)),
    ),
    vscode.commands.registerCommand(
      'gemstone.explorer.openMethodToSide',
      (node: MethodItem) => {
        if (node instanceof MethodItem) void ctl.openMethod(node, true);
      },
    ),
    // Ctrl/Cmd+Enter in the Methods pane: open the selected method in a new
    // source editor to the side (same as the row's ↗ button). Keybindings don't
    // pass the tree selection, so read it from the view here.
    vscode.commands.registerCommand(
      'gemstone.explorer.openSelectedMethodToSide',
      () => {
        const node = methodView.selection[0];
        if (node instanceof MethodItem) void ctl.openMethod(node, true);
      },
    ),
    // Find Class: cascade the panes to a class by name (from the Classes pane
    // title button or the command palette).
    vscode.commands.registerCommand(
      'gemstone.explorer.findClass',
      (name?: string) => ctl.findClass(typeof name === 'string' ? name : undefined),
    ),
    // Open a class's definition editor (inline button / menu on the class row —
    // a plain class click no longer auto-opens it; a double-click does).
    vscode.commands.registerCommand(
      'gemstone.explorer.openDefinition',
      (item?: ClassItem) => void ctl.openClassDefinition(item instanceof ClassItem ? item : undefined),
    ),
    vscode.commands.registerCommand(
      'gemstone.explorer.openDefinitionToSide',
      (item?: ClassItem) => void ctl.openClassDefinition(item instanceof ClassItem ? item : undefined, true),
    ),
    // Same button on a Hierarchy node — opens that class's definition to the side
    // (resolving its own dictionary), without navigating the panels.
    vscode.commands.registerCommand(
      'gemstone.explorer.openHierarchyDefinition',
      (item?: HierarchyItem) => { if (item instanceof HierarchyItem) void ctl.openHierarchyDefinition(item); },
    ),
    // Per-click hook powering double-click-to-open-definition.
    vscode.commands.registerCommand(
      'gemstone.explorer.classClicked',
      (className?: string) => { if (typeof className === 'string') ctl.handleClassClick(className); },
    ),
    // Generate a Grail (.py) stub for a class — Classes/Hierarchy menus and the
    // Command Palette all route here.
    vscode.commands.registerCommand(
      'gemstone.generateGrailStub',
      (item?: ClassItem | HierarchyItem) => void ctl.generateGrailStub(
        item instanceof ClassItem || item instanceof HierarchyItem ? item : undefined,
      ),
    ),
    // Rename a locally-defined instance variable (pencil on the ivar row).
    vscode.commands.registerCommand(
      'gemstone.explorer.renameIvar',
      (item?: IvarItem) => { if (item instanceof IvarItem) void ctl.renameInstVar(item); },
    ),
    // New (+) actions, one per pane.
    vscode.commands.registerCommand('gemstone.explorer.newDictionary', () => ctl.newDictionary()),
    vscode.commands.registerCommand('gemstone.explorer.newClassCategory', () => ctl.newClassCategory()),
    vscode.commands.registerCommand('gemstone.explorer.newClass', () => ctl.newClass()),
    vscode.commands.registerCommand('gemstone.explorer.newMethodCategory', () => ctl.newMethodCategory()),
    vscode.commands.registerCommand('gemstone.explorer.newMethod', () => ctl.newMethod()),
    // Indicator / method actions: browse implementors, senders, and the
    // superclass (▲) / subclass (▼) implementations behind the override arrows.
    // Each accepts either the tree item (inline button / right-click) or a
    // {selector, isMeta} payload (tooltip command link).
    vscode.commands.registerCommand('gemstone.explorer.implementorsOf', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.implementorsOf(sel.selector);
    }),
    vscode.commands.registerCommand('gemstone.explorer.sendersOf', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.sendersOf(sel.selector);
    }),
    vscode.commands.registerCommand('gemstone.explorer.superImplementors', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.superImplementors(sel.selector, sel.isMeta);
    }),
    vscode.commands.registerCommand('gemstone.explorer.subOverrides', (arg: MethodCommandArg) => {
      const sel = methodArg(arg);
      if (sel) ctl.subOverrides(sel.selector, sel.isMeta);
    }),
    // Editor-focus → navigator: when a gemstone:// method/class editor gains
    // focus, cascade the panels to its location.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) void ctl.syncToEditor(editor.document.uri);
    }),
  );

  return {
    onMethodCompiled: (sessionId, className) => ctl.onExternalMethodCompiled(sessionId, className),
    onClassCompiled: (sessionId, className) => ctl.onExternalClassCompiled(sessionId, className),
    onSessionAborted: (sessionId) => ctl.onSessionAborted(sessionId),
  };
}
