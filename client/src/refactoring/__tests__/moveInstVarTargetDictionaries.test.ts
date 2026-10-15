import { describe, it, expect, vi } from 'vitest';
import {
  analyzeInstVarStructure,
  startInstVarStructurePreview,
} from '../queries/previewInstVarStructure';

/**
 * What a ▲/▼ move tells the engine about where the variable is going.
 *
 * A lineage can hold two classes of the same name from two dictionaries, and a name alone cannot
 * say which — the engine declines a bare name that two lineage classes answer to rather than
 * guessing. So each destination goes out with the dictionary that binds it, which the picker's
 * rows already carry (resolved by class identity).
 *
 * What is pinned here is that the dictionary survives the trip, next to its own class name, on
 * both the pre-flight and the preview send. The exact literal is pinned in
 * previewInstVarStructure.test.ts.
 */

const exec = () => vi.fn().mockResolvedValue('{}');

const target = (className: string, dictIndex: number | undefined) => ({ className, dictIndex });

/** The `toClasses:` argument of the code sent. */
const destinationsIn = (code: string): string =>
  code.slice(code.indexOf('toClasses:'), code.indexOf('direction:'));

/** Matches `className` followed by `dictIndex` with no other number between them. */
const paired = (className: string, dictIndex: number): RegExp =>
  new RegExp(`'${className}'\\D+${dictIndex}\\b`);

/** The code a move pre-flight sends. */
async function analyzeCode(
  targets: ReturnType<typeof target>[],
  direction: 'up' | 'down' = 'down',
): Promise<string> {
  const run = exec();
  await analyzeInstVarStructure(run, 'move', 'Root', 'weight', 7, undefined, true, {
    targets,
    direction,
  });
  return run.mock.calls[0][1] as string;
}

/** The code a move preview sends. */
async function previewCode(
  targets: ReturnType<typeof target>[],
  direction: 'up' | 'down' = 'down',
): Promise<string> {
  const run = exec();
  await startInstVarStructurePreview(
    run,
    'move',
    'Root',
    'weight',
    'tok',
    4096,
    7,
    undefined,
    true,
    { targets, direction },
  );
  return run.mock.calls[0][1] as string;
}

describe('sending a move’s destinations', () => {
  it('distinguishes two destinations that differ only by dictionary', async () => {
    const destinations = destinationsIn(await analyzeCode([target('Leaf', 3), target('Leaf', 5)]));

    expect(destinations).toMatch(paired('Leaf', 3));
    expect(destinations).toMatch(paired('Leaf', 5));
  });

  it('carries the dictionary of a single destination too', async () => {
    const code = await analyzeCode([target('Leaf', 5)]);

    expect(destinationsIn(code)).toMatch(paired('Leaf', 5));
  });

  it('carries the dictionary up the hierarchy as well as down', async () => {
    const code = await analyzeCode([target('Base', 3)], 'up');

    expect(code).toContain('direction: #up');
    expect(destinationsIn(code)).toMatch(paired('Base', 3));
  });

  it('still names each destination class', async () => {
    const destinations = destinationsIn(await analyzeCode([target('Leaf', 3), target('Other', 5)]));

    expect(destinations).toMatch(paired('Leaf', 3));
    expect(destinations).toMatch(paired('Other', 5));
  });

  it('sends the same destinations to the preview as to the pre-flight', async () => {
    // The pre-flight decides whether to go on and the preview is what the user approves; a
    // destination lost between them approves a change nobody checked.
    const targets = [target('Leaf', 3), target('Leaf', 5)];

    const analyze = await analyzeCode(targets);
    const preview = await previewCode(targets);

    expect(destinationsIn(preview)).toBe(destinationsIn(analyze));
  });

  it('sends a bare name for a destination no dictionary binds', async () => {
    // A superseded ancestor answers no `dictIndex`, and an unbound descendant answers 0. Neither
    // names a dictionary, so the destination goes out as its name alone — which brings the
    // ambiguity decline back for that hierarchy, and that is the honest answer. What must not
    // happen is the missing index reaching the Smalltalk as `undefined` or as a 0 the engine
    // would read as a position.
    const destinations = destinationsIn(
      await analyzeCode([target('Base', undefined), target('Leaf', 0)], 'up'),
    );

    expect(destinations).not.toContain('undefined');
    expect(destinations).not.toMatch(/\b0\b/);
    expect(destinations).toContain("'Base'");
    expect(destinations).toContain("'Leaf'");
  });

  it('escapes a class name that carries a quote', async () => {
    const code = await analyzeCode([target("O'Hara", 3)]);

    expect(code).toContain("O''Hara");
  });
});
