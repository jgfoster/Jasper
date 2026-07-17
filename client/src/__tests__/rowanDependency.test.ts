import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRowanProject } from '../rowanCreate';
import {
  addProjectDependency,
  dependencyNameFromGitUrl,
  readProjectDependencies,
} from '../rowanDependency';

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-dep-'));
  createRowanProject(dir, 'host-app');
  return dir;
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

describe('dependencyNameFromGitUrl', () => {
  it('takes the repository basename without a trailing .git', () => {
    expect(dependencyNameFromGitUrl('https://github.com/owner/Seaside.git')).toBe('Seaside');
    expect(dependencyNameFromGitUrl('git@github.com:owner/Seaside.git')).toBe('Seaside');
    expect(dependencyNameFromGitUrl('https://github.com/owner/Seaside')).toBe('Seaside');
    expect(dependencyNameFromGitUrl('https://github.com/owner/Seaside/')).toBe('Seaside');
  });
});

describe('addProjectDependency', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpProject();
  });

  it('writes a git dependency with its URL and revision, and no disk URL', () => {
    const dep = {
      kind: 'git' as const,
      name: 'Seaside',
      gitUrl: 'https://github.com/SeasideSt/Seaside.git',
      revision: 'v3.6.0',
    };

    const result = addProjectDependency(dir, dep);

    expect(result.success).toBe(true);
    const spec = read(dir, 'rowan/projects/Seaside.ston');
    expect(spec).toContain('RwLoadSpecificationV2 {');
    expect(spec).toContain("#gitUrl : 'https://github.com/SeasideSt/Seaside.git',");
    expect(spec).toContain("#revision : 'v3.6.0',");
    expect(spec).not.toContain('#diskUrl');
  });

  it('preserves an ssh-style git URL verbatim', () => {
    addProjectDependency(dir, {
      kind: 'git',
      name: 'Seaside',
      gitUrl: 'git@github.com:SeasideSt/Seaside.git',
      revision: 'master',
    });

    expect(read(dir, 'rowan/projects/Seaside.ston')).toContain(
      "#gitUrl : 'git@github.com:SeasideSt/Seaside.git',",
    );
  });

  it('writes a directory dependency with a disk URL and no revision', () => {
    const dep = { kind: 'disk' as const, name: 'Local', diskUrl: '/work/Local' };

    const result = addProjectDependency(dir, dep);

    expect(result.success).toBe(true);
    const spec = read(dir, 'rowan/projects/Local.ston');
    expect(spec).toContain("#diskUrl : '/work/Local',");
    expect(spec).not.toContain('#gitUrl');
    expect(spec).not.toContain('#revision');
  });

  it('lists the dependency in the Core component so it loads', () => {
    addProjectDependency(dir, {
      kind: 'git',
      name: 'Seaside',
      gitUrl: 'https://github.com/SeasideSt/Seaside.git',
      revision: 'v3.6.0',
    });

    expect(read(dir, 'rowan/components/Core.ston')).toContain(
      "#projectNames : [\n\t\t'Seaside'\n\t]",
    );
  });

  it('adds a second dependency alongside the first in the component', () => {
    addProjectDependency(dir, { kind: 'disk', name: 'One', diskUrl: '/work/One' });
    addProjectDependency(dir, { kind: 'disk', name: 'Two', diskUrl: '/work/Two' });

    const core = read(dir, 'rowan/components/Core.ston');
    expect(core).toContain("'One'");
    expect(core).toContain("'Two'");
  });

  it('does not list the same dependency twice', () => {
    const dep = { kind: 'disk' as const, name: 'One', diskUrl: '/work/One' };

    addProjectDependency(dir, dep);
    const second = addProjectDependency(dir, dep);

    expect(second.alreadyPresent).toBe(true);
    const matches = read(dir, 'rowan/components/Core.ston').match(/'One'/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('fails when the named component does not exist', () => {
    const result = addProjectDependency(
      dir,
      { kind: 'disk', name: 'One', diskUrl: '/work/One' },
      'Missing',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing/);
  });
});

describe('readProjectDependencies', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpProject();
  });

  it('finds nothing in a project that depends on nothing', () => {
    expect(readProjectDependencies(dir)).toEqual([]);
  });

  it('finds nothing in a directory that is not a project', () => {
    expect(readProjectDependencies(path.join(dir, 'nowhere'))).toEqual([]);
  });

  it('reads back a git dependency as it was written', () => {
    const dep = {
      kind: 'git' as const,
      name: 'Seaside',
      gitUrl: 'https://github.com/SeasideSt/Seaside.git',
      revision: 'v3.6.0',
    };
    addProjectDependency(dir, dep);

    expect(readProjectDependencies(dir)).toEqual([dep]);
  });

  it('reads back a directory dependency as it was written', () => {
    const dep = { kind: 'disk' as const, name: 'SharedKit', diskUrl: '/work/SharedKit' };
    addProjectDependency(dir, dep);

    expect(readProjectDependencies(dir)).toEqual([dep]);
  });

  it('reads a name containing a quote back unescaped', () => {
    const dep = { kind: 'disk' as const, name: "O'Hare", diskUrl: "/work/O'Hare" };
    addProjectDependency(dir, dep);

    expect(readProjectDependencies(dir)).toEqual([dep]);
  });

  it('lists every dependency, by name', () => {
    addProjectDependency(dir, { kind: 'disk', name: 'Zebra', diskUrl: '/work/Zebra' });
    addProjectDependency(dir, { kind: 'disk', name: 'Alpha', diskUrl: '/work/Alpha' });

    expect(readProjectDependencies(dir).map((d) => d.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('skips a spec that names no repository to fetch from', () => {
    fs.mkdirSync(path.join(dir, 'rowan', 'projects'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'rowan', 'projects', 'Broken.ston'),
      "RwLoadSpecificationV2 {\n\t#projectName : 'Broken'\n}",
    );

    expect(readProjectDependencies(dir)).toEqual([]);
  });
});
