/**
 * Webview-side behavior for the rename-method keyword-part editor
 * (renameMethodEditor.ts).
 *
 * Like the other Jasper webview scripts, this is read at runtime via
 * fs.readFileSync and injected as a <script> tag — NOT bundled — so the reorder,
 * live-selector, and OK/Cancel logic can be unit-tested in jsdom (see
 * renameMethodEditor.test.ts) instead of living in an inline string.
 *
 * The host renders one <li.kwrow> per selector part: an editable .part input, the
 * argument it binds (labelled), and ▲/▼ reorder buttons. Rows carry data-orig =
 * the 1-based ORIGINAL argument index of the argument paired with that part (a
 * unary part has no arg and no data-orig). Reordering rows reorders (keyword,
 * argument) pairs together; on OK we report the parts in DOM order plus the
 * original indices in DOM order (the engine's permutation).
 *
 * Exposed as the global `RenameMethodEditor` so both the webview and tests can
 * reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const scriptEl = doc.querySelector('script[data-old-selector]');
    const oldSelector = scriptEl ? scriptEl.getAttribute('data-old-selector') : '';
    const dictName = scriptEl ? (scriptEl.getAttribute('data-dict-name') || '') : '';
    const okBtn = doc.getElementById('ok');
    const cancelBtn = doc.getElementById('cancel');
    const selEl = doc.getElementById('sel');
    const errEl = doc.getElementById('error');
    const scopeEl = doc.getElementById('scope');
    const list = doc.querySelector('ul.rows');
    const keyword = oldSelector.indexOf(':') !== -1;

    const rows = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.kwrow'));
    };
    const parts = function () {
      return rows().map(function (li) {
        const inp = li.querySelector('input.part');
        return inp ? inp.value : '';
      });
    };
    const originalIndices = function () {
      return rows()
        .filter(function (li) { return li.hasAttribute('data-orig'); })
        .map(function (li) { return parseInt(li.getAttribute('data-orig'), 10); });
    };

    // Live validation mirrors renameMethodPreview.validateNewParts closely enough
    // for immediate feedback; the extension re-validates authoritatively.
    const validate = function () {
      const p = parts();
      if (p.some(function (s) { return s.trim().length === 0; })) return 'Selector parts cannot be empty.';
      if (keyword && !p.every(function (s) { return /^[A-Za-z_][A-Za-z0-9_]*:$/.test(s); })) {
        return 'Each keyword part must be an identifier ending in a colon.';
      }
      return '';
    };

    const updatePreview = function () {
      if (selEl) selEl.textContent = parts().join('');
      const err = validate();
      if (errEl) errEl.textContent = err;
      if (okBtn) okBtn.disabled = err.length > 0;
    };

    const move = function (li, dir) {
      if (dir < 0) {
        const prev = li.previousElementSibling;
        if (prev) li.parentNode.insertBefore(li, prev);
      } else {
        const next = li.nextElementSibling;
        if (next) li.parentNode.insertBefore(next, li);
      }
      updatePreview();
    };

    rows().forEach(function (li) {
      const up = li.querySelector('button.up');
      const down = li.querySelector('button.down');
      const inp = li.querySelector('input.part');
      if (up) up.addEventListener('click', function () { move(li, -1); });
      if (down) down.addEventListener('click', function () { move(li, 1); });
      if (inp) inp.addEventListener('input', updatePreview);
    });

    if (okBtn) {
      okBtn.addEventListener('click', function () {
        if (validate().length > 0) return;
        const kind = scopeEl ? scopeEl.value : 'hierarchy';
        const scope = kind === 'dictionary' ? { kind: kind, dictName: dictName } : { kind: kind };
        vscode.postMessage({
          command: 'ok',
          parts: parts(),
          originalIndices: originalIndices(),
          scope: scope,
        });
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    // Suppress list-level bubbling weirdness; keep focus usable.
    if (list) list.addEventListener('submit', function (e) { e.preventDefault(); });

    updatePreview();
    return { parts: parts, originalIndices: originalIndices, updatePreview: updatePreview, move: move };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.RenameMethodEditor = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
