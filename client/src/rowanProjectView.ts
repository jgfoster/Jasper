import * as vscode from 'vscode';
import {
  readRowanWorkspaceProject,
  RowanWorkspaceProject,
  RowanProjectPackage,
} from './rowanProject';

/** A package (directory of class source) in the workspace's Rowan project. */
export class RowanProjectPackageItem extends vscode.TreeItem {
  constructor(public readonly pkg: RowanProjectPackage) {
    super(pkg.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-package-${pkg.path}`;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    // Point at the real directory so the row reveals/opens it in the Explorer.
    this.resourceUri = vscode.Uri.file(pkg.path);
    this.tooltip = pkg.path;
    this.contextValue = 'rowanProjectPackage';
  }
}

/** A placeholder row (e.g. "No packages yet"). */
export class RowanProjectMessageItem extends vscode.TreeItem {
  constructor(
    public readonly kind: 'rowanProjectEmpty',
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-project-message-${kind}`;
    this.contextValue = kind;
  }
}

export type RowanProjectNode = RowanProjectPackageItem | RowanProjectMessageItem;

/**
 * The Explorer-section view of the Rowan project at the open workspace root:
 * its packages, read from disk (no stone required). Contributed to the Explorer
 * container only when gemstone.workspaceIsRowanProject, so it appears solely for
 * Rowan projects, next to the file tree.
 */
export class RowanProjectTreeProvider implements vscode.TreeDataProvider<RowanProjectNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // The workspace project, read once per refresh. undefined = not yet probed,
  // null = the open folder is not a Rowan project.
  private project: RowanWorkspaceProject | null | undefined = undefined;

  refresh(): void {
    this.project = undefined;
    this._onDidChangeTreeData.fire();
  }

  /** The project's name, for the Explorer section's description; else undefined. */
  projectName(): string | undefined {
    return this.query()?.name;
  }

  getTreeItem(element: RowanProjectNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RowanProjectNode): RowanProjectNode[] {
    if (element) return [];
    const proj = this.query();
    if (!proj) return [];
    if (proj.packages.length === 0) {
      return [new RowanProjectMessageItem('rowanProjectEmpty', 'No packages yet')];
    }
    return proj.packages.map((pkg) => new RowanProjectPackageItem(pkg));
  }

  private query(): RowanWorkspaceProject | null {
    if (this.project !== undefined) return this.project;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.project = root ? readRowanWorkspaceProject(root) : null;
    return this.project;
  }
}
