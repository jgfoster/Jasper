import * as vscode from 'vscode';
import { GemStoneVersion } from './sysadminTypes';
import { VersionManager } from './versionManager';
import { isWindows, getWslInfo } from './wslBridge';

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

/**
 * True when server management isn't available in this session — the Versions
 * view reduces to a Windows-client-only catalog. The row icon then reflects
 * client state instead of server state.
 */
function isClientOnlyMode(): boolean {
  return isWindows() && !getWslInfo().available;
}

export class VersionItem extends vscode.TreeItem {
  constructor(public readonly version: GemStoneVersion) {
    super(version.version, vscode.TreeItemCollapsibleState.None);

    if (version.local) {
      this.description = `(local) | ${version.date}`;
      this.contextValue = 'gemstoneVersionLocal';
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.purple'));
      this.tooltip = version.buildDescription
        ? `${version.version} — local build\n${version.buildDescription}`
        : `${version.version} — local build`;
      return;
    }

    const clientOnly = isClientOnlyMode();
    const sizeLabel = version.size > 0 ? formatSize(version.size) : '';
    this.description = [sizeLabel, version.date, version.bundled ? 'bundled' : '']
      .filter(Boolean)
      .join(' | ');

    // Independent flag suffixes so `when` clauses can match each state with a
    // simple substring regex (e.g. /ServerExtracted/) without worrying about
    // cross-state overlap.
    let ctx = 'gemstoneVersion';
    if (version.downloaded) ctx += 'ServerDownloaded';
    if (version.extracted) ctx += 'ServerExtracted';
    if (version.clientExtracted) ctx += 'ClientExtracted';
    // The Bundled suffix also drops this row out of the download command's
    // `when` regex (which is anchored), so no download is offered for it.
    if (version.bundled) ctx += 'Bundled';
    this.contextValue = ctx;

    const tooltipBits: string[] = [version.version];
    if (clientOnly) {
      // Windows-no-WSL: icon reflects Windows-client state only.
      if (version.bundled) {
        // GCI ships with the extension — ready to use, no download needed.
        this.iconPath = new vscode.ThemeIcon(
          'package',
          new vscode.ThemeColor('testing.iconPassed'),
        );
        tooltipBits.push('GCI bundled with the extension — ready to use');
      } else if (version.clientExtracted) {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        tooltipBits.push('Windows client extracted');
      } else {
        this.iconPath = new vscode.ThemeIcon('cloud');
        tooltipBits.push('Windows client available for download');
      }
    } else {
      // Server state drives the primary icon.
      if (version.extracted) {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        tooltipBits.push('extracted and ready to use');
      } else if (version.downloaded) {
        this.iconPath = new vscode.ThemeIcon('cloud-download');
        tooltipBits.push('downloaded, not yet extracted');
      } else {
        this.iconPath = new vscode.ThemeIcon('cloud');
        tooltipBits.push('available for download');
      }
      if (isWindows() && version.clientExtracted) {
        tooltipBits.push('Windows client extracted');
      }
      if (version.bundled) {
        tooltipBits.push('GCI bundled with the extension');
      }
    }
    this.tooltip = tooltipBits.join(' — ');
  }
}

export class VersionTreeProvider implements vscode.TreeDataProvider<VersionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<VersionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private versions: GemStoneVersion[] = [];
  private loading = false;
  private loaded = false;

  constructor(private manager: VersionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async loadVersions(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.versions = await this.manager.fetchAvailableVersions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to load versions: ${msg}`);
      this.versions = [];
    } finally {
      this.loading = false;
      this.loaded = true;
      this.refresh();
    }
  }

  getTreeItem(element: VersionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): VersionItem[] | Thenable<VersionItem[]> {
    if (!this.loaded && !this.loading) {
      // Trigger the initial load once. A failed load leaves the list empty but
      // keeps `loaded` true so the refresh() below does not re-trigger us into
      // an endless reload/error-dialog loop. Explicit user actions (the refresh
      // command, post-download, etc.) call loadVersions() directly to re-fetch.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      this.loadVersions();
      return [];
    }
    return this.versions.map((v) => new VersionItem(v));
  }
}
