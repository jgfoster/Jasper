import { describe, it, expect } from 'vitest';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  classVarChangeLabel,
  validateNewClassVarName,
} from '../renameClassVarPreview';

const defChange = {
  id: '1',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Object subclass: 'Account' classVars: #( Rate)",
  newSource: "Object subclass: 'Account' classVars: #( InterestRate)",
};
const instMethodChange = {
  id: '2',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'accrue',
  category: 'computing',
  oldSource: 'accrue ^balance * Rate',
  newSource: 'accrue ^balance * InterestRate',
};
const classMethodChange = {
  id: '3',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: true,
  selector: 'resetRate',
  category: 'defaults',
  oldSource: 'resetRate Rate := 0',
  newSource: 'resetRate InterestRate := 0',
};

function startJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok',
    total: 3,
    oldName: 'Rate',
    newName: 'InterestRate',
    outOfScope: { references: 0, skipped: 0, scope: 'hierarchy', collision: null },
    skippedMethods: [],
    page: { changes: [defChange, instMethodChange, classMethodChange], nextOffset: 4, done: true },
    ...over,
  });
}

describe('rename-class-variable preview parsing', () => {
  it('reads the totals, names, and collision from the start envelope', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(3);
    expect(start.oldName).toBe('Rate');
    expect(start.newName).toBe('InterestRate');
    expect(start.outOfScope.collision).toBeNull();
    expect(start.page.changes).toHaveLength(3);
  });

  it('reads the two change kinds and both method sides', () => {
    const [def, inst, cls] = parseStartPreview(startJson()).page.changes;

    expect(def.kind).toBe('classDefinitionEdit');
    expect(inst.kind).toBe('methodRecompile');
    expect(inst.isMeta).toBe(false);
    expect(cls.isMeta).toBe(true);
    expect(inst.newSource).toContain('InterestRate');
  });

  it('surfaces a collision reason when the new name is already in use', () => {
    const start = parseStartPreview(
      startJson({
        outOfScope: {
          references: 0,
          skipped: 0,
          scope: 'hierarchy',
          collision: 'the name InterestRate is already a class variable in the hierarchy',
        },
      }),
    );

    expect(start.outOfScope.collision).toContain('already a class variable');
  });

  it('reports a bare error string as a thrown error rather than a change list', () => {
    expect(() => parseStartPreview('Class not found: Account')).toThrow();
  });

  it('parses a later page of changes', () => {
    const page = parsePage(
      JSON.stringify({ changes: [instMethodChange], nextOffset: 5, done: false }),
    );

    expect(page.changes).toHaveLength(1);
    expect(page.done).toBe(false);
    expect(page.nextOffset).toBe(5);
  });

  it('reports the applied count and no failures for a clean apply', () => {
    const result = parseApplyResult(JSON.stringify({ applied: 3, failed: [] }));

    expect(result.applied).toBe(3);
    expect(result.failed).toHaveLength(0);
  });

  it('labels a class-definition edit and a method on each side', () => {
    expect(classVarChangeLabel(parseStartPreview(startJson()).page.changes[0])).toContain(
      'class definition',
    );
    expect(classVarChangeLabel(parseStartPreview(startJson()).page.changes[1])).toBe(
      'Account>>accrue',
    );
    expect(classVarChangeLabel(parseStartPreview(startJson()).page.changes[2])).toBe(
      'Account class>>resetRate',
    );
  });

  it('throws when a page envelope carries an expired/stale-token error', () => {
    expect(() => parsePage(JSON.stringify({ error: 'no preview for token' }))).toThrow(
      'no preview for token',
    );
  });

  it('throws when the start envelope page carries an error', () => {
    expect(() =>
      parseStartPreview(startJson({ page: { error: 'preview session expired' } })),
    ).toThrow('preview session expired');
  });

  it('surfaces the error field on an apply result envelope', () => {
    const result = parseApplyResult(
      JSON.stringify({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    expect(result.error).toBe('preview session expired');
  });

  it('parses failed apply entries, filling fallbacks for a malformed one', () => {
    const result = parseApplyResult(
      JSON.stringify({
        applied: 1,
        failed: [
          { id: '2', label: 'Account>>accrue', error: 'compile failed' },
          { id: 7 }, // malformed: non-string id, missing label/error
        ],
      }),
    );

    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toEqual({
      id: '2',
      label: 'Account>>accrue',
      error: 'compile failed',
    });
    expect(result.failed[1]).toEqual({ id: '?', label: '?', error: 'unknown error' });
  });

  it('throws when the start envelope has no session token', () => {
    expect(() => parseStartPreview(JSON.stringify({ total: 0 }))).toThrow();
  });

  it('defaults missing names, out-of-scope, and page fields defensively', () => {
    const start = parseStartPreview(JSON.stringify({ token: 'tok' }));

    expect(start.oldName).toBe('');
    expect(start.newName).toBe('');
    expect(start.outOfScope).toEqual({ references: 0, skipped: 0, collision: null });
    expect(start.page).toEqual({ changes: [], nextOffset: 0, done: true });
  });
});

describe('new class-variable name validation', () => {
  it('accepts a distinct identifier', () => {
    expect(validateNewClassVarName('InterestRate', 'Rate')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateNewClassVarName('   ', 'Rate')).toBeDefined();
  });

  it('rejects the unchanged name', () => {
    expect(validateNewClassVarName('Rate', 'Rate')).toBeDefined();
  });

  it('rejects a name that is not a valid identifier', () => {
    expect(validateNewClassVarName('9Rate', 'Rate')).toBeDefined();
    expect(validateNewClassVarName('has space', 'Rate')).toBeDefined();
    expect(validateNewClassVarName('Rate!', 'Rate')).toBeDefined();
    expect(validateNewClassVarName('Rate:', 'Rate')).toBeDefined();
  });

  it('accepts a leading underscore (GemStone does not require capitalization)', () => {
    expect(validateNewClassVarName('_hidden', 'Rate')).toBeUndefined();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateNewClassVarName('  Tally  ', 'Rate')).toBeUndefined();
  });
});
