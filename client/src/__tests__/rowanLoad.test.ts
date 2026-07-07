import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findRowanLoadSpecs, deriveRepoName , rowanClonesDir } from '../rowanLoad';

const LOAD_SPEC = (name: string) => `RwLoadSpecificationV2 {
\t#specName : '${name}',
\t#projectName : '${name}',
\t#componentNames : [ 'Core' ]
}`;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-rowan-load-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('findRowanLoadSpecs', () => {
  it('finds a load spec by its content signature, in any layout', () => {
    write('rowan/specs/LoadMe.ston', LOAD_SPEC('LoadMe'));
    write('rowan/project.ston', 'RwProjectSpecificationV2 { #specName : \'project\' }');

    const specs = findRowanLoadSpecs(root);

    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe('LoadMe');
    expect(specs[0].path.endsWith('rowan/specs/LoadMe.ston')).toBe(true);
  });

  it('ignores .ston files that are not load specs', () => {
    write('specsV2/Real.ston', LOAD_SPEC('Real'));
    write('componentsV2/Core.ston', 'RwSimpleProjectLoadComponentV2 { #name : \'Core\' }');

    const specs = findRowanLoadSpecs(root);

    expect(specs.map(s => s.name)).toEqual(['Real']);
  });

  it('returns all load specs sorted, for the caller to disambiguate', () => {
    write('specsV2/Zeta.ston', LOAD_SPEC('Zeta'));
    write('specsV2/Alpha.ston', LOAD_SPEC('Alpha'));

    const specs = findRowanLoadSpecs(root);

    expect(specs.map(s => s.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('returns nothing for a directory with no load specs', () => {
    write('src/readme.txt', 'hello');

    expect(findRowanLoadSpecs(root)).toEqual([]);
  });
});

describe('deriveRepoName', () => {
  it('takes the repo name from scp-style, https, and file URLs, dropping .git', () => {
    expect(deriveRepoName('git@github.com:GemTalk/Rowan.git')).toBe('Rowan');
    expect(deriveRepoName('https://github.com/GemTalk/Rowan.git')).toBe('Rowan');
    expect(deriveRepoName('https://example.com/foo/Bar/')).toBe('Bar');
    expect(deriveRepoName('file:///tmp/repos/MyProject')).toBe('MyProject');
  });
});

describe('rowanClonesDir', () => {
  it('is a repos folder inside global storage, created on demand', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gstorage-'));

    const dir = rowanClonesDir(base);

    expect(dir).toBe(path.join(base, 'repos'));
    expect(fs.existsSync(dir)).toBe(true);
  });
});
