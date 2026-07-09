// Filter matching for the GemStone Explorer pane Filter boxes: anchored at the
// start (prefix match, the common case for selectors/names) with '*' as a
// wildcard for any run of characters. Case-insensitive. An empty pattern
// matches everything. Kept vscode-free so it can be unit-tested directly.
export function filterMatches(name: string, pattern: string | undefined): boolean {
  if (!pattern) return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex specials (but not '*')
    .replace(/\*/g, '.*');
  try {
    return new RegExp('^' + escaped, 'i').test(name);
  } catch {
    return true;
  }
}
