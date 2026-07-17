/**
 * Pure HTML rendering for the rename-method keyword-part editor. This is the
 * core R2 UX: one row per selector part, each pairing the editable keyword text
 * WITH the argument it binds, and reorderable as a unit (↑/↓). Renaming a part
 * and reordering arguments are therefore the same gesture — unlike Pharo's
 * Method-name editor, which splits a free-text selector box from a separate
 * arguments list (see R2-RenameMethod-Design.md).
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the webview
 * plumbing lives in renameMethodEditor.ts. The DOM behaviour (reorder, live
 * selector preview, OK/Cancel) lives in the sibling renameMethodEditorView.js,
 * read at runtime and injected under a nonce (Jasper's webview convention).
 */
import { selectorParts, isKeywordSelector } from './renameMethodPreview';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface MethodEditorHtmlOptions {
  className: string;
  oldSelector: string;
  isMeta: boolean;
  argNames: string[];
  /** When set, offer a "This dictionary (name)" scope option. */
  dictName?: string;
  nonce: string;
  script: string;
}

function renderRow(
  part: string, argName: string | undefined, originalArgIndex: number | undefined,
  reorderable: boolean,
): string {
  const orig = originalArgIndex === undefined ? '' : ` data-orig="${originalArgIndex}"`;
  const arg = argName
    ? `<span class="arg" title="argument bound by this keyword">${escapeHtml(argName)}</span>`
    : '<span class="arg none">(no argument)</span>';
  // Reorder buttons only make sense with two or more keyword parts to swap; a
  // unary, binary, or single-keyword selector has nothing to reorder.
  const reorder = reorderable
    ? `<span class="reorder">
      <button class="up" title="Move up" tabindex="-1">&#9650;</button>
      <button class="down" title="Move down" tabindex="-1">&#9660;</button>
    </span>`
    : '';
  return `<li class="kwrow"${orig}>
    ${reorder}
    <input class="part" value="${escapeHtml(part)}" spellcheck="false" aria-label="Selector part">
    <span class="arrow">&rarr;</span>
    ${arg}
  </li>`;
}

/** Build the editor's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderMethodEditorHtml(opts: MethodEditorHtmlOptions): string {
  const { className, oldSelector, isMeta, argNames, dictName, nonce, script } = opts;
  const parts = selectorParts(oldSelector);
  const keyword = isKeywordSelector(oldSelector);
  const reorderable = parts.length > 1;
  const rows = parts
    .map((p, i) => renderRow(p, argNames[i], i < argNames.length ? i + 1 : undefined, reorderable))
    .join('\n');
  const side = isMeta ? ' class' : '';
  const dictOption = dictName
    ? `<option value="dictionary">This dictionary (${escapeHtml(dictName)})</option>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Rename Method</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 0;
    }
    header {
      position: sticky; top: 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      padding: 12px 16px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .title code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 1px 5px; border-radius: 3px;
    }
    .actions { display: flex; gap: 8px; flex: none; }
    button {
      padding: 5px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .body { padding: 12px 16px 24px; }
    .hint { opacity: 0.8; margin: 0 0 12px; }
    ul.rows { list-style: none; margin: 0 0 14px; padding: 0; }
    li.kwrow {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; margin: 4px 0;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
      background: var(--vscode-sideBar-background, transparent);
    }
    li.kwrow input.part {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 3px 6px; min-width: 90px;
    }
    li.kwrow .arrow { opacity: 0.6; }
    li.kwrow .arg {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 0.9;
    }
    li.kwrow .arg.none { opacity: 0.5; font-style: italic; }
    li.kwrow .reorder { display: inline-flex; gap: 2px; flex: none; }
    li.kwrow button.up, li.kwrow button.down {
      background: none; color: var(--vscode-foreground);
      padding: 0 6px; opacity: 0.7; font-size: 0.9em;
    }
    li.kwrow button.up:hover, li.kwrow button.down:hover { background: none; opacity: 1; }
    .preview {
      margin: 6px 0 16px; padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08));
    }
    .preview code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 1.05em;
    }
    .scope { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, transparent);
      border-radius: 2px; padding: 3px 6px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .error { color: var(--vscode-errorForeground); min-height: 1.2em; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <div class="title">Rename <code>${escapeHtml(className)}${side}&gt;&gt;${escapeHtml(oldSelector)}</code></div>
    <div class="actions">
      <button id="ok">Preview…</button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  <div class="body">
    <p class="hint">${keyword
      ? 'Edit each keyword part in place. Use ▲/▼ to reorder — the argument moves with its keyword, so reordering rows reorders the arguments at every call site.'
      : 'Edit the selector name.'}</p>
    <ul class="rows">
${rows}
    </ul>
    <div class="preview">Selector: <code id="sel"></code></div>
    <div class="scope">
      <label for="scope">Scope:</label>
      <select id="scope">
        <option value="hierarchy" selected>Class &amp; hierarchy</option>
        <option value="class">This class only</option>
        ${dictOption}
        <option value="wholeSystem">Whole system</option>
      </select>
    </div>
    <div class="error" id="error"></div>
  </div>
  <script nonce="${nonce}" data-old-selector="${escapeHtml(oldSelector)}" data-dict-name="${escapeHtml(dictName ?? '')}">${script}</script>
</body>
</html>`;
}
