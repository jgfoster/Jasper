import * as vscode from 'vscode';
import {ActiveSession, SessionManager} from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { ExportManager } from './exportManager';
import { logInfo } from './gciLog';
import {receiver} from "./queries/util";

// ── URI Structure ────────────────────────────────────────────
// Method:     gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/{selector}
// Definition: gemstone://{sessionId}/{dictName}/{className}/definition
// Comment:    gemstone://{sessionId}/{dictName}/{className}/comment
// New class:  gemstone://{sessionId}/{dictName}/new-class
// New method: gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/new-method

interface ParsedMethodUri {
  kind: 'method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
  environmentId: number;
  // Optional 1-based SymbolList index (?dict=N) — scopes the class lookup to a
  // specific dictionary. Falls back to dictName when absent.
  dictIndex?: number;
  // When true, serve the PERSISTENT base method source (what a session override
  // shadows) rather than the session/merged source. Used by the override diff.
  base?: boolean;
  // True when the selector segment carried a " (…)" display label (the override
  // diff decorates each side so its filename reads "sel (base)" / "sel (session
  // override)"). Such view URIs are always read-only.
  diffView?: boolean;
}

interface ParsedDefinitionUri {
  kind: 'definition';
  sessionId: number;
  dictName: string;
  className: string;
  // Optional 1-based SymbolList index (?dict=N). Scopes the class lookup to a
  // specific dictionary — disambiguates the same key in two dictionaries, which
  // can even share a name. Falls back to dictName when absent.
  dictIndex?: number;
}

interface ParsedCommentUri {
  kind: 'comment';
  sessionId: number;
  dictName: string;
  className: string;
  dictIndex?: number;
}

interface ParsedNewClassUri {
  kind: 'new-class';
  sessionId: number;
  dictName: string;
  category?: string;
}

interface ParsedNewMethodUri {
  kind: 'new-method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  environmentId: number;
  dictIndex?: number;
}

type ParsedUri = ParsedMethodUri | ParsedDefinitionUri | ParsedCommentUri | ParsedNewClassUri | ParsedNewMethodUri;

function parseUri(uri: vscode.Uri): ParsedUri {
  const sessionId = parseInt(uri.authority, 10);
  const parts = uri.path.split('/').map(decodeURIComponent);
  // parts[0] is '' (leading /)

  // Parse optional ?env=N from query string
  const envMatch = uri.query?.match(/env=(\d+)/);
  const environmentId = envMatch ? parseInt(envMatch[1], 10) : 0;
  const base = /(?:^|&)base=1(?:&|$)/.test(uri.query ?? '');
  // Optional ?dict=N — the 1-based SymbolList index that scopes a class lookup.
  const dictMatch = uri.query?.match(/(?:^|&)dict=(\d+)(?:&|$)/);
  const dictIndex = dictMatch ? parseInt(dictMatch[1], 10) : undefined;

  if (parts.length === 3 && parts[2] === 'new-class') {
    const catMatch = uri.query?.match(/category=([^&]+)/);
    const category = catMatch ? decodeURIComponent(catMatch[1]) : undefined;
    return { kind: 'new-class', sessionId, dictName: parts[1], category };
  }
  if (parts.length === 4 && parts[3] === 'definition') {
    return { kind: 'definition', sessionId, dictName: parts[1], className: parts[2], dictIndex };
  }
  if (parts.length === 4 && parts[3] === 'comment') {
    return { kind: 'comment', sessionId, dictName: parts[1], className: parts[2], dictIndex };
  }
  if (parts.length === 6 && parts[5] === 'new-method') {
    return {
      kind: 'new-method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: parts[4],
      environmentId,
      dictIndex,
    };
  }
  if (parts.length === 6) {
    // The override diff decorates each side's selector segment with a display
    // label — "sel (base)" / "sel (session override)". Strip it for the real
    // selector; its presence marks a read-only comparison view.
    const labelled = parts[5].match(/^(.*) \((?:base|session override)\)$/);
    return {
      kind: 'method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: parts[4],
      selector: labelled ? labelled[1] : parts[5],
      environmentId,
      base,
      diffView: labelled != null,
      dictIndex,
    };
   }
   throw vscode.FileSystemError.FileNotFound(uri);
}

export function buildNewMethodUri(
  sessionId: number,
  dictName: string,
  className: string,
  isMeta: boolean,
  category: string,
  environmentId: number,
  dictIndex?: number,
): vscode.Uri {
  return buildMethodUri({ kind: 'method', sessionId, dictName, className, isMeta, category, selector: 'new-method', environmentId, dictIndex });
}

export function buildClassDefinitionUri(
  sessionId: number, dictName: string, className: string, dictIndex?: number,
): vscode.Uri {
  assertIsValidUriPath('Dictionary name', dictName);
  assertIsValidUriPath('Class name', className);
  return vscode.Uri.from({
    scheme: 'gemstone',
    authority: String(sessionId),
    path: `/${dictName}/${className}/definition`,
    // The 1-based SymbolList index scopes the class lookup to a specific
    // dictionary (dictionaries can share a name). Omitted → dictName fallback.
    query: dictIndex !== undefined ? `dict=${dictIndex}` : '',
  });
}

export function buildMethodUri(parsedUri: ParsedMethodUri): vscode.Uri {
  assertIsValidUriPath('Dictionary name', parsedUri.dictName);
  assertIsValidUriPath('Class name', parsedUri.className);
  assertIsValidUriPath('Method category name', parsedUri.category);
  assertIsValidUriPath('Selector', parsedUri.selector);
  
  const side = parsedUri.isMeta ? 'class' : 'instance';
  const params: string[] = [];
  if (parsedUri.dictIndex !== undefined) params.push(`dict=${parsedUri.dictIndex}`);
  if (parsedUri.environmentId > 0) params.push(`env=${parsedUri.environmentId}`);
  if (parsedUri.base) params.push('base=1');
  return vscode.Uri.from({
    scheme: 'gemstone',
    authority: String(parsedUri.sessionId),
    path: `/${parsedUri.dictName}/${parsedUri.className}/${side}/${parsedUri.category}/${parsedUri.selector}`,
    query: params.join('&'),
  });
}

function assertIsValidUriPath(parameterName: string, value: string) {
  if (value.includes('/')) {
    throw new Error(`${parameterName} must not contain '/': ${value}`);
  }
}

export interface MethodCompiledEvent{
  uri: vscode.Uri;
  previousUri: vscode.Uri;
  previousUriIsTemplate: boolean;
}

export interface ClassDefinitionCompiledEvent {
  uri: vscode.Uri;
  previousUri: vscode.Uri;
  previousUriIsTemplate: boolean;
}

// ── FileSystemProvider ────────────────────────────────────────

export class GemStoneFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private _onMethodCompiled = new vscode.EventEmitter<MethodCompiledEvent>();
  readonly onMethodCompiled = this._onMethodCompiled.event;

  private _onClassDefinitionCompiled = new vscode.EventEmitter<ClassDefinitionCompiledEvent>();
  readonly onClassDefinitionCompiled = this._onClassDefinitionCompiled.event;

  private diagnostics = vscode.languages.createDiagnosticCollection('gemstone-method');

  constructor(
    private sessionManager: SessionManager,
    private exportManager?: ExportManager,
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    logInfo(`[FS] stat ${uri.toString()}`);
    const stat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
    const parsed = parseUri(uri);
    // New documents are always writable — no existing class to check
    if (parsed.kind === 'new-class' || parsed.kind === 'new-method') return stat;
    // Override-diff view URIs are read-only on both sides — it's a comparison,
    // not an editor.
    if (parsed.kind === 'method' && parsed.diffView) {
      stat.permissions = vscode.FilePermission.Readonly;
      return stat;
    }
    const session = this.sessionManager.getSession(parsed.sessionId);
    if (!session) return stat;
    const dictRef = 'dictIndex' in parsed && parsed.dictIndex !== undefined
      ? parsed.dictIndex
      : parsed.dictName;
    try {
      if (!queries.canClassBeWritten(session, parsed.className, dictRef)) {
        stat.permissions = vscode.FilePermission.Readonly;
      }
    } catch {
      // If the query fails (e.g., session busy), allow editing
    }
    logInfo(`[FS] stat → ${stat.permissions === vscode.FilePermission.Readonly ? 'readonly' : 'writable'}`);
    return stat;
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const parsed = parseUri(uri);

    if (parsed.kind === 'new-class') {
      const categoryLine = parsed.category ? `\n  category: '${parsed.category}'` : '';
      const template =
`Object subclass: 'NameOfClass'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: ${parsed.dictName}${categoryLine}
  options: #()`;
      return new TextEncoder().encode(template);
    }

    if (parsed.kind === 'new-method') {
      const template =
`messageSelector
  "comment"
  | temporaries |
  statements`;
      return new TextEncoder().encode(template);
    }

    const session = this.getSession(parsed.sessionId);

    let text: string;
    switch (parsed.kind) {
      case 'method': {
        const dictRef = parsed.dictIndex ?? parsed.dictName;
        text = parsed.base
          ? queries.getBaseMethodSource(session, parsed.className, parsed.isMeta, parsed.selector, parsed.environmentId, dictRef)
          : queries.getMethodSource(session, parsed.className, parsed.isMeta, parsed.selector, parsed.environmentId, dictRef);
        break;
      }
      case 'definition':
        text = queries.getClassDefinition(session, parsed.className, parsed.dictIndex ?? parsed.dictName);
        break;
      case 'comment':
        text = queries.getClassComment(session, parsed.className, parsed.dictIndex ?? parsed.dictName);
        break;
    }

    return new TextEncoder().encode(text);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): void {
    logInfo(`[FS] writeFile ${uri.toString()} (${content.length} bytes)`);
    const parsed = parseUri(uri);
    const session = this.getSession(parsed.sessionId);
    const source = new TextDecoder().decode(content);

    try {
      switch (parsed.kind) {
        case 'method':
          this.compileMethod(uri, parsed, source, session);
          break;
        case 'definition':
          this.compileClassDefinition(uri, parsed, source, session);
          break;
        case 'comment':
          queries.setClassComment(session, parsed.className, source, parsed.dictIndex ?? parsed.dictName);
          vscode.window.showInformationMessage(
            `Comment updated for ${parsed.className}`
          );
          void this.exportManager?.syncClass(session, parsed.dictName, parsed.className);
          break;
        case 'new-class':
          this.compileClassDefinition(uri, parsed, source, session);
          break;
        case 'new-method':
          this.compileMethod(uri, parsed, source, session);
          break;
      }

      this.diagnostics.delete(uri);
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      logInfo(`[FS] writeFile → success (${parsed.kind})`);
    } catch (e: unknown) {
      if (e instanceof BrowserQueryError) {
        logInfo(`[FS] writeFile → compile error: ${e.message}`);
        // Parse line number from GCI error message (e.g. "... (line 3, ...")
        const lineMatch = e.message.match(/line\s+(\d+)/i);
        const lineNum = lineMatch ? parseInt(lineMatch[1], 10) - 1 : 0;
        const range = new vscode.Range(
          new vscode.Position(Math.max(0, lineNum), 0),
          new vscode.Position(Math.max(0, lineNum), Number.MAX_SAFE_INTEGER),
        );
        const diag = new vscode.Diagnostic(range, e.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GemStone';
        this.diagnostics.set(uri, [diag]);
        // Do not rethrow — VS Code considers the save complete; old method still
        // lives in GemStone. The user sees the red squiggle and can fix and re-save.
        return;
      }
      logInfo(`[FS] writeFile → unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  private compileMethod(uri: vscode.Uri, parsedMethodUri: ParsedNewMethodUri | ParsedMethodUri, sourceCode: string, session: ActiveSession) {
    const result = queries.compileMethod(
        session, parsedMethodUri.className, parsedMethodUri.isMeta, parsedMethodUri.category, sourceCode,
        parsedMethodUri.environmentId, parsedMethodUri.dictIndex ?? parsedMethodUri.dictName,
    );
    const selector = result.split('>> ')[1]?.trim();

    if (!selector) {
      throw new BrowserQueryError(result);
    }
    
    vscode.window.showInformationMessage(
        `Compiled method ${receiver(parsedMethodUri.className, parsedMethodUri.isMeta)}>>#${selector}`
    );

    void this.exportManager?.syncClass(session, parsedMethodUri.dictName, parsedMethodUri.className);

    const newMethodUri = buildMethodUri({
      ...parsedMethodUri,
      kind: 'method',
      selector: selector
    });

    // Defer the event to the next event-loop iteration so VS Code has time to
    // process the completed save and mark the document clean. Firing synchronously
    // here — before writeFile returns — means the tab is still dirty when
    // closeTextEditorOn runs, which triggers a "save before closing?" dialog.
    setImmediate(() => this._onMethodCompiled.fire({
      uri: newMethodUri,
      previousUri: uri,
      previousUriIsTemplate: parsedMethodUri.kind === 'new-method',
    }));
  }

  private compileClassDefinition(uri: vscode.Uri, parsed: ParsedNewClassUri | ParsedDefinitionUri, source: string, session: ActiveSession) {
    const className = queries.compileClassDefinition(session, source);

    const message = parsed.kind === 'new-class'
      ? `Class created: ${className}`
      : `Class definition updated for ${className}`;
    vscode.window.showInformationMessage(message);

    // Use the name GemStone returned, not parsed.className: for a new-class URI the segment is
    // a placeholder, and editing a definition with a different class name creates a new class —
    // in both cases, parsed.className does not reflect the class that was actually created.
    void this.exportManager?.syncClass(session, parsed.dictName, className);

    // Preserve the dictionary index (when the edited URI carried one) so the
    // reopened definition tab targets the same dictionary and matches the tab
    // being replaced.
    const dictIndex = parsed.kind === 'definition' ? parsed.dictIndex : undefined;
    const definitionUri = buildClassDefinitionUri(parsed.sessionId, parsed.dictName, className, dictIndex);

    setImmediate(() => this._onClassDefinitionCompiled.fire({
      uri: definitionUri,
      previousUri: uri,
      previousUriIsTemplate: parsed.kind === 'new-class',
    }));
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
    this._onMethodCompiled.dispose();
    this._onClassDefinitionCompiled.dispose();
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot create directories');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot delete methods from here');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot rename methods');
  }

  private getSession(sessionId: number) {
    const sessions = this.sessionManager.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw vscode.FileSystemError.Unavailable(
        `GemStone session ${sessionId} is no longer active`
      );
    }
    return session;
  }
}
