import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

// Wall-clock start (ms) of the most recent logged query per session, so the
// paired result/error line can report how long the call took. GCI allows only
// one call in progress per session, so a single pending start per session is
// exact. Cleared when consumed by logResult/logError.
const callStart = new Map<number, number>();

export function getGciLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone GCI');
  }
  return channel;
}

/** Local wall-clock time as `[HH:MM:SS.mmm]` for a log-line prefix. */
function stamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0');
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
}

/**
 * Time since this session's last logQuery, formatted as `(N ms) ` with a
 * trailing space, then clear the pending start. Empty string when nothing is
 * pending (e.g. a standalone error not preceded by a query), so no misleading
 * duration is shown.
 */
function elapsed(sessionId: number): string {
  const start = callStart.get(sessionId);
  if (start === undefined) return '';
  callStart.delete(sessionId);
  return `(${Date.now() - start} ms) `;
}

export function logQuery(sessionId: number, label: string, code: string): void {
  const log = getGciLog();
  callStart.set(sessionId, Date.now());
  log.appendLine(`${stamp()} [Session ${sessionId}] ${label}`);
  log.appendLine(code);
  log.appendLine('');
}

export function logResult(sessionId: number, result: string): void {
  const log = getGciLog();
  const preview = result.length > 500 ? result.substring(0, 500) + '...' : result;
  log.appendLine(`${stamp()} [Session ${sessionId}] ${elapsed(sessionId)}→ ${preview}`);
  log.appendLine('');
}

export function logError(sessionId: number, message: string): void {
  const log = getGciLog();
  log.appendLine(`${stamp()} [Session ${sessionId}] ${elapsed(sessionId)}ERROR: ${message}`);
  log.appendLine('');
}

export function logGciCall(sessionId: number, func: string, args: Record<string, unknown>): void {
  const log = getGciLog();
  const formatted = Object.entries(args)
    .map(([k, v]) => {
      if (typeof v === 'bigint') return `${k}: 0x${v.toString(16)} (${v})`;
      if (typeof v === 'string' && v.length > 100) return `${k}: "${v.substring(0, 100)}..." (${v.length} chars)`;
      if (typeof v === 'string') return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join(', ');
  log.appendLine(`${stamp()} [Session ${sessionId}] GCI: ${func}(${formatted})`);
}

export function logGciResult(sessionId: number, func: string, result: Record<string, unknown>): void {
  const log = getGciLog();
  const formatted = Object.entries(result)
    .map(([k, v]) => {
      if (typeof v === 'bigint') return `${k}: 0x${v.toString(16)} (${v})`;
      if (typeof v === 'string' && v.length > 200) return `${k}: "${v.substring(0, 200)}..." (${v.length} chars)`;
      if (typeof v === 'string') return `${k}: "${v}"`;
      if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`;
      return `${k}: ${v}`;
    })
    .join(', ');
  log.appendLine(`${stamp()} [Session ${sessionId}]   → ${formatted}`);
}

export function logInfo(message: string): void {
  const log = getGciLog();
  log.appendLine(`${stamp()} ${message}`);
}

/**
 * Test-only: drop the cached channel and any pending call-start timers so each
 * test starts from a clean slate (the channel is a module-level singleton
 * created once per process). Not used by production code.
 */
export function _resetGciLogForTests(): void {
  channel = undefined;
  callStart.clear();
}
