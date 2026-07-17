/**
 * Webview-side behaviour for the rename-class editor (renameClassEditor.ts).
 *
 * Read at runtime and injected as a <script> tag (NOT bundled) so the live
 * validation, OK/Cancel, and host round-trip logic can be unit-tested in jsdom
 * (see renameClassEditor.test.ts).
 *
 * Live validation only checks the NAME FORMAT (a capitalised-ish identifier that
 * differs from the old name); the host re-checks authoritatively AND checks that
 * the name isn't already in use, posting back `{command:'invalid', message}` so
 * the user can pick another name without the editor closing.
 *
 * Exposed as the global `RenameClassEditor` so the webview and tests reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const scriptEl = doc.querySelector('script[data-old-name]');
    const oldName = scriptEl ? scriptEl.getAttribute('data-old-name') : '';
    const dictName = scriptEl ? (scriptEl.getAttribute('data-dict-name') || '') : '';
    const okBtn = doc.getElementById('ok');
    const cancelBtn = doc.getElementById('cancel');
    const nameEl = doc.getElementById('name');
    const errEl = doc.getElementById('error');
    const scopeEl = doc.getElementById('scope');

    const value = function () { return nameEl ? nameEl.value.trim() : ''; };

    const formatError = function () {
      const v = value();
      if (v.length === 0) return 'Enter a new class name.';
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) {
        return 'A class name must be a letter followed by letters, digits, or underscores.';
      }
      if (v === oldName) return 'Enter a different name.';
      return '';
    };

    const showError = function (msg) {
      if (errEl) errEl.textContent = msg || '';
    };

    const refresh = function () {
      const err = formatError();
      showError(err);
      if (okBtn) okBtn.disabled = err.length > 0;
    };

    const scope = function () {
      const kind = scopeEl ? scopeEl.value : 'wholeSystem';
      return kind === 'dictionary' ? { kind: kind, dictName: dictName } : { kind: kind };
    };

    const checked = function (id) {
      const el = doc.getElementById(id);
      return !!(el && el.checked);
    };
    const options = function () {
      return {
        copyMethods: checked('optCopyMethods'),
        recompileSubclasses: checked('optRecompileSubclasses'),
        migrateInstances: checked('optMigrateInstances'),
        removeOldFromHistory: checked('optRemoveOldFromHistory'),
      };
    };
    // Removing old versions while NOT migrating leaves existing instances pointing at
    // a version no longer in the class history — warn.
    const refreshOptWarn = function () {
      const warn = doc.getElementById('optWarn');
      if (!warn) return;
      warn.textContent = (checked('optRemoveOldFromHistory') && !checked('optMigrateInstances'))
        ? '⚠ Removing old versions without migrating will orphan existing instances.'
        : '';
    };
    ['optMigrateInstances', 'optRemoveOldFromHistory'].forEach(function (id) {
      const el = doc.getElementById(id);
      if (el) el.addEventListener('change', refreshOptWarn);
    });

    const submit = function () {
      if (formatError().length > 0) return;
      if (okBtn) okBtn.disabled = true; // await the host's authoritative check
      vscode.postMessage({ command: 'ok', newName: value(), scope: scope(), options: options() });
    };

    if (nameEl) {
      nameEl.addEventListener('input', refresh);
      nameEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }
    if (okBtn) okBtn.addEventListener('click', submit);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    // Host → webview: the name was rejected (e.g. already in use). Show it and
    // re-enable OK so the user can enter a different name.
    const handleMessage = function (msg) {
      if (!msg) return;
      if (msg.command === 'invalid') {
        showError(typeof msg.message === 'string' ? msg.message : 'That name cannot be used.');
        if (okBtn) okBtn.disabled = formatError().length > 0;
      }
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) { handleMessage(e.data); });
    }

    refresh();
    refreshOptWarn();
    if (nameEl && nameEl.focus) {
      try { nameEl.focus(); nameEl.select(); } catch (e) { /* jsdom */ }
    }
    return {
      formatError: formatError, submit: submit, refresh: refresh, handleMessage: handleMessage,
      options: options, refreshOptWarn: refreshOptWarn,
    };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.RenameClassEditor = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
