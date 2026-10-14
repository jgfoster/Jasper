/**
 * Webview-side: qualify a preview row's class name with its dictionary once the rows in the
 * list, taken together, claim that name from more than one dictionary.
 *
 * The host decides this a page at a time (`ambiguousClassNames`), and the panel renders and posts
 * page 1 before page 2 exists -- so two same-named classes split across pages both read
 * `Shadowed>>foo` unless something looks at the whole list after each page lands. That is this.
 * The rule is the host's: a row with no dictionary counts as its own claim, and only a row that
 * names a dictionary has one to show. Names are rendered by `classNameSpan`
 * (qualifiedClassName.ts) as `<span class="cls" data-class data-dict>`.
 *
 * A row's checkbox repeats its label in `aria-label`, so that is rewritten with it.
 *
 * Injected ahead of the panel's own script, which calls it after the first page and after every
 * appended one. Exposed as the global `RowQualifier`.
 */
(function () {
  function qualify(doc) {
    const spans = Array.prototype.slice.call(doc.querySelectorAll('span.cls[data-class]'));
    const claims = new Map();
    spans.forEach(function (span) {
      const name = span.getAttribute('data-class');
      if (!claims.has(name)) claims.set(name, new Set());
      claims.get(name).add(span.getAttribute('data-dict') || '');
    });
    spans.forEach(function (span) {
      const name = span.getAttribute('data-class');
      const dict = span.getAttribute('data-dict');
      const text = claims.get(name).size > 1 && dict ? name + ' (' + dict + ')' : name;
      const was = span.textContent;
      if (was === text) return;
      span.textContent = text;
      const row = span.closest('li.change');
      const cb = row && row.querySelector('input.sel');
      const aria = cb && cb.getAttribute('aria-label');
      if (aria) cb.setAttribute('aria-label', requalified(aria, was, text));
    });
  }

  // A label opens with the class name -- `Include Foo>>bar`, or `Foo>>bar (required)` -- so the
  // name is replaced there and nowhere else: a bare replace() matched a class named `Inc` inside
  // the word "Include" first.
  function requalified(aria, was, text) {
    const include = 'Include ';
    if (aria.indexOf(include + was) === 0)
      return include + text + aria.slice((include + was).length);
    if (aria.indexOf(was) === 0) return text + aria.slice(was.length);
    return aria;
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.RowQualifier = { qualify: qualify };
})();
