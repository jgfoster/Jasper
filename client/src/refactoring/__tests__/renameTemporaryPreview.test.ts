import { describe, it, expect } from 'vitest';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  temporaryChangeLabel,
  validateNewTemporaryName,
} from '../renameTemporaryPreview';

const methodChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'computeTemp',
  category: 'computing',
  oldSource: 'computeTemp | t | t := 1. ^t',
  newSource: 'computeTemp | sum | sum := 1. ^sum',
};

function startJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok',
    total: 1,
    oldName: 't',
    newName: 'sum',
    outOfScope: { references: 0, skipped: 0, scope: 'method', collision: null, decline: null },
    skippedMethods: [],
    page: { changes: [methodChange], nextOffset: 2, done: true },
    ...over,
  });
}

describe('rename-temporary preview parsing', () => {
  it('reads the totals and names from the start envelope', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(1);
    expect(start.oldName).toBe('t');
    expect(start.newName).toBe('sum');
    expect(start.page.changes).toHaveLength(1);
  });

  it('parses the single method-recompile change with the local renamed', () => {
    const [change] = parseStartPreview(startJson()).page.changes;

    expect(change.kind).toBe('methodRecompile');
    expect(change.selector).toBe('computeTemp');
    expect(change.newSource).toContain('sum := 1');
    expect(change.newSource).not.toContain('t :=');
  });

  it('surfaces a collision reason when the new name is already taken', () => {
    const start = parseStartPreview(
      startJson({
        outOfScope: {
          references: 0,
          skipped: 0,
          scope: 'method',
          collision: 'the name count is already an instance variable',
          decline: null,
        },
      }),
    );

    expect(start.outOfScope.collision).toContain('already an instance variable');
    expect(start.outOfScope.decline).toBeNull();
  });

  it('surfaces a decline reason when the target is not a local', () => {
    const start = parseStartPreview(
      startJson({
        total: 0,
        outOfScope: {
          references: 0,
          skipped: 0,
          scope: 'method',
          collision: null,
          decline: 'the name count at that position is not a temporary or argument',
        },
        page: { changes: [], nextOffset: 1, done: true },
      }),
    );

    expect(start.outOfScope.decline).toContain('not a temporary or argument');
    expect(start.total).toBe(0);
  });

  it('rejects a change of an unexpected kind (no class-definition edit for R5)', () => {
    expect(() =>
      parseStartPreview(
        startJson({
          page: {
            changes: [{ ...methodChange, kind: 'classDefinitionEdit' }],
            nextOffset: 2,
            done: true,
          },
        }),
      ),
    ).toThrow();
  });

  it('reports a bare error string as a thrown error rather than a change list', () => {
    expect(() => parseStartPreview('Class not found: Account')).toThrow();
  });

  it('reports the applied count and no failures for a clean apply', () => {
    const result = parseApplyResult(JSON.stringify({ applied: 1, failed: [] }));

    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it('labels a method on each side', () => {
    expect(temporaryChangeLabel(parseStartPreview(startJson()).page.changes[0])).toBe(
      'Account>>computeTemp',
    );
    const classSide = parseStartPreview(
      startJson({
        page: { changes: [{ ...methodChange, isMeta: true }], nextOffset: 2, done: true },
      }),
    ).page.changes[0];
    expect(temporaryChangeLabel(classSide)).toBe('Account class>>computeTemp');
  });

  it('parses a later page of changes', () => {
    const page = parsePage(JSON.stringify({ changes: [methodChange], nextOffset: 3, done: false }));

    expect(page.changes).toHaveLength(1);
    expect(page.done).toBe(false);
  });

  it('throws when a page envelope carries a stale-token error', () => {
    expect(() => parsePage(JSON.stringify({ error: 'no preview for token' }))).toThrow(
      'no preview for token',
    );
  });

  it('surfaces the error field on an apply result envelope', () => {
    const result = parseApplyResult(
      JSON.stringify({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    expect(result.error).toBe('preview session expired');
  });

  it('defaults missing names, out-of-scope, and page fields defensively', () => {
    const start = parseStartPreview(JSON.stringify({ token: 'tok' }));

    expect(start.oldName).toBe('');
    expect(start.outOfScope).toEqual({ references: 0, skipped: 0, collision: null, decline: null });
    expect(start.page).toEqual({ changes: [], nextOffset: 0, done: true });
  });
});

describe('new temporary/argument name validation', () => {
  it('accepts a distinct identifier', () => {
    expect(validateNewTemporaryName('sum', 't')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateNewTemporaryName('   ', 't')).toBeDefined();
  });

  it('rejects the unchanged name', () => {
    expect(validateNewTemporaryName('t', 't')).toBeDefined();
  });

  it('rejects a name that is not a valid identifier', () => {
    expect(validateNewTemporaryName('9x', 't')).toBeDefined();
    expect(validateNewTemporaryName('has space', 't')).toBeDefined();
    expect(validateNewTemporaryName('x:', 't')).toBeDefined();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateNewTemporaryName('  total  ', 't')).toBeUndefined();
  });
});
