/**
 * Pure decision helpers for the GemStone Explorer's class/variable tree and its
 * default-dictionary selection. Kept free of any `vscode` dependency so the tree
 * shape and selection rules unit-test directly; the controller/providers wire
 * them to TreeItems and TreeView.reveal.
 */

/** One variable-side grouping under a class row: the "instance" side (isMeta
 *  false) holding instance-variable names, or the "class" side (isMeta true)
 *  holding class-variable names. */
export interface VariableSide {
  isMeta: boolean;
  names: string[];
}

/**
 * The variable-side nodes to show under a class row, mirroring the Methods pane's
 * instance/class split: an "instance" side when the class defines instance
 * variables, then a "class" side when it defines class variables. A side with no
 * variables is omitted (so a class with only instance variables shows just the
 * "instance" side, and a class with neither shows nothing).
 */
export function variableSides(ivarNames: string[], classVarNames: string[]): VariableSide[] {
  const sides: VariableSide[] = [];
  if (ivarNames.length > 0) sides.push({ isMeta: false, names: ivarNames });
  if (classVarNames.length > 0) sides.push({ isMeta: true, names: classVarNames });
  return sides;
}

/**
 * The index (into `names`) of the dictionary to auto-select when a session
 * connects: UserGlobals when present (the usual starting point), otherwise the
 * first dictionary. Returns -1 when there are no dictionaries (nothing to select).
 */
export function defaultDictionaryIndex(names: string[]): number {
  if (names.length === 0) return -1;
  const userGlobals = names.indexOf('UserGlobals');
  return userGlobals >= 0 ? userGlobals : 0;
}
