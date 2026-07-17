import { describe, it, expect } from 'vitest';
import { renderGrailStub, selectorKind, selectorArity, selectorToPyName } from '../grailStub';
import { GrailStubReflection } from '../queries/grailStubReflection';

function reflection(overrides: Partial<GrailStubReflection> = {}): GrailStubReflection {
  return {
    found: true,
    superclass: 'Object',
    comment: '',
    instVars: [],
    methods: [],
    ...overrides,
  };
}

describe('selector classification', () => {
  it('recognises a unary selector', () => {
    expect(selectorKind('size')).toBe('unary');
    expect(selectorArity('size')).toBe(0);
  });

  it('recognises a keyword selector and counts its arguments', () => {
    expect(selectorKind('at:put:')).toBe('keyword');
    expect(selectorArity('at:put:')).toBe(2);
  });

  it('recognises a binary selector as taking one argument', () => {
    expect(selectorKind('<=')).toBe('binary');
    expect(selectorArity('<=')).toBe(1);
  });
});

describe('selector to Python name', () => {
  it('keeps a unary selector as-is', () => {
    expect(selectorToPyName('isEmpty')).toBe('isEmpty');
  });

  it('joins keyword parts with underscores, preserving their names', () => {
    expect(selectorToPyName('transferTo:amount:')).toBe('transferTo_amount');
  });

  it('maps a known binary selector to its Python dunder', () => {
    expect(selectorToPyName('=')).toBe('__eq__');
    expect(selectorToPyName('+')).toBe('__add__');
  });
});

describe('rendering a Grail stub', () => {
  it('emits the grail import and the smalltalk_class decorator for the class', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [],
    });

    expect(out).toContain('from grail import smalltalk, smalltalk_class');
    expect(out).toContain("@smalltalk_class(dictionary='Finance', class_name='Account')");
    expect(out).toContain('class Account:');
  });

  it('lists the class comment as a docstring', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({ comment: 'An account.' }),
      wrapSelectors: [],
    });

    expect(out).toContain('    """An account."""');
  });

  it('renders own instance variables as an ordered slots tuple', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({
        instVars: [
          { name: 'balance', hasGetter: false, hasSetter: false },
          { name: 'owner', hasGetter: false, hasSetter: false },
        ],
      }),
      wrapSelectors: [],
    });

    expect(out).toContain("    __slots__ = ('balance', 'owner')");
  });

  it('uses an empty tuple when the class has no own instance variables', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [],
    });

    expect(out).toContain('    __slots__ = ()');
  });

  it('keeps a trailing comma for a single instance variable', () => {
    const out = renderGrailStub({
      className: 'Box',
      dictionaryName: 'Toys',
      reflection: reflection({ instVars: [{ name: 'value', hasGetter: false, hasSetter: false }] }),
      wrapSelectors: [],
    });

    expect(out).toContain("    __slots__ = ('value',)");
  });

  it('wraps the accessor and mutator that the class actually understands', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({ instVars: [{ name: 'balance', hasGetter: true, hasSetter: true }] }),
      wrapSelectors: [],
    });

    expect(out).toContain("@smalltalk('balance')");
    expect(out).toContain('def get_balance(self): ...');
    expect(out).toContain("@smalltalk('balance:')");
    expect(out).toContain('def set_balance(self, value): ...');
  });

  it('omits the mutator wrapper for a read-only instance variable', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({ instVars: [{ name: 'owner', hasGetter: true, hasSetter: false }] }),
      wrapSelectors: [],
    });

    expect(out).toContain('def get_owner(self): ...');
    expect(out).not.toContain('def set_owner');
  });

  it('notes an instance variable with no accessor instead of wrapping it', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({
        instVars: [{ name: 'history', hasGetter: false, hasSetter: false }],
      }),
      wrapSelectors: [],
    });

    expect(out).toContain("# 'history': no Smalltalk accessor/mutator");
    expect(out).not.toContain("@smalltalk('history')");
  });

  it('scaffolds a keyword method wrapper with one argument per keyword part', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [{ side: 'instance', selector: 'transferTo:amount:' }],
    });

    expect(out).toContain("@smalltalk('transferTo:amount:')");
    expect(out).toContain('def transferTo_amount(self, transferTo, amount): ...');
  });

  it('scaffolds a class-side wrapper as a classmethod on the class', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [{ side: 'class', selector: 'new' }],
    });

    expect(out).toContain('@classmethod');
    expect(out).toContain("@smalltalk('new')");
    expect(out).toContain('def new(cls): ...');
  });

  it('lists binary selectors as commented candidates rather than wrapping them', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({
        methods: [{ side: 'instance', category: 'comparing', selector: '=' }],
      }),
      wrapSelectors: [],
    });

    expect(out).toContain("#   @smalltalk('=')");
    expect(out).toContain('#   def __eq__(self, other): ...');
  });

  it('renames a wrapper whose name would collide with a slot', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({
        instVars: [{ name: 'deposit', hasGetter: false, hasSetter: false }],
      }),
      wrapSelectors: [{ side: 'instance', selector: 'deposit:' }],
    });

    expect(out).toContain('def deposit_(self, deposit): ...');
  });

  it('renames a wrapper whose name is a Python keyword', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [{ side: 'instance', selector: 'class' }],
    });

    expect(out).toContain('def class_(self): ...');
  });

  it('replaces a keyword part that is a Python keyword with a positional name', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection(),
      wrapSelectors: [{ side: 'instance', selector: 'if:then:' }],
    });

    expect(out).toContain('def if_then(self, arg1, then): ...');
  });

  it('indents the class body by four spaces', () => {
    const out = renderGrailStub({
      className: 'Account',
      dictionaryName: 'Finance',
      reflection: reflection({
        instVars: [{ name: 'balance', hasGetter: true, hasSetter: false }],
      }),
      wrapSelectors: [],
    });

    const lines = out.split('\n');
    expect(lines).toContain("    @smalltalk('balance')");
    expect(lines.some((l) => l === "@smalltalk('balance')")).toBe(false);
  });
});
