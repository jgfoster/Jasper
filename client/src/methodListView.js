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
  // Build a clickable override-indicator arrow for one direction.
  function makeOverrideArrow(selector, dir) {
    const span = document.createElement('span');
    span.className = 'override-arrow ' + dir;
    span.dataset.value = selector;
    span.dataset.dir = dir;
    span.textContent = dir === 'up' ? '▲' : '▼';
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

  // Render leading indicator(s) then the selector text: override arrows first,
  // then the session glyph, then the text. They are kept as the item's leading
  // children; ListFilter preserves them when it re-renders the selector text
  // for filtering/highlighting. A session row is also tagged with a session-*
  // class (italic) and a title so the whole row explains itself on hover.
  function applyMethodIndicators(div, selector, methodOverrideBit, sessionBit) {
    div.textContent = '';
    if (methodOverrideBit & 1) div.appendChild(makeOverrideArrow(selector, 'up'));
    if (methodOverrideBit & 2) div.appendChild(makeOverrideArrow(selector, 'down'));
    if (sessionBit) {
      div.classList.add(sessionBit === 2 ? 'session-override' : 'session-extension');
      // Row tooltip is descriptive only — the click-to-compare hint lives on the
      // ± glyph itself, so hovering the method name doesn't imply clicking it.
      div.title = sessionBit === 2
        ? 'Session method that overrides a persistent base method'
        : 'Session method that adds new behavior (extension)';
      div.appendChild(makeSessionIndicator(selector, sessionBit));
    }
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
