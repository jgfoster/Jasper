/**
 * Webview-side behaviour for the class-definition history viewer
 * (classHistoryPanel.ts). Read at runtime and injected as a <script> tag (NOT
 * bundled) so it can be unit-tested in jsdom (see classHistoryPanel.test.ts).
 *
 * Each version row expands to show its definition and changed-method list; a
 * "Restore this version" button on a non-current version posts a `restore`
 * message (the host confirms and performs the redo, then posts `refresh` with a
 * freshly-rendered list). Exposed as the global `ClassHistoryPanel` so the webview
 * and tests reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const list = doc.querySelector('ul.versions');

    const toggle = function (li) {
      const detail = li.querySelector('.detail');
      const btn = li.querySelector('.toggle');
      if (!detail) return;
      const hidden = detail.classList.toggle('hidden');
      if (btn) {
        btn.textContent = hidden ? '▸' : '▾';
        btn.setAttribute('aria-expanded', String(!hidden));
      }
    };

    const wireRows = function () {
      Array.prototype.slice.call(doc.querySelectorAll('li.version')).forEach(function (li) {
        if (li.getAttribute('data-wired') === '1') return;
        li.setAttribute('data-wired', '1');
        const head = li.querySelector('.version-head');
        if (head) {
          head.addEventListener('click', function (event) {
            if (
              event.target &&
              event.target.classList &&
              (event.target.classList.contains('restore') ||
                event.target.classList.contains('remove'))
            )
              return;
            toggle(li);
          });
        }
        const indexOf = function () {
          return parseInt(li.getAttribute('data-index') || '0', 10);
        };
        const restoreBtn = li.querySelector('.restore');
        if (restoreBtn) {
          restoreBtn.addEventListener('click', function () {
            const index = indexOf();
            if (index > 0) vscode.postMessage({ command: 'restore', index: index });
          });
        }
        const removeBtn = li.querySelector('.remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', function () {
            const index = indexOf();
            if (index > 0) vscode.postMessage({ command: 'remove', index: index });
          });
        }
      });
    };

    const handleMessage = function (msg) {
      if (!msg) return;
      if (msg.command === 'refresh' && list && typeof msg.html === 'string') {
        list.innerHTML = msg.html;
        wireRows();
      }
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) {
        handleMessage(e.data);
      });
    }

    wireRows();
    return { wireRows: wireRows, handleMessage: handleMessage };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.ClassHistoryPanel = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
