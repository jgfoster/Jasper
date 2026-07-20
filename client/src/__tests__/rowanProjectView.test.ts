import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __setWorkspaceFolders } from '../__mocks__/vscode';
import {
  RowanProjectTreeProvider,
  RowanProjectPackageItem,
  RowanProjectMessageItem,
} from '../rowanProjectView';

const dirs: string[] = [];

// A real directory that IS a Rowan project: rowan/project.ston + src/<pkg> dirs,
// and optionally a load spec (which supplies the display name).
function makeProjectDir(packages: string[] = [], specName?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-exproj-'));
  dirs.push(dir);
  const rowanDir = path.join(dir, 'rowan');
  fs.mkdirSync(rowanDir, { recursive: true });
  fs.writeFileSync(
    path.join(rowanDir, 'project.ston'),
    `RwProjectSpecificationV2 {\n\t#specName : 'project',\n\t#packagesPath : 'src',\n\t#specsPath : 'rowan/specs' }\n`,
  );
  if (specName) {
    const specsDir = path.join(rowanDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, `${specName}.ston`),
      `RwLoadSpecificationV2 {\n\t#specName : '${specName}'\n}\n`,
    );
  }
  for (const p of packages) fs.mkdirSync(path.join(dir, 'src', p), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  __setWorkspaceFolders(undefined);
});

describe('RowanProjectTreeProvider', () => {
  it('lists the project packages, sorted', () => {
    __setWorkspaceFolders([makeProjectDir(['Zeta-Core', 'Alpha-Core'])]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren();

    expect(rows.every((r) => r instanceof RowanProjectPackageItem)).toBe(true);
    expect(rows.map((r) => r.label)).toEqual(['Alpha-Core', 'Zeta-Core']);
  });

  it('shows a placeholder when the project has no packages', () => {
    __setWorkspaceFolders([makeProjectDir([])]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeInstanceOf(RowanProjectMessageItem);
    expect((rows[0] as RowanProjectMessageItem).kind).toBe('rowanProjectEmpty');
  });

  it('shows nothing when the open folder is not a Rowan project', () => {
    __setWorkspaceFolders([os.tmpdir()]);
    const provider = new RowanProjectTreeProvider();

    expect(provider.getChildren()).toEqual([]);
  });

  it('shows nothing when no folder is open', () => {
    __setWorkspaceFolders(undefined);
    const provider = new RowanProjectTreeProvider();

    expect(provider.getChildren()).toEqual([]);
  });

  it('exposes the project name for the section description', () => {
    __setWorkspaceFolders([makeProjectDir([], 'Seaside')]);
    const provider = new RowanProjectTreeProvider();

    expect(provider.projectName()).toBe('Seaside');
  });

  it('re-reads packages after refresh', () => {
    const dir = makeProjectDir(['One']);
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();
    expect(provider.getChildren().map((r) => r.label)).toEqual(['One']);

    fs.mkdirSync(path.join(dir, 'src', 'Two'));
    provider.refresh();

    expect(provider.getChildren().map((r) => r.label)).toEqual(['One', 'Two']);
  });
});
