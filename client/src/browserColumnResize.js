/**
 * Drag-to-resize splitters for the System Browser's miller columns.
 *
 * Like listFilter.js / methodListView.js, this is read at runtime via
 * fs.readFileSync and injected into the webview as a <script> tag — it is NOT
 * compiled into the bundle. It lives in its own file so the resize geometry and
 * handle wiring can be unit-tested in jsdom (see browserColumnResize.test.ts).
 *
 * The columns are flex children of `.columns`. A thin handle is added to the
 * right edge of every column except the last. Dragging a handle moves the
 * boundary between its column and the next *visible* column: at drag start both
 * are pinned to their current pixel widths (flex: 0 0 Npx), then the delta is
 * added to the left and subtracted from the right, so the pair's combined width
 * is preserved and the other columns keep their existing flex. Exposed as the
 * global `BrowserColumnResize`.
 */
(function () {
  // The next sibling .column that is not hidden, or null. Used at drag time so a
  // hidden column (e.g. Hierarchy in category mode) is skipped and the handle
  // resizes against whichever column is actually shown to its right.
  function nextVisibleColumn(column) {
    let el = column.nextElementSibling;
    while (el) {
      if (el.classList.contains('column') && !el.classList.contains('hidden')) return el;
      el = el.nextElementSibling;
    }
    return null;
  }

  // Given the pair's start widths and how far the boundary was dragged (px, +ve
  // to the right), return their new widths — clamped so neither drops below
  // minWidth. The pair's combined width is preserved.
  function clampResize(startA, startB, delta, minWidth) {
    const total = startA + startB;
    let a = startA + delta;
    if (a < minWidth) a = minWidth;
    if (a > total - minWidth) a = total - minWidth;
    return { a: a, b: total - a };
  }

  // Pin two adjacent columns to explicit widths so only they resize; the rest
  // keep their flex. flex-basis in px, no grow/shrink.
  function applyPairWidths(colA, colB, wA, wB) {
    colA.style.flex = '0 0 ' + wA + 'px';
    colB.style.flex = '0 0 ' + wB + 'px';
  }

  // Add a right-edge resize handle to every column except the last (the last
  // column has no neighbour to resize against). Idempotent.
  function addHandles(container, doc) {
    const columns = [].slice.call(container.querySelectorAll(':scope > .column'));
    for (let i = 0; i < columns.length - 1; i++) {
      const col = columns[i];
      if (col.querySelector(':scope > .column-resizer')) continue;
      const handle = doc.createElement('div');
      handle.className = 'column-resizer';
      col.appendChild(handle);
    }
  }

  // Wire up drag-to-resize on `options.container` (the `.columns` element).
  function setupColumnResize(options) {
    const container = options.container;
    if (!container) return;
    const doc = options.document || document;
    const minWidth = options.minWidth || 60;
    addHandles(container, doc);

    let drag = null;
    container.addEventListener('mousedown', function (e) {
      const handle = e.target.closest ? e.target.closest('.column-resizer') : null;
      if (!handle) return;
      const colA = handle.closest('.column');
      const colB = nextVisibleColumn(colA);
      if (!colB) return;
      e.preventDefault();
      handle.classList.add('active');
      drag = {
        handle: handle, colA: colA, colB: colB,
        startX: e.clientX,
        startA: colA.getBoundingClientRect().width,
        startB: colB.getBoundingClientRect().width,
      };
    });
    doc.addEventListener('mousemove', function (e) {
      if (!drag) return;
      const w = clampResize(drag.startA, drag.startB, e.clientX - drag.startX, minWidth);
      applyPairWidths(drag.colA, drag.colB, w.a, w.b);
    });
    doc.addEventListener('mouseup', function () {
      if (!drag) return;
      drag.handle.classList.remove('active');
      drag = null;
    });
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.BrowserColumnResize = {
    nextVisibleColumn: nextVisibleColumn,
    clampResize: clampResize,
    applyPairWidths: applyPairWidths,
    addHandles: addHandles,
    setupColumnResize: setupColumnResize,
  };
})();
