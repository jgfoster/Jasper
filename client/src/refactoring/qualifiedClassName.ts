/**
 * Naming the dictionary a class lives in, in text the user reads.
 *
 * Kept free of `vscode` and of any query, so the pure preview and panel-HTML modules can use it:
 * they are tested without an extension host. The session-dependent half -- resolving a dictionary
 * REFERENCE to its name -- lives in `dictionaryLabel.ts`, which re-exports these.
 */

/**
 * `Shadowed (DictionaryB)` when the dictionary is known, plain `Shadowed` when it is not.
 *
 * Used for undo labels and panel headings, so the two halves of a refactoring -- doing it and
 * undoing it -- name the same class the same way.
 */
export function qualifiedClassName(className: string, dictName: string | undefined): string {
  return dictName ? `${className} (${dictName})` : className;
}

/**
 * The class names in a change set that more than one dictionary claims.
 *
 * A preview row names the class it will change. When two rows name the same class and mean two
 * DIFFERENT classes -- legal, and the shape issue 396 is about -- the user is asked to approve a
 * list they cannot read: `Shadowed (definition edited)` twice over, one of them somebody else's
 * class. Rows for these names get their dictionary; the rest stay short, because qualifying every
 * row would bury the distinction it exists to draw.
 *
 * A change with no dictionary counts as its own claim: "somewhere unstated" is not the same place
 * as a named dictionary, and a row that cannot say where it lands is exactly one worth marking.
 */
export function ambiguousClassNames(
  changes: readonly { className: string; dictName: string | null }[],
): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const c of changes) {
    const where = seen.get(c.className) ?? new Set<string>();
    where.add(c.dictName ?? '');
    seen.set(c.className, where);
  }
  const ambiguous = new Set<string>();
  for (const [name, where] of seen) if (where.size > 1) ambiguous.add(name);
  return ambiguous;
}

/** `qualifiedClassName` when the name is one of `ambiguous`, the bare name otherwise. */
export function classNameForRow(
  className: string,
  dictName: string | null | undefined,
  ambiguous: ReadonlySet<string> | undefined,
): string {
  return ambiguous?.has(className)
    ? qualifiedClassName(className, dictName ?? undefined)
    : className;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A preview row's class name as HTML: {@link classNameForRow}'s text, in a span that carries the
 * class and its dictionary so the panel can qualify it later.
 *
 * `ambiguous` only covers the page being rendered, and pages arrive one at a time, so a clash
 * between a row on page 1 and one on page 2 is first visible in the webview, after page 2 is
 * appended. `rowQualifierView.js` reads these spans across the whole list and rewrites them.
 */
export function classNameSpan(
  className: string,
  dictName: string | null | undefined,
  ambiguous: ReadonlySet<string> | undefined,
): string {
  const dict = dictName ? ` data-dict="${escapeAttr(dictName)}"` : '';
  return (
    `<span class="cls" data-class="${escapeAttr(className)}"${dict}>` +
    `${escapeAttr(classNameForRow(className, dictName, ambiguous))}</span>`
  );
}
