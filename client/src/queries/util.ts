export function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

export function receiver(className: string, isMeta: boolean): string {
  return isMeta ? `${className} class` : className;
}

export function splitLines(result: string): string[] {
  return result.split('\n').filter(s => s.length > 0);
}

export function compiledMethodExpr(
  className: string, isMeta: boolean, selector: string, environmentId: number,
): string {
  return `(${receiver(className, isMeta)} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId})`;
}

// Compose a Smalltalk expression that resolves a class by name, optionally
// scoped to a specific dictionary (by 1-based index or by name). Evaluates to
// the class OOP, or nil if not found. Callers should `ifNil:` to handle the
// missing case.
//
// Why "optionally scoped": a user's symbolList is an ordered list of
// SymbolDictionaries; `objectNamed:` returns the first match and shadows
// later entries with the same name. When a caller knows which dictionary it
// wants (e.g. Jasper's class browser walking a tree), dict-scoped lookup
// hits the specific class even when shadowed.
export function classLookupExpr(className: string, dict?: number | string): string {
  const esc = escapeString(className);
  if (dict === undefined) {
    return `System myUserProfile symbolList objectNamed: #'${esc}'`;
  }
  if (typeof dict === 'number') {
    return `(System myUserProfile symbolList at: ${dict}) at: #'${esc}' ifAbsent: [nil]`;
  }
  return `(System myUserProfile symbolList objectNamed: #'${escapeString(dict)}') ifNotNil: [:d | d at: #'${esc}' ifAbsent: [nil]]`;
}

// Smalltalk statements that bind `cls` to the dictionary-scoped class and raise
// a clear "not found" error if it's absent — the resolve-or-raise preamble
// shared by the SUnit run/discover queries. The caller must declare `cls` in
// its temps and use it afterward; the `^Error signal:` short-circuits the doit
// when the class can't be resolved (so the tool surfaces a clean error rather
// than sending messages to nil).
export function classLookupOrRaiseExpr(className: string, dictName?: string): string {
  const esc = escapeString(className);
  const where = dictName ? ` in dictionary ${escapeString(dictName)}` : '';
  return `cls := ${classLookupExpr(className, dictName)}.
cls isNil ifTrue: [^Error signal: 'Test class ${esc}${where} not found'].`;
}
