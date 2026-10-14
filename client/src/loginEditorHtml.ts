/**
 * The login editor's page: the form and the script that runs it. Kept apart
 * from the panel so the script can be tested in a browser-like environment
 * without the editor's API.
 */
export function loginEditorHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Login</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      max-width: 500px;
    }
    h2 {
      margin-top: 0;
      font-weight: 400;
    }
    label {
      display: block;
      margin-top: 12px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    select, input[type="text"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .version-download {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .version-download[hidden] {
      display: none;
    }
    select:focus, input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .field-group {
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-bottom: 12px;
      margin-bottom: 4px;
    }
    .button-row {
      margin-top: 20px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .checkbox-row input[type="checkbox"] {
      margin: 0;
    }
    label.inline-label {
      display: inline;
      margin: 0;
      font-weight: 400;
      cursor: pointer;
    }
    .hint {
      font-size: 0.9em;
      opacity: 0.7;
      margin-top: 4px;
    }
    a.doc-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    a.doc-link:hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }
    .help-row {
      margin: 4px 0 8px;
    }
    /* Per-field help, revealed by the "Help me login" toggle. The left accent bar
       visually ties each note to the field above it. */
    .field-help {
      display: none;
      font-size: 0.9em;
      opacity: 0.85;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--vscode-focusBorder);
    }
    body.help-on .field-help {
      display: block;
    }
    .help-intro {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
    body.help-on .help-intro {
      display: block;
    }
    .banner {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
  </style>
</head>
<body>
  <h2>GemStone Login Parameters</h2>

  <div class="help-row">
    <button id="helpToggle" class="secondary" type="button" aria-expanded="false">Help me login</button>
  </div>

  <div id="helpIntro" class="help-intro">
    Fill in the fields below to connect to a stone; each field's help explains what to
    enter. Host User/Password are needed only for a remote stone whose NetLDI requires
    host authentication. For a full explanation of how GemStone logins work — NRS
    syntax, linked vs. RPC logins, and how the NetLDI starts your Gem — see GemStone's
    <a class="doc-link" id="docsLink">Logging in Gem Sessions</a> guide.
  </div>

  <div id="readOnlyBanner" class="banner">
    This login has an active session, so its configuration is read-only. Log out to edit it.
  </div>

  <div class="field-group">
    <label for="version">GemStone Version</label>
    <select id="version"></select>
    <div id="versionDownload" class="version-download" hidden
         title="Jasper downloads GemStone's GCI client libraries for this version. No server is installed.">
      <span id="versionDownloadText"></span>
      <button id="downloadVersionBtn" class="secondary">Download files</button>
      <span id="versionDownloadSize"></span>
    </div>
    <div class="field-help">The GemStone version of the stone you are connecting to. Jasper downloads what it needs for that version the first time you use it.</div>

    <label for="gem_host">Gem Host</label>
    <input type="text" id="gem_host" placeholder="localhost">
    <div class="field-help">The machine where your Gem process runs. Use <code>localhost</code> for a stone on this computer, or the remote host's name or IP address for a remote stone.</div>

    <label for="stone">Stone</label>
    <input type="text" id="stone" placeholder="gs64stone">
    <div class="field-help">The name of the running stone (repository monitor) to log in to — for example, <code>gs64stone</code>.</div>

    <label for="netldi">NetLDI (name or port)</label>
    <input type="text" id="netldi" placeholder="gs64ldi or 50377">
    <div class="field-help">The NetLDI network server that launches your Gem. Enter its service name (e.g. <code>gs64ldi</code>) or its port number (e.g. <code>50377</code>). A port number is often easiest for a remote stone.</div>
  </div>

  <div class="field-group">
    <label for="gs_user">GemStone User</label>
    <input type="text" id="gs_user" placeholder="DataCurator">
    <div class="field-help">Your GemStone user — a UserProfile inside the repository, such as <code>DataCurator</code>. This is a GemStone account, not your operating-system login.</div>

    <label for="gs_password">GemStone Password</label>
    <input type="password" id="gs_password">
    <div class="checkbox-row">
      <input type="checkbox" id="password_in_keychain">
      <label for="password_in_keychain" class="inline-label">Store password in OS keychain</label>
    </div>
    <div class="field-help">The password for the GemStone user. Leave it blank to be prompted on each login, or check the box above to store it securely in your OS keychain.</div>
  </div>

  <div class="field-group">
    <label for="host_user">Host User (optional)</label>
    <input type="text" id="host_user">

    <label for="host_password">Host Password (optional)</label>
    <input type="password" id="host_password">
    <div class="field-help">The operating-system account on the Gem's host machine. Fill these in only when the remote NetLDI requires host authentication; leave them blank for a local stone or a guest-mode NetLDI. If left blank, your own OS user is used.</div>
  </div>

  <div class="field-group">
    <div class="checkbox-row">
      <input type="checkbox" id="sync_classes" checked>
      <label for="sync_classes" class="inline-label">Sync classes to local files (Find in Files, Go to Definition)</label>
    </div>
    <div class="field-help">Keeps a read-only .gemstone mirror in sync on login/commit. Turn off for slow or remote connections where the initial sync isn't worth it — server-side search still works.</div>
  </div>

  <div class="button-row">
    <button id="saveBtn">Save</button>
    <button id="cancelBtn" class="secondary">Cancel</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const fields = ['version','gem_host','stone','gs_user','gs_password','netldi','host_user','host_password'];
    let originalLabel = null;

    let helpOn = false;
    function setHelp(on) {
      helpOn = on;
      document.body.classList.toggle('help-on', on);
      const btn = document.getElementById('helpToggle');
      btn.textContent = on ? 'Hide help' : 'Help me login';
      btn.setAttribute('aria-expanded', String(on));
    }
    document.getElementById('helpToggle').addEventListener('click', () => setHelp(!helpOn));
    document.getElementById('docsLink').addEventListener('click', () => {
      vscode.postMessage({ command: 'openDocs' });
    });

    // Versions with nothing on this machine yet, and download sizes as the host
    // reports them (null: no small download is published for this computer).
    let notDownloaded = new Set();
    const sizes = {};
    let downloading = null;
    let readOnly = false;
    const versionSelect = document.getElementById('version');
    const downloadBtn = document.getElementById('downloadVersionBtn');

    function fillVersions(versions, missing, chosen) {
      notDownloaded = new Set(missing || []);
      const list = [...(versions || [])];
      if (chosen && !list.includes(chosen)) list.unshift(chosen);
      versionSelect.innerHTML = '';
      for (const v of list) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = notDownloaded.has(v) ? v + ' (not yet downloaded)' : v;
        versionSelect.appendChild(opt);
      }
      versionSelect.value = chosen || '';
    }

    function showVersionNote() {
      const v = versionSelect.value;
      const note = document.getElementById('versionDownload');
      note.hidden = readOnly || !v || !notDownloaded.has(v);
      if (note.hidden) return;
      const text = document.getElementById('versionDownloadText');
      const sizeText = document.getElementById('versionDownloadSize');
      const size = sizes[v];
      if (size === null) {
        text.textContent = 'GemTalk publishes no small download of GemStone ' + v +
          ' for this computer. Install the full version from the GemStone manager to log in to it.';
        sizeText.textContent = '';
        downloadBtn.hidden = true;
        return;
      }
      text.textContent = 'Jasper needs a few files to talk to GemStone ' + v + '.';
      sizeText.textContent = typeof size === 'number'
        ? '(about ' + Math.max(1, Math.round(size / 1e6)) + ' MB)'
        : '';
      downloadBtn.hidden = false;
      downloadBtn.disabled = downloading === v;
      downloadBtn.textContent = downloading === v ? 'Downloading…' : 'Download files';
    }

    function versionChosen() {
      const v = versionSelect.value;
      if (v && notDownloaded.has(v) && !(v in sizes)) {
        vscode.postMessage({ command: 'checkVersion', version: v });
      }
      showVersionNote();
    }

    versionSelect.addEventListener('change', versionChosen);
    downloadBtn.addEventListener('click', () => {
      downloading = versionSelect.value;
      vscode.postMessage({ command: 'downloadVersion', version: downloading });
      showVersionNote();
    });

    vscode.postMessage({ command: 'requestData' });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'versions') {
        // A fresh list, from the download site or after a download: the form
        // keeps what the user typed and the version they chose. Only the end of
        // its own download frees the button; the catalog can arrive mid-run.
        if (msg.downloaded && msg.downloaded === downloading) downloading = null;
        fillVersions(msg.versions, msg.notDownloaded, versionSelect.value || (msg.versions || [])[0]);
        versionChosen();
        return;
      }
      if (msg.command === 'versionInfo') {
        sizes[msg.version] = msg.size;
        if (versionSelect.value === msg.version) showVersionNote();
        return;
      }
      if (msg.command === 'loadData') {
        originalLabel = msg.data.label || null;
        readOnly = Boolean(msg.readOnly);
        fillVersions(msg.versions, msg.notDownloaded, msg.data.version || '');
        // Populate other fields
        for (const f of fields) {
          if (f === 'version') continue;
          const el = document.getElementById(f);
          if (el) el.value = msg.data[f] || '';
        }
        document.getElementById('password_in_keychain').checked =
          Boolean(msg.data.password_in_keychain);
        // Default on when unset, so existing logins keep syncing.
        document.getElementById('sync_classes').checked =
          msg.data.sync_classes !== false;

        // Read-only view (login has an active session): show fields but disable
        // every control, hide the Save/Cancel row, and surface the banner.
        versionChosen();
        for (const el of document.querySelectorAll('input, select')) {
          el.disabled = readOnly;
        }
        document.getElementById('readOnlyBanner').style.display = readOnly ? 'block' : 'none';
        document.querySelector('.button-row').style.display = readOnly ? 'none' : 'flex';

        // Default the help open for a brand-new login (the first-use case this is
        // for); keep it closed when editing/viewing an existing one so it stays
        // out of the way. The user can toggle it either way.
        setHelp(!readOnly && !originalLabel);
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const data = {};
      for (const f of fields) {
        data[f] = document.getElementById(f).value;
      }
      data.password_in_keychain = document.getElementById('password_in_keychain').checked;
      data.sync_classes = document.getElementById('sync_classes').checked;
      vscode.postMessage({ command: 'save', data, originalLabel });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
  </script>
</body>
</html>`;
}
