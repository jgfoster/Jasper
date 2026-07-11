import { describe, it, expect } from 'vitest';
import { CATALOG_SEED, mergeCatalog, RowanCatalogEntry } from '../rowanCatalog';

describe('CATALOG_SEED', () => {
  it('every entry has a name, baseline, and a github Metacello repository', () => {
    for (const e of CATALOG_SEED) {
      expect(e.name).toBeTruthy();
      expect(e.baseline).toBeTruthy();
      expect(e.repository).toMatch(/^github:\/\//);
    }
  });

  it('leads with Seaside, pinned to the latest release', () => {
    const seaside = CATALOG_SEED.find((e) => e.name === 'Seaside');
    expect(seaside?.baseline).toBe('Seaside3');
    expect(seaside?.repository).toBe('github://SeasideSt/Seaside:v3.6.0/repository');
  });

  it('drops the GsDevKit tooling/infra entries', () => {
    const names = new Set(CATALOG_SEED.map((e) => e.name));
    for (const infra of ['GsDevKit_home', 'Tode', 'SmalltalkCI', 'Metacello', 'GsUpgrader']) {
      expect(names.has(infra)).toBe(false);
    }
  });

  it('has unique entry names', () => {
    const names = CATALOG_SEED.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('mergeCatalog', () => {
  it('returns the seed, sorted by name, when there are no user entries', () => {
    const merged = mergeCatalog();

    expect(merged.length).toBe(CATALOG_SEED.length);
    const names = merged.map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('adds a user entry not in the seed', () => {
    const mine: RowanCatalogEntry = {
      name: 'MyLib',
      description: '',
      projectUrl: '',
      baseline: 'MyLib',
      repository: 'github://me/MyLib:master/repository',
      loads: ['default'],
    };

    const merged = mergeCatalog([mine]);

    expect(merged.length).toBe(CATALOG_SEED.length + 1);
    expect(merged.find((e) => e.name === 'MyLib')).toEqual(mine);
  });

  it('lets a user entry override a seed entry of the same name', () => {
    const override: RowanCatalogEntry = {
      name: 'Seaside',
      description: 'pinned',
      projectUrl: '',
      baseline: 'Seaside3',
      repository: 'github://SeasideSt/Seaside:v3.5.9/repository',
      loads: ['Core'],
    };

    const merged = mergeCatalog([override]);

    expect(merged.length).toBe(CATALOG_SEED.length);
    expect(merged.find((e) => e.name === 'Seaside')?.repository).toBe(
      'github://SeasideSt/Seaside:v3.5.9/repository',
    );
  });
});
