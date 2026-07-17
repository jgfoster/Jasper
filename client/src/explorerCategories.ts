// Pure category-tree helpers for the GemStone Explorer's Class Categories pane.
// GemStone class-categories are flat strings that conventionally use '-' to
// separate levels (e.g. 'Kernel-Numbers'); these build the trie the pane
// renders and the prefix rule that makes a "super" category show everything
// beneath it. Kept free of vscode so they can be unit-tested directly.

export interface CategoryNode {
  segment: string;
  fullPath: string;
  hasChildren: boolean;
}

// Direct child category-nodes under `parentPath` (undefined = top level), built
// from the '-' segments of every category path in `allPaths`. Siblings are
// de-duplicated and sorted by segment.
export function categoryChildNodes(allPaths: string[], parentPath?: string): CategoryNode[] {
  const depth = parentPath ? parentPath.split('-').length : 0;
  const prefix = parentPath ? `${parentPath}-` : '';
  const nodes = new Map<string, CategoryNode>();
  for (const cat of allPaths) {
    if (parentPath && !cat.startsWith(prefix)) continue;
    const parts = cat.split('-');
    if (parts.length <= depth) continue;
    const fullPath = parts.slice(0, depth + 1).join('-');
    const node = nodes.get(fullPath);
    const childDeeper = parts.length > depth + 1;
    if (node) {
      node.hasChildren = node.hasChildren || childDeeper;
    } else nodes.set(fullPath, { segment: parts[depth], fullPath, hasChildren: childDeeper });
  }
  return [...nodes.values()].sort((a, b) => a.segment.localeCompare(b.segment));
}

// The parent node's segment + fullPath for a category path (for TreeView
// reveal / getParent), or undefined when `fullPath` is a top-level segment.
export function categoryParentPath(
  fullPath: string,
): { segment: string; fullPath: string } | undefined {
  const parts = fullPath.split('-');
  if (parts.length <= 1) return undefined;
  return { segment: parts[parts.length - 2], fullPath: parts.slice(0, -1).join('-') };
}

// Whether a class whose category is `entryCategory` belongs under the selected
// category `selected` (undefined = no selection = everything): the category
// itself, or any sub-category beneath it.
export function categoryMatches(entryCategory: string, selected?: string): boolean {
  return (
    selected === undefined || entryCategory === selected || entryCategory.startsWith(`${selected}-`)
  );
}
