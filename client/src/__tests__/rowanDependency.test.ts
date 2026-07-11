import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRowanProject } from '../rowanCreate';
import { addPreloadDependency } from '../rowanDependency';
import { RowanCatalogEntry } from '../rowanCatalog';

const dirs: string[] = [];
function project(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-dep-'));
  dirs.push(d);
  createRowanProject(d, 'MyApp');
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const read = (root: string, p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const seaside: RowanCatalogEntry = {
  name: 'Seaside',
  description: '',
  projectUrl: '',
  baseline: 'Seaside3',
  repository: 'github://SeasideSt/Seaside:v3.6.0/repository',
  loads: ['Development'],
};
const grease: RowanCatalogEntry = {
  name: 'Grease',
  description: '',
  projectUrl: '',
  baseline: 'Grease',
  repository: 'github://GsDevKit/Grease:master/repository',
  loads: ['default'],
};

describe('addPreloadDependency', () => {
  it('sets #preloadDoitName on the component and writes the doit with the load', () => {
    const root = project();

    const result = addPreloadDependency(root, seaside);

    expect(result.success).toBe(true);
    expect(read(root, 'rowan/components/Core.ston')).toContain("#preloadDoitName : 'preload',");
    const doit = read(root, 'rowan/components/preload.st');
    expect(doit).toContain("baseline: 'Seaside3';");
    expect(doit).toContain('github://SeasideSt/Seaside:v3.6.0/repository');
  });

  it('appends a second dependency to the same doit, keeping one #preloadDoitName', () => {
    const root = project();

    addPreloadDependency(root, seaside);
    addPreloadDependency(root, grease);

    const doit = read(root, 'rowan/components/preload.st');
    expect(doit).toContain('SeasideSt/Seaside');
    expect(doit).toContain('GsDevKit/Grease');
    expect(read(root, 'rowan/components/Core.ston').match(/#preloadDoitName/g)?.length).toBe(1);
  });

  it('is idempotent for the same dependency', () => {
    const root = project();

    addPreloadDependency(root, seaside);
    const second = addPreloadDependency(root, seaside);

    expect(second.alreadyPresent).toBe(true);
    expect(read(root, 'rowan/components/preload.st').match(/SeasideSt\/Seaside/g)?.length).toBe(1);
  });

  it('errors when the named component is missing', () => {
    const root = project();

    const result = addPreloadDependency(root, seaside, 'Nope');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
