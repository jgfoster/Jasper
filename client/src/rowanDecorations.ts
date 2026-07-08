import * as vscode from 'vscode';

// Git-view-style row decorations for the Rowan tree. VS Code has no direct
// "colored badge" API for tree items; the mechanism the git view itself uses
// is a resourceUri plus a FileDecorationProvider that answers a letter badge
// and a theme color for that URI — the label picks up the color, the badge
// renders right-aligned. Rowan rows carry synthetic URIs under this scheme
// with the state in the query string.
export const ROWAN_URI_SCHEME = 'jasper-rowan';

export type RowanChangeState = 'M' | 'A' | 'D';

/** URI for a loaded-project row; `dirty` projects decorate like a modified file. */
export function loadedProjectUri(name: string, dirty: boolean): vscode.Uri {
  return vscode.Uri.from({
    scheme: ROWAN_URI_SCHEME,
    path: `/loaded/${name}`,
    query: dirty ? 'state=M' : '',
  });
}

/** URI for a change row: M(odified) / A(dded, image-only) / D(eleted, disk-only). */
export function changeUri(project: string, target: string, state: RowanChangeState): vscode.Uri {
  return vscode.Uri.from({
    scheme: ROWAN_URI_SCHEME,
    path: `/change/${project}/${target}`,
    query: `state=${state}`,
  });
}

// The exact colors the git view uses, so Rowan rows read identically.
const COLOR_FOR_STATE: Record<RowanChangeState, string> = {
  M: 'gitDecoration.modifiedResourceForeground',
  A: 'gitDecoration.addedResourceForeground',
  D: 'gitDecoration.deletedResourceForeground',
};
const TOOLTIP_FOR_STATE: Record<RowanChangeState, string> = {
  M: 'Modified',
  A: 'Only in the image',
  D: 'Only on disk',
};

export class RowanDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== ROWAN_URI_SCHEME) return undefined;
    const state = /(?:^|&)state=([MAD])(?:&|$)/.exec(uri.query)?.[1] as
      | RowanChangeState
      | undefined;
    if (!state) return undefined;
    return {
      badge: state,
      color: new vscode.ThemeColor(COLOR_FOR_STATE[state]),
      tooltip: TOOLTIP_FOR_STATE[state],
      propagate: false,
    };
  }
}
