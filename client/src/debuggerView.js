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

  // Render the selected frame's variables into varsEl, grouped (Receiver /
  // Instance variables / Arguments & Temps / stack temps). Each group is
  // { title, kind, collapsed?, vars:[{name, value, oop}] }; value is the
  // host-computed printString. onInspect(oop, name) is called when a row is
  // clicked (opens a GT Inspector); it's optional so tests can omit it.
  // Render the grouped variables. `handlers` (all optional) wires the T1
  // variable evaluator + GT Inspect:
  //   contextMenu(e, oop, name) — right-click a row (GT Inspect lives here now).
  //   commit(edit, expr)        — Enter in an editable row's inline editor;
  //                               posts the new expression to the host.
  //   setActiveEditor(ctrl|null)— register the open inline editor so the host's
  //                               setVariableResult can flag an error on it (and
  //                               so opening another editor closes the prior one).
  // A row carries `edit` ({kind,index}) when it's editable (instVars + named/
  // stack temps); `self` has none and stays read-only.
  function renderVariables(varsEl, groups, handlers) {
    handlers = handlers || {};
    varsEl.innerHTML = '';
    if (!groups || groups.length === 0) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No variables.';
      varsEl.appendChild(d);
      return;
    }
    for (const g of groups) {
      const group = document.createElement('div');
      group.className = 'var-group' + (g.collapsed ? ' collapsed' : '');
      group.dataset.kind = g.kind;

      const title = document.createElement('div');
      title.className = 'var-group-title';
      title.textContent = g.title;
      // Clicking a group title collapses/expands its body.
      title.addEventListener('click', function () { group.classList.toggle('collapsed'); });
      group.appendChild(title);

      const body = document.createElement('div');
      body.className = 'var-group-body';
      for (const v of (g.vars || [])) {
        const row = document.createElement('div');
        row.className = 'var' + (v.edit ? ' editable' : '');
        row.dataset.oop = v.oop;
        row.title = v.edit ? 'Click to edit • right-click to Inspect' : 'Right-click to Inspect';

        const name = document.createElement('span');
        name.className = 'var-name' + (v.name === 'self' ? ' self' : '');
        name.textContent = v.name;
        const val = document.createElement('span');
        val.className = 'var-value';
        val.textContent = v.value;
        const oop = document.createElement('span');
        oop.className = 'var-oop';
        oop.textContent = v.oop;

        row.appendChild(name);
        row.appendChild(val);
        // Revert (↺) icon — only on slots edited away from their original this
        // halt. Clicking restores the original; it must not open the editor.
        if (v.revertible && v.edit) {
          const rev = document.createElement('span');
          rev.className = 'var-revert';
          rev.textContent = '↺';
          rev.title = 'Revert to original value';
          rev.addEventListener('click', function (e) {
            e.stopPropagation();
            if (handlers.revert) handlers.revert(v.edit);
          });
          row.appendChild(rev);
        }
        row.appendChild(oop);

        // Right-click → GT Inspect (moved off left-click).
        row.addEventListener('contextmenu', function (e) {
          if (handlers.contextMenu) handlers.contextMenu(e, v.oop, v.name);
        });
        // Left-click → open the variable evaluator (editable rows only). The
        // guard stops a click on the row padding from stacking a 2nd editor.
        if (v.edit) {
          row.addEventListener('click', function () {
            if (!row.querySelector('.var-edit')) openVarEditor(row, val, v, handlers);
          });
        }
        body.appendChild(row);
      }
      group.appendChild(body);
      varsEl.appendChild(group);
    }
  }

  // Open the inline "variable evaluator" on a row: an input prefilled with the
  // value's printString (selected). Enter commits the typed expression (the host
  // evaluates it in the frame and assigns the result); Esc cancels and restores
  // the displayed value; blur cancels too (unless a commit is in flight). On a
  // compile/runtime error the host calls ctrl.showError and the editor STAYS so
  // the expression can be fixed.
  function openVarEditor(row, valEl, v, handlers) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'var-edit';
    input.value = v.value;
    valEl.style.display = 'none';
    row.classList.add('editing'); // wraps the error message onto its own line
    row.insertBefore(input, valEl);
    input.focus();
    input.select();

    let pending = false;
    let closed = false;
    let errored = false; // an error is on screen → don't auto-close on blur
    let errEl = null; // the visible error message line (created lazily)
    function clearError() {
      errored = false;
      input.classList.remove('error');
      input.removeAttribute('title');
      if (errEl) { if (errEl.parentNode) errEl.parentNode.removeChild(errEl); errEl = null; }
    }
    function close() {
      if (closed) return;
      closed = true;
      clearError();
      if (input.parentNode) input.parentNode.removeChild(input);
      row.classList.remove('editing');
      valEl.style.display = '';
      if (handlers.setActiveEditor) handlers.setActiveEditor(null);
    }
    const ctrl = {
      // Surface a rejected expression unmistakably: red border on the input AND a
      // visible message line (a hover-only tooltip is too easy to miss). The
      // editor STAYS open so the expression can be fixed.
      showError: function (m) {
        pending = false;
        errored = true;
        const text = m || 'Error';
        input.classList.add('error');
        input.title = text;
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'var-edit-error';
          row.appendChild(errEl);
        }
        errEl.textContent = text;
        input.focus();
        input.select();
      },
      close: close,
    };
    if (handlers.setActiveEditor) handlers.setActiveEditor(ctrl);

    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const expr = input.value.trim();
        if (!expr) { close(); return; }
        clearError();
        pending = true;
        if (handlers.commit) handlers.commit(v.edit, expr);
        // Stays open: success → the host re-renders variables (removing this
        // editor); error → ctrl.showError flags it and keeps it open.
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    input.addEventListener('blur', function () {
      // Defer so a click that moved focus to (e.g.) the context menu still runs.
      // While an error is showing, DON'T auto-close — the user may be clicking the
      // message to select/copy it (blurring the input). Esc still dismisses it.
      setTimeout(function () { if (!pending && !errored) close(); }, 0);
    });
  }

  // Render (or clear) the "Create #selector in Class" action shown when the
  // process is parked on a doesNotUnderstand:. `dnu` is { selector, className,
  // isMeta } or null/undefined (nothing to create). onCreate is called when the
  // button is clicked (posts createDnuMethod); optional so tests can omit it.
  function renderDnu(dnuBarEl, dnu, onCreate) {
    if (!dnuBarEl) return;
    dnuBarEl.innerHTML = '';
    if (!dnu) return;
    const btn = document.createElement('button');
    btn.className = 'dnu-btn';
    btn.textContent = 'Create #' + dnu.selector + ' in ' + dnu.className + (dnu.isMeta ? ' class' : '');
    btn.title = 'Create the missing method, then re-run the send into it';
    if (onCreate) btn.addEventListener('click', onCreate);
    dnuBarEl.appendChild(btn);
  }

  // Render (or clear) the "Implement #selector" action shown when the process is
  // parked on a subclassResponsibility (T4) — an abstract method invoked on a
  // concrete subclass that didn't override it. The target class is chosen via a
  // picker (like the override flow), so only the selector is shown on the button.
  // `sr` is { selector } or null/undefined (nothing to implement). Shares the
  // dnuBar; DNU and subclassResponsibility are mutually-exclusive parked states.
  function renderSubclassResp(dnuBarEl, sr, onImplement) {
    if (!dnuBarEl) return;
    dnuBarEl.innerHTML = '';
    if (!sr) return;
    const btn = document.createElement('button');
    btn.className = 'dnu-btn';
    btn.textContent = 'Implement #' + sr.selector;
    btn.title = 'Implement this abstract (subclassResponsibility) method in a concrete class';
    if (onImplement) btn.addEventListener('click', onImplement);
    dnuBarEl.appendChild(btn);
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
    const { list, menu, copyFrameItem, frameImplItem, copyBtn, error, dnuBar, toolbar, variables, evalInput, evalResult, main, splitter, hsplitter, evalbar, varMenu, varInspectItem } = refs;
    let selectedLevel = null;
    // The last-rendered stack (frame summaries), so the right-click menu can read
    // a frame's `overridable` / `receiverClass` to decide whether to offer the
    // "Implement in <receiverClass>" override action.
    let currentStack = [];
    // The currently-open variable evaluator (so setVariableResult can flag an
    // error on it, and opening another closes it) + the row a right-click menu
    // targets.
    let activeVarEditor = null;
    let varMenuTarget = null;
    function setActiveVarEditor(ctrl) {
      if (ctrl == null) { activeVarEditor = null; return; }
      if (activeVarEditor && activeVarEditor !== ctrl) activeVarEditor.close();
      activeVarEditor = ctrl;
    }
    // Handlers handed to renderVariables on every refresh.
    const varHandlers = {
      contextMenu: function (e, oop, name) {
        if (!varMenu) return;
        e.preventDefault();
        e.stopPropagation();
        varMenuTarget = { oop: oop, name: name };
        showMenu(varMenu, e.clientX, e.clientY);
      },
      commit: function (edit, expr) {
        vscode.postMessage({ command: 'setVariable', level: selectedLevel, kind: edit.kind, index: edit.index, expr: expr });
      },
      revert: function (edit) {
        vscode.postMessage({ command: 'revertVariable', level: selectedLevel, kind: edit.kind, index: edit.index });
      },
      setActiveEditor: setActiveVarEditor,
    };

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

    // Right-click selects the frame AND opens the custom popup. The "Implement in
    // <receiverClass>" item is shown only for an overridable frame (an inherited
    // method — see buildFrame), labelled with the receiver's class.
    list.addEventListener('contextmenu', (e) => {
      const level = frameLevelOf(e.target);
      if (level == null) return;
      e.preventDefault();
      e.stopPropagation();
      select(level);
      if (frameImplItem) {
        const frame = currentStack.find((f) => f.level === level);
        if (frame && frame.overridable) {
          // Ellipsis signals that clicking opens a class picker (an overridable
          // frame always has several candidates: the receiver's class up through
          // the class that defines the method). The frame label already names the
          // receiver, so the menu item doesn't repeat it.
          frameImplItem.textContent = 'Implement in…';
          frameImplItem.style.display = '';
        } else {
          frameImplItem.style.display = 'none';
        }
      }
      showMenu(menu, e.clientX, e.clientY);
    });

    copyFrameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedLevel != null) vscode.postMessage({ command: 'copyFrame', level: selectedLevel });
      hideMenu(menu);
    });

    if (frameImplItem) {
      frameImplItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedLevel != null) vscode.postMessage({ command: 'implementInReceiver', level: selectedLevel });
        hideMenu(menu);
      });
    }

    // Variable context menu: GT Inspect the right-clicked variable.
    if (varInspectItem) {
      varInspectItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (varMenuTarget) vscode.postMessage({ command: 'inspectVariable', oop: varMenuTarget.oop, name: varMenuTarget.name });
        if (varMenu) hideMenu(varMenu);
      });
    }

    copyBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyStack' });
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    });

    // Toolbar: each button posts its data-cmd. Step/restart act on the selected
    // frame (level included); resume/terminate don't need a level.
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-cmd]') : null;
        if (!btn) return;
        const command = btn.dataset.cmd;
        vscode.postMessage(selectedLevel != null ? { command, level: selectedLevel } : { command });
      });
    }

    // Eval-in-frame: Enter evaluates the expression in the selected frame.
    if (evalInput) {
      evalInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const expr = evalInput.value.trim();
        if (expr) vscode.postMessage({ command: 'evalInFrame', level: selectedLevel, expr });
      });
    }

    // Draggable splitter: dragging re-apportions the Call Stack vs Variables
    // panes by rewriting `--stack-basis` (the stack pane's width) on `.main`.
    // The ratio is persisted via webview state (survives a reload) and posted to
    // the host as `saveLayout` (so the next debugger panel opens the same way).
    if (splitter && main) {
      // Restore a previously saved ratio when reopening a reloaded webview.
      const saved = vscode.getState ? vscode.getState() : null;
      if (saved && saved.stackBasis) main.style.setProperty('--stack-basis', saved.stackBasis);
      if (saved && saved.evalHeight && evalbar) evalbar.style.setProperty('--eval-height', saved.evalHeight);

      // The basis at mousedown, so endDrag can tell a real drag from a bare click.
      let startBasis = null;
      function onMove(e) {
        const rect = main.getBoundingClientRect();
        if (rect.width <= 0) return;
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(20, Math.min(80, pct));
        main.style.setProperty('--stack-basis', pct.toFixed(1) + '%');
      }
      function endDrag() {
        // The global listeners exist only for the duration of the drag (attached
        // on mousedown), so idle mouse movement never runs onMove.
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', endDrag);
        splitter.classList.remove('dragging');
        const basis = main.style.getPropertyValue('--stack-basis').trim();
        // Persist only when the divider actually moved — a bare click leaves the
        // basis unchanged and must not trigger a state write / host round-trip.
        if (!basis || basis === startBasis) return;
        if (vscode.setState) {
          const state = (vscode.getState ? vscode.getState() : null) || {};
          state.stackBasis = basis;
          vscode.setState(state);
        }
        vscode.postMessage({ command: 'saveLayout', stackBasis: basis });
      }
      splitter.addEventListener('mousedown', (e) => {
        startBasis = main.style.getPropertyValue('--stack-basis').trim();
        splitter.classList.add('dragging');
        e.preventDefault();
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', endDrag);
      });
    }

    // Horizontal splitter: dragging rewrites `--eval-height` (the eval bar's
    // height). The panes flex-fill the rest, so dragging DOWN shrinks the eval bar
    // and grows the panes (more stack frames); dragging UP grows the eval bar.
    // Baseline is the live eval-bar height at mousedown (so the drag tracks 1:1).
    // Persisted like the column splitter.
    if (hsplitter && evalbar) {
      let startY = 0;
      let startHeight = 0;
      function onHMove(e) {
        // The splitter sits above the eval bar, so moving it down (clientY up)
        // makes the eval bar smaller — hence startY - e.clientY.
        let h = startHeight + (startY - e.clientY);
        h = Math.max(42, Math.min(window.innerHeight * 0.75, h));
        evalbar.style.setProperty('--eval-height', Math.round(h) + 'px');
      }
      function endHDrag() {
        window.removeEventListener('mousemove', onHMove);
        window.removeEventListener('mouseup', endHDrag);
        hsplitter.classList.remove('dragging');
        const height = evalbar.style.getPropertyValue('--eval-height').trim();
        if (!height) return;
        if (vscode.setState) {
          const state = (vscode.getState ? vscode.getState() : null) || {};
          state.evalHeight = height;
          vscode.setState(state);
        }
        vscode.postMessage({ command: 'saveLayout', evalHeight: height });
      }
      hsplitter.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        startHeight = evalbar.getBoundingClientRect().height;
        hsplitter.classList.add('dragging');
        e.preventDefault();
        window.addEventListener('mousemove', onHMove);
        window.addEventListener('mouseup', endHDrag);
      });
    }

    // Suppress the native Cut/Copy/Paste menu everywhere; close our popup on any
    // dismiss gesture (outside click, scroll, focus loss, Escape).
    function hideMenus() { hideMenu(menu); if (varMenu) hideMenu(varMenu); }
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    document.addEventListener('click', hideMenus);
    window.addEventListener('scroll', hideMenus, true);
    window.addEventListener('blur', hideMenus);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenus(); });

    // Inbound messages from the host.
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'init') {
        if (error) error.textContent = msg.errorMessage || '';
        // Show the create-method action when parked on a doesNotUnderstand:, or the
        // implement action when parked on a subclassResponsibility (T4). Mutually
        // exclusive; renderDnu(undefined) clears the bar before the SR button renders.
        renderDnu(dnuBar, msg.dnu, function () { vscode.postMessage({ command: 'createDnuMethod' }); });
        if (!msg.dnu) {
          renderSubclassResp(dnuBar, msg.subclassResp,
            function () { vscode.postMessage({ command: 'implementSubclassResponsibility' }); });
        }
        // Clear stale variables / eval output; the default-select below re-fetches.
        if (variables) variables.innerHTML = '';
        if (evalResult) { evalResult.textContent = ''; evalResult.classList.remove('error'); }
        currentStack = msg.stack || [];
        renderStack(list, msg.stack);
        // Default-select the top frame so the debugger opens focused on a frame.
        if (msg.stack && msg.stack.length > 0) select(msg.stack[0].level);
      } else if (msg.command === 'variables') {
        if (variables) renderVariables(variables, msg.groups, varHandlers);
      } else if (msg.command === 'setVariableResult') {
        // Failure → keep the editor open and flag the error so it can be fixed.
        // Success → the host also posts 'variables', which re-renders (and so
        // removes the editor) with fresh printStrings + OOPs.
        if (!msg.ok && activeVarEditor) activeVarEditor.showError(msg.error);
      } else if (msg.command === 'banner') {
        // Lightweight banner-only update (no stack re-render / frame re-select, so
        // it won't steal focus): set the error/guidance text and clear the DNU
        // Create button. Used while a created method is being edited.
        if (error) error.textContent = msg.text || '';
        if (dnuBar) dnuBar.innerHTML = '';
      } else if (msg.command === 'evalResult') {
        if (evalResult) {
          evalResult.textContent = msg.value != null ? msg.value : '';
          evalResult.classList.toggle('error', !!msg.isError);
        }
      }
    });

    return { selectedLevel: () => selectedLevel, select };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.DebuggerView = { renderStack, renderVariables, renderDnu, renderSubclassResp, selectFrame, showMenu, hideMenu, frameLevelOf, init };
})();
