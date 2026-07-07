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

  it('applies the gemstone.ston cache minimum to every spec in the project', () => {
    write('rowan/specs/Big.ston', LOAD_SPEC('Big'));
    write('rowan/specs/Also.ston', LOAD_SPEC('Also'));
    write('rowan/gemstone.ston', '{ #minTempObjCacheKB : 500000 }');

    const specs = findRowanLoadSpecs(root);

    expect(specs.map(s => s.minTempObjCacheKB)).toEqual([500000, 500000]);
  });

  it('reads the minimum even when gemstone.ston is walked after the spec', () => {
    // `specs/` sorts before a sibling `gemstone.ston`, so the metadata file is
    // visited only after the spec — the value must still be applied.
    write('rowan/specs/Late.ston', LOAD_SPEC('Late'));
    write('rowan/gemstone.ston', '{\n\t#minTempObjCacheKB : 750000\n}');

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.minTempObjCacheKB).toBe(750000);
  });

  it('leaves the minimum undefined when there is no gemstone.ston', () => {
    write('rowan/specs/Plain.ston', LOAD_SPEC('Plain'));

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.minTempObjCacheKB).toBeUndefined();
  });

  it('ignores a gemstone.ston without the cache key rather than failing', () => {
    write('rowan/specs/Ok.ston', LOAD_SPEC('Ok'));
    write('rowan/gemstone.ston', '{ #somethingElse : 1 }');

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.name).toBe('Ok');
    expect(spec.minTempObjCacheKB).toBeUndefined();
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
