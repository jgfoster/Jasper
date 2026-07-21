import { describe, it, expect } from 'vitest';
import { metacelloLoadExpression } from '../rowanMetacello';
import { RowanCatalogEntry } from '../rowanCatalog';

const entry = (over: Partial<RowanCatalogEntry> = {}): RowanCatalogEntry => ({
  name: 'Seaside',
  description: '',
  projectUrl: '',
  baseline: 'Seaside3',
  repository: 'github://SeasideSt/Seaside:v3.6.0/repository',
  loads: ['Welcome', 'Development'],
  ...over,
});

describe('metacelloLoadExpression', () => {
  it('builds the GsUpgrader prerequisite + GsDeployer-wrapped Metacello load', () => {
    const code = metacelloLoadExpression(entry());

    expect(code).toContain('(Smalltalk at: #GsUpgrader) upgradeGrease.');
    expect(code).toContain('GsDeployer deploy: [');
    expect(code).toContain("baseline: 'Seaside3';");
    expect(code).toContain("repository: 'github://SeasideSt/Seaside:v3.6.0/repository';");
    expect(code).toContain('onLock: [:ex | ex honor];');
  });

  it('narrows to the named load groups', () => {
    const code = metacelloLoadExpression(entry({ loads: ['Welcome', 'Development'] }));

    expect(code).toContain("load: #('Welcome' 'Development')");
  });

  it('uses a plain `load` for the default group', () => {
    expect(metacelloLoadExpression(entry({ loads: ['default'] }))).toMatch(/\bload \]\.$/);
    expect(metacelloLoadExpression(entry({ loads: [] }))).toMatch(/\bload \]\.$/);
  });

  it('escapes single quotes in the baseline/repository', () => {
    const code = metacelloLoadExpression(entry({ baseline: "O'Dd", repository: "x'y" }));

    expect(code).toContain("baseline: 'O''Dd';");
    expect(code).toContain("repository: 'x''y';");
  });
});
