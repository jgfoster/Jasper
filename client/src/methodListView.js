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

  // Render leading arrow(s) followed by the selector text. The arrows are kept
  // as the item's leading children; ListFilter preserves them when it
  // re-renders the selector text for filtering/highlighting.
  function applyOverrideArrows(div, selector, methodOverrideBit) {
    div.textContent = '';
    if (methodOverrideBit & 1) div.appendChild(makeOverrideArrow(selector, 'up'));
    if (methodOverrideBit & 2) div.appendChild(makeOverrideArrow(selector, 'down'));
    div.appendChild(document.createTextNode(selector));
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
    const item = event.target.closest('.item');
    if (!item) return null;
    const prev = listEl.querySelector('.item.selected');
    if (prev) prev.classList.remove('selected');
    item.classList.add('selected');
    return { command: 'selectMethod', selector: item.dataset.value };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.MethodListView = { makeOverrideArrow, applyOverrideArrows, methodListClickMessage };
})();
