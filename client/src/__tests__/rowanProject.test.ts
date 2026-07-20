import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isRowanProjectRoot, readRowanWorkspaceProject } from '../rowanProject';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-proj-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

interface SpecOpts {
  className?: string;
  packagesPath?: string;
  specsPath?: string;
  format?: string;
  convention?: string;
}

function writeProjectSpec(opts: SpecOpts = {}): void {
  const dir = path.join(root, 'rowan');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`${opts.className ?? 'RwProjectSpecificationV2'} {`, `\t#specName : 'project',`];
  if (opts.packagesPath) lines.push(`\t#packagesPath : '${opts.packagesPath}',`);
  if (opts.specsPath) lines.push(`\t#specsPath : '${opts.specsPath}',`);
  if (opts.format) lines.push(`\t#packageFormat : '${opts.format}',`);
  if (opts.convention) lines.push(`\t#packageConvention : '${opts.convention}',`);
  lines.push(`\t#comment : 'test project' }`);
  fs.writeFileSync(path.join(dir, 'project.ston'), lines.join('\n'));
}

function writeLoadSpec(name: string, specsPath = 'rowan/specs'): void {
  const dir = path.join(root, specsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.ston`),
    `RwLoadSpecificationV2 {\n\t#specName : '${name}'\n}\n`,
  );
}

function writePackages(packagesPath: string, names: string[]): void {
  for (const n of names) fs.mkdirSync(path.join(root, packagesPath, n), { recursive: true });
}

describe('isRowanProjectRoot', () => {
  it('recognizes a folder with a rowan/project.ston marker', () => {
    writeProjectSpec();

    expect(isRowanProjectRoot(root)).toBe(true);
  });

  it('rejects a folder without the marker', () => {
    expect(isRowanProjectRoot(root)).toBe(false);
  });
});

describe('readRowanWorkspaceProject', () => {
  it('returns null when the folder is not a Rowan project', () => {
    expect(readRowanWorkspaceProject(root)).toBeNull();
  });

  it('returns null when project.ston is not a project spec', () => {
    fs.mkdirSync(path.join(root, 'rowan'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rowan', 'project.ston'), `RwLoadSpecificationV2 { }`);

    expect(readRowanWorkspaceProject(root)).toBeNull();
  });

  it('does not throw when the marker exists but is unreadable', () => {
    // A directory where project.ston should be — readFileSync throws EISDIR.
    fs.mkdirSync(path.join(root, 'rowan', 'project.ston'), { recursive: true });

    expect(readRowanWorkspaceProject(root)).toBeNull();
  });

  it('reads the declared packagesPath (V3 src layout)', () => {
    writeProjectSpec({ packagesPath: 'src' });

    expect(readRowanWorkspaceProject(root)?.packagesPath).toBe('src');
  });

  it('reads the declared packagesPath (V2 rowan/src layout)', () => {
    writeProjectSpec({ packagesPath: 'rowan/src' });

    expect(readRowanWorkspaceProject(root)?.packagesPath).toBe('rowan/src');
  });

  it('defaults packagesPath to src when the spec omits it', () => {
    writeProjectSpec();

    expect(readRowanWorkspaceProject(root)?.packagesPath).toBe('src');
  });

  it('parses format, convention, and paths when declared', () => {
    writeProjectSpec({
      packagesPath: 'src',
      specsPath: 'rowan/specs',
      format: 'tonel',
      convention: 'RowanHybrid',
    });

    const proj = readRowanWorkspaceProject(root);

    expect(proj?.packageFormat).toBe('tonel');
    expect(proj?.packageConvention).toBe('RowanHybrid');
    expect(proj?.specsPath).toBe('rowan/specs');
  });

  it('takes the name from a sole load spec', () => {
    writeProjectSpec();
    writeLoadSpec('MyProject');

    expect(readRowanWorkspaceProject(root)?.name).toBe('MyProject');
  });

  it('honors a custom specsPath when finding the load spec', () => {
    writeProjectSpec({ specsPath: 'rowan/specsV2' });
    writeLoadSpec('Custom', 'rowan/specsV2');

    expect(readRowanWorkspaceProject(root)?.name).toBe('Custom');
  });

  it('falls back to the folder name when there is no load spec', () => {
    writeProjectSpec();

    expect(readRowanWorkspaceProject(root)?.name).toBe(path.basename(root));
  });

  it('falls back to the folder name when multiple load specs are ambiguous', () => {
    writeProjectSpec();
    writeLoadSpec('One');
    writeLoadSpec('Two');

    expect(readRowanWorkspaceProject(root)?.name).toBe(path.basename(root));
  });

  it('lists package directories, sorted, ignoring files', () => {
    writeProjectSpec({ packagesPath: 'src' });
    writePackages('src', ['Zeta-Core', 'Alpha-Core']);
    fs.writeFileSync(path.join(root, 'src', 'properties.st'), `{ #format : 'tonel' }`);

    expect(readRowanWorkspaceProject(root)?.packages.map((p) => p.name)).toEqual([
      'Alpha-Core',
      'Zeta-Core',
    ]);
  });

  it('returns no packages when the packages directory is absent', () => {
    writeProjectSpec({ packagesPath: 'src' });

    expect(readRowanWorkspaceProject(root)?.packages).toEqual([]);
  });
});
