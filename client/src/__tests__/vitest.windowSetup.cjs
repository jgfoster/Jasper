// Vitest runs some tests in jsdom (a simulated browser) and others in plain Node.
// This setup file runs before every test suite. The block below only applies to
// jsdom environments — Node has no 'window', so we skip it there.
if (typeof window !== 'undefined') {
  // jsdom may not have a CSS object at all. Create it if missing, but leave
  // any existing one intact (??= only assigns when the left side is null/undefined).
  window.CSS ??= {};

  // jsdom doesn't implement CSS.escape. Polyfill it using the 'css.escape' npm
  // package, which matches the spec. Skip if it's already present — a future
  // jsdom version may add native support, and we don't want to shadow it.
  if (typeof window.CSS.escape === 'undefined') {
    window.CSS.escape = require('css.escape');
  }
}
