import * as vscode from 'vscode';
import * as fs from 'fs';
import { RowanRepoRegistry, TrackedRepo } from './rowanRepos';
import { findRowanLoadSpecs } from './rowanLoad';
import { ActiveSession } from './sessionManager';
import { listRowanProjects, diffRowanProject, RowanProject, RowanDiff, RowanDiffOp } from './browserQueries';
import { loadedProjectUri, changeUri } from './rowanDecorations';

// The "Rowan" sidebar view. Rowan is a package manager, so the view is about
// state and operations, not code navigation (that's the System Browser's job).
// Sections, in the spirit of VS Code's own package UIs:
//   REPOSITORIES     — tracked on-disk repos (Remote-Explorer-style registry);
//   LOADED PROJECTS  — what the connected stone actually has (image lens);
//   CHANGES          — image↔disk drift per project, SCM-style. Diffing isn't
//                      free, so the section starts collapsed and each project's
//                      diff runs only when its node is expanded (or refreshed).

/** How the provider reaches the current session; narrow for testability. */
export interface RowanSessionSource {
  getSession(): ActiveSession | null;
}

export type RowanSection = 'repositories' | 'loaded' | 'changes';

const SECTION_LABELS: Record<RowanSection, string> = {
  repositories: 'Repositories',
  loaded: 'Loaded Projects',
  changes: 'Changes',
};
const SECTION_ICONS: Record<RowanSection, string> = {
  repositories: 'repo',
  loaded: 'database',
  changes: 'diff',
};

/** A section header row. */
export class RowanSectionItem extends vscode.TreeItem {
  constructor(public readonly section: RowanSection) {
    super(
      SECTION_LABELS[section],
      // Changes starts collapsed: expanding is what triggers the (non-free)
      // per-project diffs.
      section === 'changes'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.id = `rowan-section-${section}`;
    this.contextValue = 'rowanSection';
    this.iconPath = new vscode.ThemeIcon(SECTION_ICONS[section]);
  }
}

/** A tracked repository row. */
export class RowanRepoItem extends vscode.TreeItem {
  constructor(
    public readonly repo: TrackedRepo,
    /** Names of the load specs found in the checkout ([] when dir is gone). */
    public readonly specNames: string[],
    public readonly missing: boolean,
    /** True when a loaded project in the connected stone matches a spec name. */
    loaded: boolean,
  ) {
    super(repo.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-repo-${repo.path}`;
    this.description = missing
      ? 'missing on disk'
      : specNames.length === 0
        ? 'no load spec found'
        : specNames.join(', ') + (loaded ? ' · loaded' : '');
    this.tooltip = [
      repo.path,
      repo.gitUrl ? `from ${repo.gitUrl}` : undefined,
      missing ? 'The tracked directory no longer exists.' : undefined,
    ].filter(Boolean).join('\n');
    this.iconPath = new vscode.ThemeIcon(
      missing ? 'warning' : loaded ? 'repo' : 'repo',
    );
    // Loadable only when the checkout exists and holds at least one spec —
    // package.json menus key inline actions off this.
    this.contextValue = missing
      ? 'rowanRepoMissing'
      : specNames.length > 0 ? 'rowanRepo' : 'rowanRepoNoSpec';
  }
}

/**
 * A project loaded in the connected stone. Dirty projects decorate exactly
 * like a modified file in the git view: tinted label plus a right-aligned M
 * badge, via the resourceUri and RowanDecorationProvider.
 */
export class RowanLoadedProjectItem extends vscode.TreeItem {
  constructor(public readonly project: RowanProject) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-loaded-${project.name}`;
    this.resourceUri = loadedProjectUri(project.name, project.isDirty);
    this.tooltip = project.isDirty
      ? `${project.name} — has unsaved changes relative to its disk repository`
      : project.isBuiltin
        ? `${project.name} — shipped with the GemStone image`
        : project.name;
    this.iconPath = new vscode.ThemeIcon(project.isBuiltin ? 'library' : 'package');
    this.contextValue = project.isBuiltin ? 'rowanLoadedProjectBuiltin' : 'rowanLoadedProject';
  }
}

/** The collapsed group holding the projects GemStone ships in the image. */
export class RowanBuiltinGroupItem extends vscode.TreeItem {
  constructor(count: number) {
    super('Built-in', vscode.TreeItemCollapsibleState.Collapsed);
    this.id = 'rowan-builtin-group';
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon('library');
    this.contextValue = 'rowanBuiltinGroup';
    this.tooltip = 'Projects shipped with the GemStone image';
  }
}

/**
 * A single-message row (placeholder / status / error) inside a section.
 * `kind` doubles as the contextValue so menus and tests can key off it:
 *   rowanEmpty          — no repos tracked (click adds one)
 *   rowanNoSession      — no connected session
 *   rowanNoRowan        — connected image has no Rowan (install action later)
 *   rowanSectionError   — query failed
 *   rowanClean          — a project has no image↔disk differences
 */
export class RowanMessageItem extends vscode.TreeItem {
  constructor(
    public readonly kind: 'rowanEmpty' | 'rowanNoSession' | 'rowanNoRowan' | 'rowanSectionError' | 'rowanClean',
    label: string,
    icon: string,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-message-${kind}`;
    if (icon !== '') this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = kind;
    this.command = command;
  }
}

/** A project under Changes; expanding it computes the image↔disk diff. */
export class RowanChangesProjectItem extends vscode.TreeItem {
  constructor(public readonly projectName: string) {
    super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `rowan-changes-${projectName}`;
    this.iconPath = new vscode.ThemeIcon('package');
    this.contextValue = 'rowanChangesProject';
  }
}

/**
 * One image↔disk difference (a class or method) within a project, decorated
 * like a git changes row: tinted label plus a right-aligned M / A / D badge.
 * Image-only ≈ added (not yet on disk), disk-only ≈ deleted (missing from the
 * image), changed ≈ modified.
 */
export class RowanChangeItem extends vscode.TreeItem {
  constructor(public readonly projectName: string, public readonly op: RowanDiffOp) {
    super(op.target, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-change-${projectName}-${op.package}-${op.target}`;
    this.description = op.package;
    const state = op.location === 'image' ? 'A' : op.location === 'disk' ? 'D' : 'M';
    this.resourceUri = changeUri(projectName, op.target, state);
    this.iconPath = new vscode.ThemeIcon(
      op.target.includes('>>') ? 'symbol-method' : 'symbol-class',
    );
    this.tooltip = op.location === 'image'
      ? `${op.target} exists only in the image (not on disk)`
      : op.location === 'disk'
        ? `${op.target} exists only on disk (not in the image)`
        : `${op.target} differs between image and disk`;
    this.contextValue = 'rowanChange';
  }
}

export type RowanTreeNode =
  | RowanSectionItem
  | RowanRepoItem
  | RowanLoadedProjectItem
  | RowanBuiltinGroupItem
  | RowanChangesProjectItem
  | RowanChangeItem
  | RowanMessageItem;

export class RowanTreeProvider implements vscode.TreeDataProvider<RowanTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RowanTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // One image query per refresh cycle: both sections need the loaded-project
  // list (rows for one, the "· loaded" repo marker for the other).
  private loadedQuery:
    | { state: 'ok'; available: boolean; projects: RowanProject[] }
    | { state: 'nosession' }
    | { state: 'error'; message: string }
    | null = null;

  constructor(
    private readonly registry: RowanRepoRegistry,
    private readonly sessions: RowanSessionSource,
  ) {}

  // Diffs computed this refresh cycle, keyed by project name.
  private diffCache = new Map<string, RowanDiff>();

  refresh(): void {
    this.loadedQuery = null;
    this.diffCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RowanTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RowanTreeNode): RowanTreeNode[] {
    if (!element) {
      // A bare start (nothing tracked, no session) renders as viewsWelcome
      // content instead of three empty sections — that's where the real
      // "Add Rowan Repository" button lives (package.json viewsWelcome).
      if (this.registry.list().length === 0 && !this.sessions.getSession()) {
        return [];
      }
      return [
        new RowanSectionItem('repositories'),
        new RowanSectionItem('loaded'),
        new RowanSectionItem('changes'),
      ];
    }
    if (element instanceof RowanSectionItem) {
      switch (element.section) {
        case 'repositories': return this.repositoryChildren();
        case 'loaded': return this.loadedChildren();
        case 'changes': return this.changesChildren();
      }
    }
    if (element instanceof RowanChangesProjectItem) {
      return this.changesFor(element.projectName);
    }
    if (element instanceof RowanBuiltinGroupItem) {
      const q = this.queryLoaded();
      if (q.state !== 'ok' || !q.available) return [];
      return q.projects
        .filter(p => p.isBuiltin)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => new RowanLoadedProjectItem(p));
    }
    return [];
  }

  private changesChildren(): RowanTreeNode[] {
    const q = this.queryLoaded();
    if (q.state === 'nosession') {
      return [new RowanMessageItem(
        'rowanNoSession', 'Not connected — log in to see changes', 'plug',
      )];
    }
    if (q.state === 'error') {
      return [new RowanMessageItem(
        'rowanSectionError', `Could not list projects: ${q.message}`, 'error',
      )];
    }
    if (!q.available) {
      return [new RowanMessageItem(
        'rowanNoRowan', 'Rowan is not installed in this image', 'warning',
      )];
    }
    // Built-ins live in the read-only $GEMSTONE tree; drift management is
    // about the user's own repositories.
    return q.projects
      .filter(p => !p.isBuiltin)
      .map(p => new RowanChangesProjectItem(p.name));
  }

  /** The diff rows for one project; runs the diff on first expansion. */
  private changesFor(projectName: string): RowanTreeNode[] {
    const session = this.sessions.getSession();
    if (!session) return [];
    let diff = this.diffCache.get(projectName);
    if (!diff) {
      try {
        diff = diffRowanProject(session, projectName);
      } catch (e: unknown) {
        diff = { ok: false, error: e instanceof Error ? e.message : String(e), operations: [] };
      }
      this.diffCache.set(projectName, diff);
    }
    if (!diff.ok) {
      return [new RowanMessageItem(
        'rowanSectionError', `Diff failed: ${diff.error}`, 'error',
      )];
    }
    if (diff.operations.length === 0) {
      return [new RowanMessageItem('rowanClean', 'No differences with disk', 'check')];
    }
    return diff.operations
      .slice()
      .sort((a, b) => (a.package + a.target).localeCompare(b.package + b.target))
      .map(op => new RowanChangeItem(projectName, op));
  }

  private repositoryChildren(): RowanTreeNode[] {
    const repos = this.registry.list();
    if (repos.length === 0) {
      const item = new RowanMessageItem(
        'rowanEmpty', 'No repositories tracked — add one…', '',
        { command: 'gemstone.rowanAddRepo', title: 'Add Rowan Repository' },
      );
      return [item];
    }
    const loadedNames = this.loadedProjectNames();
    return repos
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(repo => this.describe(repo, loadedNames));
  }

  private loadedChildren(): RowanTreeNode[] {
    const q = this.queryLoaded();
    if (q.state === 'nosession') {
      return [new RowanMessageItem(
        'rowanNoSession', 'Not connected — log in to see loaded projects', 'plug',
      )];
    }
    if (q.state === 'error') {
      return [new RowanMessageItem(
        'rowanSectionError', `Could not list projects: ${q.message}`, 'error',
      )];
    }
    if (!q.available) {
      // The image has no Rowan at all. Surfacing this is deliberate: the
      // install-Rowan-into-a-bare-image action will hang off this row.
      return [new RowanMessageItem(
        'rowanNoRowan', 'Rowan is not installed in this image', 'warning',
      )];
    }
    const user = q.projects
      .filter(p => !p.isBuiltin)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => new RowanLoadedProjectItem(p));
    const builtins = q.projects.filter(p => p.isBuiltin);
    return builtins.length > 0
      ? [...user, new RowanBuiltinGroupItem(builtins.length)]
      : user;
  }

  private queryLoaded(): NonNullable<RowanTreeProvider['loadedQuery']> {
    if (this.loadedQuery) return this.loadedQuery;
    const session = this.sessions.getSession();
    if (!session) {
      this.loadedQuery = { state: 'nosession' };
    } else {
      try {
        const { available, projects } = listRowanProjects(session);
        this.loadedQuery = { state: 'ok', available, projects };
      } catch (e: unknown) {
        this.loadedQuery = { state: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    }
    return this.loadedQuery;
  }

  /** Loaded project names, or empty when disconnected/unavailable/erroring. */
  private loadedProjectNames(): Set<string> {
    const q = this.queryLoaded();
    return q.state === 'ok' && q.available
      ? new Set(q.projects.map(p => p.name))
      : new Set();
  }

  private describe(repo: TrackedRepo, loadedNames: Set<string>): RowanRepoItem {
    if (!fs.existsSync(repo.path)) {
      return new RowanRepoItem(repo, [], true, false);
    }
    const specNames = findRowanLoadSpecs(repo.path).map(s => s.name);
    const loaded = specNames.some(name => loadedNames.has(name));
    return new RowanRepoItem(repo, specNames, false, loaded);
  }
}
