// Pure rendering for the "Generate Grail .py Stub" feature: turn the reflection
// of a Smalltalk class into an editable Grail `.py` file. No vscode/fs imports,
// so the whole thing is unit-testable in isolation.
//
// Grail background (see Grail's grail.gs):
//   - @smalltalk_class(dictionary=…, class_name=…) attaches the Python methods
//     below onto the EXISTING Smalltalk class when the module loads. __slots__
//     must equal the class's own instVarNames, same names AND order.
//   - `self.x` / `self.x = v` on such a class dispatch to the Smalltalk x / x:
//     accessors — but only when those accessors exist. There is no property
//     synthesis, and a property can't be named after a slot anyway, so the
//     generated accessors are @smalltalk forwarders under get_/set_ names.
//   - @smalltalk('sel') turns an ellipsis-body method into a forwarder to the
//     native selector; @classmethod @smalltalk targets the class side.

import { GrailStubReflection } from './queries/grailStubReflection';

export type SelectorKind = 'unary' | 'binary' | 'keyword';

// Python 3 reserved words (plus the soft keywords match/case) — a wrapper whose
// derived name collides with one of these gets a trailing underscore.
const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
]);

// Common Smalltalk binary selectors mapped to the Python dunder they'd most
// naturally become. Binary selectors are never auto-wrapped (they need a chosen
// Python name); these drive the "candidates" comment block instead.
const BINARY_DUNDERS: Record<string, string> = {
  '+': '__add__', '-': '__sub__', '*': '__mul__', '/': '__truediv__',
  '//': '__floordiv__', '\\\\': '__mod__', '=': '__eq__', '==': '__eq__',
  '~=': '__ne__', '<': '__lt__', '<=': '__le__', '>': '__gt__', '>=': '__ge__',
  ',': '__add__', '@': '__matmul__',
};

export function selectorKind(selector: string): SelectorKind {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(selector)) return 'unary';
  if (/^([A-Za-z_][A-Za-z0-9_]*:)+$/.test(selector)) return 'keyword';
  return 'binary';
}

export function selectorArity(selector: string): number {
  switch (selectorKind(selector)) {
    case 'unary': return 0;
    case 'binary': return 1;
    case 'keyword': return (selector.match(/:/g) || []).length;
  }
}

// The base Python method name for a wrapper (before uniquifying). Unary
// selectors are already valid identifiers; keyword selectors join their parts
// with underscores (at:put: -> at_put). Binary selectors have no clean name, so
// callers should not wrap them — a stable fallback is returned just in case.
export function selectorToPyName(selector: string): string {
  switch (selectorKind(selector)) {
    case 'unary': return selector;
    case 'keyword': return selector.split(':').filter(s => s.length > 0).join('_');
    case 'binary': return BINARY_DUNDERS[selector] ?? 'op';
  }
}

// Argument names for a keyword wrapper, derived from the keyword parts
// (at:put: -> ['at','put']); parts colliding with a Python keyword or each
// other are replaced/suffixed so the signature is always valid.
function keywordArgNames(selector: string, reserved: Iterable<string> = []): string[] {
  const parts = selector.split(':').filter(s => s.length > 0);
  const used = new Set<string>(reserved);
  return parts.map((part, i) => {
    let name = PY_KEYWORDS.has(part) ? `arg${i + 1}` : part;
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    return name;
  });
}

function pyStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Force an arbitrary string into a valid Python identifier for the class name.
// Smalltalk class names are already valid identifiers; this is just a guard.
function sanitizeClassName(name: string): string {
  let n = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
  return n || '_';
}

// Claim a unique, non-keyword name, appending underscores on collision.
function uniquify(base: string, used: Set<string>): string {
  let name = PY_KEYWORDS.has(base) ? `${base}_` : base;
  while (used.has(name)) name = `${name}_`;
  used.add(name);
  return name;
}

function renderDocstring(comment: string): string[] {
  const trimmed = comment.trim();
  if (!trimmed) return [];
  const safe = trimmed.replace(/"""/g, '\\"\\"\\"');
  const lines = safe.split('\n');
  if (lines.length === 1) return [`"""${lines[0]}"""`];
  return ['"""', ...lines, '"""'];
}

function renderSlots(names: string[]): string {
  if (names.length === 0) return '__slots__ = ()';
  if (names.length === 1) return `__slots__ = ('${pyStr(names[0])}',)`;
  return `__slots__ = (${names.map(n => `'${pyStr(n)}'`).join(', ')})`;
}

export interface WrapSelector {
  side: 'instance' | 'class';
  selector: string;
}

export interface RenderStubOptions {
  className: string;
  dictionaryName: string;
  reflection: GrailStubReflection;
  wrapSelectors: WrapSelector[];
}

export function renderGrailStub(opts: RenderStubOptions): string {
  const { className, dictionaryName, reflection, wrapSelectors } = opts;

  const header = [
    `# Grail stub generated from Smalltalk class  ${dictionaryName} :: ${className}`
      + (reflection.superclass ? `   (superclass: ${reflection.superclass})` : ''),
    '# Loading this module installs the Python methods below onto the existing',
    "# Smalltalk class. __slots__ lists the class's OWN instance variables, in",
    '# order, and must match the class exactly or the load fails.',
    'from grail import smalltalk, smalltalk_class',
    '',
    '',
    `@smalltalk_class(dictionary='${pyStr(dictionaryName)}', class_name='${pyStr(className)}')`,
    `class ${sanitizeClassName(className)}:`,
  ];

  const body: string[] = [];
  const pushBlank = () => { if (body.length) body.push(''); };

  const doc = renderDocstring(reflection.comment);
  if (doc.length) body.push(...doc);

  pushBlank();
  body.push(renderSlots(reflection.instVars.map(v => v.name)));

  // Names already claimed: the slots occupy the attribute namespace, so an
  // accessor/wrapper can never reuse a slot name.
  const used = new Set<string>(reflection.instVars.map(v => v.name));

  // Accessors — one block per instVar.
  const accessorBlocks: string[][] = [];
  for (const iv of reflection.instVars) {
    const block: string[] = [];
    if (iv.hasGetter) {
      block.push(`@smalltalk('${pyStr(iv.name)}')`);
      block.push(`def ${uniquify(`get_${iv.name}`, used)}(self): ...`);
    }
    if (iv.hasSetter) {
      block.push(`@smalltalk('${pyStr(iv.name)}:')`);
      block.push(`def ${uniquify(`set_${iv.name}`, used)}(self, value): ...`);
    }
    if (!iv.hasGetter && !iv.hasSetter) {
      block.push(`# '${iv.name}': no Smalltalk accessor/mutator — `
        + `self.${iv.name} won't work until you add one.`);
    }
    accessorBlocks.push(block);
  }
  if (accessorBlocks.length) {
    pushBlank();
    body.push('# Instance-variable accessors. self.<ivar> already reads/writes through');
    body.push('# the Smalltalk accessor when one exists; these wrappers make it explicit.');
    accessorBlocks.forEach((block) => {
      body.push('');
      body.push(...block);
    });
  }

  // Method wrappers — one block per picked selector.
  if (wrapSelectors.length) {
    pushBlank();
    body.push('# Method wrappers — edit the bodies freely (the ellipsis forwards to Smalltalk).');
    for (const w of wrapSelectors) {
      const receiver = w.side === 'class' ? 'cls' : 'self';
      const args = selectorKind(w.selector) === 'keyword' ? keywordArgNames(w.selector, [receiver]) : [];
      const name = uniquify(selectorToPyName(w.selector), used);
      body.push('');
      if (w.side === 'class') body.push('@classmethod');
      body.push(`@smalltalk('${pyStr(w.selector)}')`);
      body.push(`def ${name}(${[receiver, ...args].join(', ')}): ...`);
    }
  }

  // Binary selectors: listed as commented candidates rather than wrapped, since
  // each needs a hand-chosen Python name.
  const binaries = Array.from(
    new Set(reflection.methods.filter(m => selectorKind(m.selector) === 'binary').map(m => m.selector)),
  );
  if (binaries.length) {
    pushBlank();
    body.push('# Binary selectors are not wrapped automatically (each needs a Python name).');
    body.push('# Candidates — uncomment and rename as you like:');
    for (const sel of binaries) {
      body.push(`#   @smalltalk('${pyStr(sel)}')`);
      body.push(`#   def ${selectorToPyName(sel)}(self, other): ...`);
    }
  }

  const indented = body.map(line => (line.length ? `    ${line}` : line));
  return [...header, ...indented, ''].join('\n');
}
