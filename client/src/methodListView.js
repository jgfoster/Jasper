/**
 * Method-list rendering helpers for the System Browser webview.
 *
 * Like listFilter.js, this is read at runtime via fs.readFileSync and injected
 * into the webview as a <script> tag — it is NOT compiled into the bundle. It
 * lives in its own file so the override-indicator rendering and click dispatch
 * can be unit-tested in jsdom (see methodListView.test.ts) instead of being
 * trapped inside the inline webview <script> string.
 *
 * The override bitmask carried per selector: bit 1 = overrides a superclass
 * implementation (▲), bit 2 = overridden in a subclass (▼), 3 = both.
 *
 * The session-method flag carried per selector: 1 = session extension (adds
 * new behavior — glyph +), 2 = session override (shadows a persistent base
 * method — glyph ±). Session rows are also italicised via a row CSS class.
 *
 * Exposed as the global `MethodListView` so both the webview (classic <script>)
 * and tests (new Function(source)()) can reach it.
 */
(function () {
  // Build a clickable override-indicator arrow for one direction. The triangle
  // lives in an inner .indicator-glyph so its reduced font-size shrinks only the
  // glyph, not the arrow's slot width (an em width on the arrow itself would be
  // scaled down by the smaller font, narrowing the slot — see the CSS note).
  function makeOverrideArrow(selector, dir) {
    const span = document.createElement('span');
    span.className = 'override-arrow ' + dir;
    span.dataset.value = selector;
    span.dataset.dir = dir;
    const glyph = document.createElement('span');
    glyph.className = 'indicator-glyph';
    glyph.textContent = dir === 'up' ? '▲' : '▼';
    span.appendChild(glyph);
    span.title = dir === 'up'
      ? 'Overrides a superclass implementation — click to view'
      : 'Overridden in a subclass — click to view';
    return span;
  }

  // Build the leading session-method glyph. Not clickable — purely a marker;
  // its title carries the explanation. sessionBit 2 = override, else extension.
  function makeSessionIndicator(selector, sessionBit) {
    const span = document.createElement('span');
    const isOverride = sessionBit === 2;
    span.className = 'session-indicator ' + (isOverride ? 'override' : 'extension');
    span.dataset.value = selector;
    span.textContent = isOverride ? '±' : '+';
    span.title = isOverride
      ? 'Click the ± icon to compare this session override with its base method (click again to return to the session source)'
      : 'Session method - adds new behavior (extension)';
    return span;
  }

  // An empty placeholder occupying one indicator slot, so a present marker keeps
  // its column position even when the markers to its left are absent. `kind`
  // ('arrow' | 'session') selects the slot's width to match the marker it
  // stands in for, so present and missing markers take identical space.
  function makeIndicatorSlot(kind) {
    const span = document.createElement('span');
    span.className = 'indicator-slot ' + kind;
    return span;
  }

  // Render a fixed-width leading gutter, then the selector text. The gutter has
  // three fixed slots in a stable order — up arrow, down arrow, session glyph —
  // each holding its marker, or an empty slot of the same width when the method
  // lacks that marker. This keeps every marker in the same column position (and
  // every method name aligned) regardless of which markers a row has. The gutter
  // is the item's single leading child; ListFilter preserves it when it
  // re-renders the selector text for filtering/highlighting. A session row is
  // also tagged with a session-* class (italic) and a title so the whole row
  // explains itself on hover.
  function applyMethodIndicators(div, selector, methodOverrideBit, sessionBit) {
    div.textContent = '';
    const gutter = document.createElement('span');
    gutter.className = 'method-gutter';
    gutter.appendChild((methodOverrideBit & 1) ? makeOverrideArrow(selector, 'up') : makeIndicatorSlot('arrow'));
    gutter.appendChild((methodOverrideBit & 2) ? makeOverrideArrow(selector, 'down') : makeIndicatorSlot('arrow'));
    if (sessionBit) {
      div.classList.add(sessionBit === 2 ? 'session-override' : 'session-extension');
      // Row tooltip is descriptive only — the click-to-compare hint lives on the
      // ± glyph itself, so hovering the method name doesn't imply clicking it.
      div.title = sessionBit === 2
        ? 'Session method that overrides a persistent base method'
        : 'Session method that adds new behavior (extension)';
      gutter.appendChild(makeSessionIndicator(selector, sessionBit));
    } else {
      gutter.appendChild(makeIndicatorSlot('session'));
    }
    div.appendChild(gutter);
    div.appendChild(document.createTextNode(selector));
  }

  // Back-compat shim: override arrows only (no session glyph).
  function applyOverrideArrows(div, selector, methodOverrideBit) {
    applyMethodIndicators(div, selector, methodOverrideBit, 0);
  }

  // Decide what a click in the methods column means and update selection.
  // Returns the message the webview should post, or null if the click hit
  // neither an arrow nor an item. Clicking an override arrow shows the
  // hierarchy implementations; clicking elsewhere on a row selects the method.
  function methodListClickMessage(event, listEl) {
    const arrow = event.target.closest('.override-arrow');
    if (arrow) {
      return {
        command: 'showHierarchyImpls',
        selector: arrow.dataset.value,
        direction: arrow.dataset.dir,
      };
    }
    // Clicking the override glyph (±) compares the session override against the
    // base method it shadows. The row is also selected so it reads as current.
    const sessionOverride = event.target.closest('.session-indicator.override');
    if (sessionOverride) {
      const row = event.target.closest('.item');
      const prevSel = listEl.querySelector('.item.selected');
      if (prevSel) prevSel.classList.remove('selected');
      if (row) row.classList.add('selected');
      return { command: 'compareSessionOverride', selector: sessionOverride.dataset.value };
    }
    const item = event.target.closest('.item');
    if (!item) return null;
    const prev = listEl.querySelector('.item.selected');
    if (prev) prev.classList.remove('selected');
    item.classList.add('selected');
    return { command: 'selectMethod', selector: item.dataset.value };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.MethodListView = {
    makeOverrideArrow, makeSessionIndicator,
    applyOverrideArrows, applyMethodIndicators, methodListClickMessage,
  };
})();
