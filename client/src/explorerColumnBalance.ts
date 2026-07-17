// Chooses the editor column for the next GemStone Explorer "open to the side"
// so opened editors spread across a few groups instead of clumping into one.
//
// `gemColumns` maps each editor view-column that already holds gemstone
// editors to its tab count. While fewer than `maxColumns` such columns exist,
// a fresh column is requested ('new'); once the cap is reached, the existing
// gemstone column with the fewest tabs is reused (leftmost wins ties). Pure, so
// the balancing rule can be unit-tested without the vscode window API.
export function pickBalancedColumn(
  gemColumns: Map<number, number>,
  maxColumns = 3,
): number | 'new' {
  if (gemColumns.size < maxColumns) return 'new';
  let best = -1;
  let bestCount = Infinity;
  for (const [column, count] of [...gemColumns].sort((a, b) => a[0] - b[0])) {
    if (count < bestCount) {
      best = column;
      bestCount = count;
    }
  }
  return best;
}
