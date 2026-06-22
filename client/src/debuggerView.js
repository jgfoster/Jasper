/**
 * Webview-side behavior for the Jasper Debugger panel (debuggerPanel.ts).
 *
 * Like listFilter.js / methodListView.js, this is read at runtime via
 * fs.readFileSync and injected into the webview as a <script> tag — it is NOT
 * compiled into the bundle. It lives in its own file so the stack rendering,
 * frame selection, and the custom right-click ("Copy Frame") popup can be
 * unit-tested in jsdom (see debuggerView.test.ts) instead of being trapped
 * inside the inline webview <script> string.
 *
 * Stage 1 extraction: the host (debuggerPanel.ts) keeps owning the data layer
 * and clipboard writes; this module owns everything that happens in the DOM.
 *
 * Exposed as the global `DebuggerView` so both the webview (classic <script>)
 * and tests (new Function(source)()) can reach it.
 */
(function () {
  // Render the stack frames into listEl. Each frame becomes
  //   <li class="frame" data-level="N"> <span.level> <span.label> [<span.pos>]
  // The data-level attribute is how selection and the copy popup refer back to
  // a frame, so the host never needs to send DOM node identities.
  function renderStack(listEl, stack) {
    listEl.innerHTML = '';
    if (!stack || stack.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No stack frames available.';
      listEl.appendChild(li);
      return;
    }
    for (const frame of stack) {
      const li = document.createElement('li');
      li.className = 'frame';
      li.dataset.level = String(frame.level);
      li.title = 'Click to select; right-click to copy this frame';
      const lvl = document.createElement('span');
      lvl.className = 'level';
      lvl.textContent = frame.level;
      const lbl = document.createElement('span');
      lbl.className = 'label';
      lbl.textContent = frame.label;
      li.appendChild(lvl);
      li.appendChild(lbl);
      if (frame.position) {
        const pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = frame.position;
        li.appendChild(pos);
      }
      listEl.appendChild(li);
    }
  }

  // Mark the frame with the given level selected, clearing any prior selection.
  // Returns the selected <li>, or null when no frame carries that level.
  function selectFrame(listEl, level) {
    const prev = listEl.querySelector('.frame.selected');
    if (prev) prev.classList.remove('selected');
    const li = listEl.querySelector('.frame[data-level="' + level + '"]');
    if (li) li.classList.add('selected');
    return li;
  }

  // Show the custom context menu at the cursor; hide it.
  function showMenu(menuEl, x, y) {
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.classList.add('show');
  }
  function hideMenu(menuEl) { menuEl.classList.remove('show'); }

  // Find the 1-based level of the frame containing an event target, or null.
  function frameLevelOf(target) {
    const li = target && target.closest ? target.closest('.frame') : null;
    return li ? Number(li.dataset.level) : null;
  }

  /**
   * Wire all webview interactions given the DOM refs + the vscode api object.
   * Returns a tiny controller (mainly for tests):
   *   selectedLevel() — the currently selected frame's level (or null)
   *   select(level)   — programmatically select a frame
   *
   * Selecting a frame (left-click, right-click, or the default top-frame select)
   * marks it `.selected`, tracks it so "Copy Frame" knows its target, and posts
   * `selectFrame` to the host so it can open that frame's source in the companion
   * editor and highlight the current line.
   */
  function init(refs, vscode) {
    const { list, menu, copyFrameItem, copyBtn, error } = refs;
    let selectedLevel = null;

    function select(level) {
      if (level == null) return;
      selectFrame(list, level);
      selectedLevel = level;
      vscode.postMessage({ command: 'selectFrame', level });
    }

    // Left-click selects a frame (will drive the source pane in later Stage 1 work).
    list.addEventListener('click', (e) => {
      const level = frameLevelOf(e.target);
      if (level != null) select(level);
    });

    // Right-click selects the frame AND opens the custom copy popup.
    list.addEventListener('contextmenu', (e) => {
      const level = frameLevelOf(e.target);
      if (level == null) return;
      e.preventDefault();
      e.stopPropagation();
      select(level);
      showMenu(menu, e.clientX, e.clientY);
    });

    copyFrameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedLevel != null) vscode.postMessage({ command: 'copyFrame', level: selectedLevel });
      hideMenu(menu);
    });

    copyBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyStack' });
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    });

    // Suppress the native Cut/Copy/Paste menu everywhere; close our popup on any
    // dismiss gesture (outside click, scroll, focus loss, Escape).
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    document.addEventListener('click', () => hideMenu(menu));
    window.addEventListener('scroll', () => hideMenu(menu), true);
    window.addEventListener('blur', () => hideMenu(menu));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(menu); });

    // Inbound messages from the host.
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'init') {
        if (error) error.textContent = msg.errorMessage || '';
        renderStack(list, msg.stack);
        // Default-select the top frame so the debugger opens focused on a frame.
        if (msg.stack && msg.stack.length > 0) select(msg.stack[0].level);
      }
    });

    return { selectedLevel: () => selectedLevel, select };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.DebuggerView = { renderStack, selectFrame, showMenu, hideMenu, frameLevelOf, init };
})();
