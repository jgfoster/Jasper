/**
 * Server-side installation of the native GemStone MCP server classes.
 *
 * Files the vendored `GsMcp*` `.gs` payload (resources/mcp-server/) into a stone
 * over a GCI session, mirroring the Enhanced Inspector installer
 * (enhancedInspectorInstall.ts): each file is filed in with a single server-side
 * `GsFileIn fromPath:on:#serverUtf8File to:` call (the gem reads and compiles the
 * file itself), in the dependency order the topaz `load.gs` loader uses, then the
 * work is committed and verified.
 *
 * Two differences from the inspector payload:
 *  - The `GsMcp*` classes are declared `inDictionary: Published`, so `Published`
 *    must resolve before file-in. `ensurePublished` creates it and inserts it
 *    into the session's symbol list first (the same bootstrap install.sh does),
 *    in the same transaction as the file-in so the single final commit persists
 *    everything (nothing partial is committed).
 *  - The payload adds only new `GsMcp*` classes — no kernel-class extensions — so
 *    it needs no SystemUser; a session for the connection's own user has enough
 *    privilege. (The caller supplies the session; this module is agnostic about
 *    how it was obtained.)
 *
 * The optional Grail/Python subclass (GsMcpServerWithGrail) is filed in only when
 * the image actually has Grail (`ModuleAst`), matching `install.sh --grail`.
 *
 * Server-side file-in requires the gem to be able to read the files, i.e. share
 * a filesystem with them (a local stone). Remote stones are detected and
 * reported rather than failing cryptically.
 */
import { ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { compareGemStoneVersions } from './gemStoneVersion';

/**
 * Minimum GemStone version the native MCP server is supported on — the oldest
 * release it has been tested against. The comparison is semantic (numeric per
 * segment), so later releases pass automatically without a list to maintain.
 */
export const MCP_SERVER_MIN_VERSION = '3.6.2';

/**
 * True when `stoneVersion` is `MCP_SERVER_MIN_VERSION` or later.
 *
 * `stoneVersion` is the raw `GciTsVersion` string, which starts with the numeric
 * version but may carry a trailing build/description suffix (e.g. "3.6.2 build
 * ..."); we extract the leading `x.y.z[.w]` token before comparing, since
 * `compareGemStoneVersions` requires a bare numeric string and would otherwise
 * throw on the suffix (and we fail closed). Mirrors
 * enhancedInspectorInstall.supportsEnhancedInspector.
 */
export function supportsMcpServer(stoneVersion: string | undefined): boolean {
  const numeric = stoneVersion?.match(/^\d+\.\d+(\.\d+){0,2}/)?.[0];
  if (!numeric) return false;
  const padded = numeric.split('.').length < 3 ? `${numeric}.0` : numeric;
  try {
    return compareGemStoneVersions(padded, MCP_SERVER_MIN_VERSION) >= 0;
  } catch {
    return false;
  }
}

/**
 * The runtime payload files, in dependency order — must match the `input` order
 * in resources/mcp-server/load.gs. Earlier files define classes later files
 * depend on. The optional Grail subclass is appended at install time only when
 * the image has Grail (see GRAIL_FILE / imageHasGrail); the `GsTestCase` test
 * classes are intentionally not installed by this runtime installer.
 */
export const MCP_SERVER_FILES: readonly string[] = [
  'GsMcpTool.gs',
  'GsMcpToolRegistry.gs',
  'GsMcpHttpConnection.gs',
  'GsMcpDispatcher.gs',
  'GsMcpServer.gs',
];

/** The optional Grail/Python subclass, filed in only on a Grail-equipped image. */
export const GRAIL_FILE = 'GsMcpServerWithGrail.gs';

export interface InstallResult {
  /** True only when every file filed in, the commit succeeded, and the
   *  end-state verification passed. */
  success: boolean;
  committed: boolean;
  verified: boolean;
  /** Files successfully filed in (in order). */
  filedIn: string[];
  /** True when the Grail subclass was included (image had Grail). */
  withGrail: boolean;
  /** The file whose file-in stopped the install, if any. */
  failedFile?: string;
  /** Human-readable summary, suitable for surfacing to the user. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/**
 * True when the image has Grail installed (the `ModuleAst` global resolves), in
 * which case the optional Python tools can be filed in. Resolved via the
 * session's symbol list so it works regardless of dictionary. Never references
 * `ModuleAst` as a literal (that would be a compile error on a non-Grail image);
 * looks it up dynamically instead.
 */
export function imageHasGrail(session: ActiveSession): boolean {
  try {
    const r = executeFetchString(
      session,
      'mcpImageHasGrail',
      '[(System myUserProfile resolveSymbol: #ModuleAst) notNil printString] ' +
        "on: Error do: [:e | 'false']",
    );
    return r.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * True when the native MCP server is present in the stone reached by this
 * session: `GsMcpServer` resolves and its class understands `runOnPort:`.
 * Resolved dynamically (never referencing `GsMcpServer` as a literal, which
 * would be a compile error before the install) and guarded so a partial or
 * absent install reads as false.
 */
export function isMcpServerInstalled(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
      session,
      'verifyMcpServer',
      '[| a | a := System myUserProfile resolveSymbol: #GsMcpServer. ' +
        '(a notNil and: [a value class canUnderstand: #runOnPort:]) printString] ' +
        "on: Error do: [:e | 'false']",
    );
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Install (or re-install) the native MCP server classes into the stone.
 *
 * Always re-files-in — presence is never a gate, so editing a `.gs` file and
 * re-running pushes the change. `Published` is ensured first, then files are
 * processed in dependency order (plus the Grail subclass when the image has
 * Grail); the first file that fails stops the run and the transaction is aborted
 * so nothing partial is committed. On success the work is committed and verified.
 *
 * @param session     a session on the target connection (the connection's own
 *                    user is sufficient — no SystemUser required).
 * @param payloadDir  absolute path to resources/mcp-server, readable by the gem
 *                    (a local stone).
 * @param onProgress  optional incremental progress callback.
 */
export async function installMcpServer(
  session: ActiveSession,
  payloadDir: string,
  onProgress: ProgressReporter = () => {},
): Promise<InstallResult> {
  const sep = payloadDir.endsWith('/') ? '' : '/';
  const serverPath = (file: string): string => `${payloadDir}${sep}${file}`;

  const withGrail = imageHasGrail(session);
  const files = withGrail ? [...MCP_SERVER_FILES, GRAIL_FILE] : [...MCP_SERVER_FILES];
  // files + the ensure-Published step + the commit step.
  const stepIncrement = 100 / (files.length + 2);

  const fail = (
    partial: Omit<InstallResult, 'success' | 'committed' | 'verified'>,
  ): InstallResult => ({
    success: false,
    committed: false,
    verified: false,
    ...partial,
  });

  // Fail fast (and clearly) if the gem can't read the payload — e.g. a remote
  // stone whose gem doesn't share this machine's filesystem.
  const unreadable = files.filter((f) => !gemCanRead(session, serverPath(f)));
  if (unreadable.length > 0) {
    return fail({
      filedIn: [],
      withGrail,
      message:
        `The database's gem cannot read the payload files (${unreadable.join(', ')}) under ` +
        `${payloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
    });
  }

  // Ensure `Published` exists and is in the symbol list so the classes'
  // `inDictionary: Published` resolves during file-in. In the same transaction
  // as the file-in — the single commit below persists it, so a later failure
  // rolls this back too.
  onProgress('Ensuring the Published dictionary…', stepIncrement);
  await yieldToEventLoop();
  try {
    ensurePublished(session);
  } catch (e: unknown) {
    safeAbort(session);
    return fail({
      filedIn: [],
      withGrail,
      message: `Could not ensure the Published dictionary: ${messageOf(e)}. No changes were committed.`,
    });
  }

  const filedIn: string[] = [];
  for (const file of files) {
    onProgress(`Filing in ${file}…`, stepIncrement);
    await yieldToEventLoop();
    try {
      executeFetchString(
        session,
        `mcpInstall:${file}`,
        // #serverUtf8File (like the inspector installer) so any byte > 127 in the
        // payload decodes correctly in both String and Unicode comparison modes;
        // must end in a byte object (a String) since executeFetchString fetches
        // the result via GciTsExecuteFetchBytes.
        `GsFileIn fromPath: ${gsStringLiteral(serverPath(file))} on: #serverUtf8File to: nil. 'ok'`,
      );
      filedIn.push(file);
    } catch (e: unknown) {
      safeAbort(session);
      return fail({
        filedIn,
        withGrail,
        failedFile: file,
        message: `File-in of ${file} failed: ${messageOf(e)}. No changes were committed.`,
      });
    }
  }

  onProgress('Committing…', stepIncrement);
  await yieldToEventLoop();
  const { success: committed, err } = session.gci.GciTsCommit(session.handle);
  if (!committed) {
    safeAbort(session);
    return fail({
      filedIn,
      withGrail,
      message: `Commit failed: ${err.message || `GCI error ${err.number}`}`,
    });
  }

  const verified = isMcpServerInstalled(session);
  return {
    success: verified,
    committed: true,
    verified,
    filedIn,
    withGrail,
    message: verified
      ? `Native MCP server installed and verified${withGrail ? ' (with Grail/Python tools)' : ''}.`
      : 'Payload committed, but verification failed: GsMcpServer was not found. The install may be ' +
        'incomplete.',
  };
}

/**
 * Ensure the `Published` symbol dictionary exists and is in the session's symbol
 * list, creating and inserting it if absent. Does NOT commit — the caller's
 * single commit persists it in the same transaction as the file-in. Mirrors the
 * bootstrap in resources/mcp-server/install.sh. Throws on failure.
 */
function ensurePublished(session: ActiveSession): void {
  executeFetchString(
    session,
    'mcpEnsurePublished',
    '| up existing d | ' +
      'up := System myUserProfile. ' +
      'existing := up resolveSymbol: #Published. ' +
      'existing isNil ' +
      'ifTrue: [ ' +
      'd := SymbolDictionary new. ' +
      'd at: #Published put: d. ' +
      'up insertDictionary: d at: up symbolList size + 1. ' +
      "'created' ] " +
      "ifFalse: [ 'exists' ]",
  );
}

/** Whether the gem process can read the file at `serverPath`. */
function gemCanRead(session: ActiveSession, serverPath: string): boolean {
  try {
    const r = executeFetchString(
      session,
      'mcpGemCanRead',
      `[(GsFile existsOnServer: ${gsStringLiteral(serverPath)}) printString] ` +
        "on: Error do: [:e | 'false']",
    );
    return r.trim() === 'true';
  } catch {
    return false;
  }
}

/** Render a JS string as a GemStone string literal: single quotes doubled and
 *  the whole value wrapped in quotes. */
function gsStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Yield to the event loop so the progress notification can paint between the
 *  per-file (synchronous) server calls. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function safeAbort(session: ActiveSession): void {
  try {
    session.gci.GciTsAbort(session.handle);
  } catch {
    // Best-effort rollback; the caller closes the session regardless.
  }
}

/** Extract a human-readable message from a thrown value. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
