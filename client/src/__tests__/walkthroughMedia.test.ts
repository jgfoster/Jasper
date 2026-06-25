import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Getting Started walkthrough (contributes.walkthroughs) points each step at a
// markdown file under resources/. Those paths are resolved by VS Code at runtime, so
// a typo or a deleted/unshipped file yields a broken, blank walkthrough step rather
// than a build error. This guard asserts every declared media path exists on disk.
//
// __dirname is client/src/__tests__, so the repo root (where package.json lives) is
// three levels up.
describe('walkthrough media files are present', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const walkthroughs: Array<{ id: string; steps: Array<{ id: string; media?: Record<string, string> }> }> =
    pkg.contributes?.walkthroughs ?? [];

  const mediaPaths: string[] = [];
  for (const wt of walkthroughs) {
    for (const step of wt.steps ?? []) {
      const media = step.media ?? {};
      for (const key of ['markdown', 'image', 'svg']) {
        if (typeof media[key] === 'string') mediaPaths.push(media[key]);
      }
    }
  }

  it('declares the Getting Started walkthrough with steps (guards a broken scan)', () => {
    const gettingStarted = walkthroughs.find((w) => w.id === 'gemstoneGettingStarted');
    expect(gettingStarted).toBeDefined();
    expect(gettingStarted!.steps.length).toBeGreaterThan(0);
  });

  it.each(mediaPaths)('ships walkthrough media %s (exists on disk)', (rel) => {
    expect(fs.existsSync(path.join(repoRoot, rel))).toBe(true);
  });
});
