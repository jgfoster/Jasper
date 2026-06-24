import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { GciError } from './gciLibrary';
import { pollReadable } from './socketPoll';

/**
 * Shared non-blocking GCI call runner.
 *
 * GemStone's blocking GCI calls (GciTsPerform / GciTsContinueWith) run
 * synchronously on the extension-host main thread, so a slow/looping/re-halting
 * server operation freezes the *entire* VS Code extension host — not just a
 * webview (see the Enhanced Debugger freeze, 2026-06-22). The non-blocking GCI
 * API (GciTsNb…) avoids that: start the call, then poll the session socket for
 * the result on a timer, yielding to the event loop between polls.
 *
 * This is the single implementation of that poll loop, shared by `codeExecutor`
 * (Execute/Display It, via `pollNbToCompletion`) and the debugger's step/trim
 * (via `runNbCall`) so the cancel/break/backoff/progress behaviour can't drift
 * between the two. It does NOT cover Resume: GemStone 3.7.x has no
 * GciTsNbContinue, so a non-blocking Resume needs a worker thread (tracked).
 */

// Poll cadence: start tight (steps usually finish in a few ms), then back off so
// a genuinely long operation doesn't busy-spin.
const BACKOFF_INTERVALS = [10, 10, 20, 40, 80, 160, 320, 500];
const MAX_INTERVAL = 500;
// Only surface a progress UI once an operation is clearly slow, so the common
// fast step never flashes a notification.
const PROGRESS_THRESHOLD_MS = 2000;

/** Thrown when the user cancels (hard-breaks) a non-blocking GemStone call. */
export class NbCancelledError extends Error {
  constructor(message = 'GemStone operation cancelled') {
    super(message);
    this.name = 'NbCancelledError';
  }
}

/**
 * Whether a started non-blocking call's result is ready: 1 = ready, 0 = pending,
 * -1 = error. Uses GciTsNbPoll when available (3.7+); otherwise polls the session
 * socket directly (GciTsSocket + native poll), exactly as the GciTsNbResult docs
 * prescribe for older servers.
 */
export function pollNbResultReady(session: ActiveSession): { result: number; err: GciError } {
  if (session.gci.isAvailable('GciTsNbPoll')) {
    return session.gci.GciTsNbPoll(session.handle, 0);
  }
  const { fd, err } = session.gci.GciTsSocket(session.handle);
  if (err.number !== 0 || fd < 0) {
    return { result: -1, err };
  }
  const ready = pollReadable(fd, 0);
  return {
    result: ready,
    err: ready === -1
      ? ({ number: -1, message: 'Failed to poll the GemStone session socket' } as GciError)
      : err,
  };
}

export interface NbRunOptions {
  /** Progress-notification title shown only if the call runs past ~2s. */
  title?: string;
}

/**
 * Poll an ALREADY-STARTED non-blocking GemStone call to completion without
 * blocking the extension host.
 *
 * @param onReady reads the result once polling reports it's ready (typically
 *                `GciTsNbResult`) and returns the caller's value; may throw to
 *                signal failure.
 *
 * If the call outlives `PROGRESS_THRESHOLD_MS`, a cancellable progress
 * notification appears: the first cancel sends a soft break and updates the
 * notification so the user can see it registered; a second sends a hard break
 * and rejects with `NbCancelledError`.
 */
export function pollNbToCompletion<T>(
  session: ActiveSession,
  onReady: () => T,
  opts: NbRunOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let pollIndex = 0;
    let elapsedMs = 0;
    let progressShown = false;
    let softBreakSent = false;
    let progressResolve: (() => void) | null = null;

    const finishProgress = (): void => {
      if (progressResolve) {
        progressResolve();
        progressResolve = null;
      }
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      finishProgress();
      fn();
    };

    const doPoll = (): void => {
      if (settled) return;
      const { result: pollResult, err: pollErr } = pollNbResultReady(session);

      if (pollResult === 1) {
        settle(() => {
          try { resolve(onReady()); } catch (e) { reject(e); }
        });
        return;
      }
      if (pollResult === -1) {
        settle(() => reject(new Error(pollErr.message || `GemStone poll error ${pollErr.number}`)));
        return;
      }

      const interval = pollIndex < BACKOFF_INTERVALS.length ? BACKOFF_INTERVALS[pollIndex] : MAX_INTERVAL;
      pollIndex++;
      elapsedMs += interval;

      if (elapsedMs >= PROGRESS_THRESHOLD_MS && !progressShown) {
        progressShown = true;
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: opts.title ?? 'GemStone: working…',
            cancellable: true,
          },
          (progress, token) => {
            token.onCancellationRequested(() => {
              if (!softBreakSent) {
                // First cancel: soft break — ask the gem to stop at a safe point —
                // and acknowledge it so the user knows the click registered.
                session.gci.GciTsBreak(session.handle, false);
                softBreakSent = true;
                progress.report({ message: 'Soft break sent — waiting for the gem to stop…' });
              } else {
                // Second cancel: hard break — interrupt now and give up on the call.
                session.gci.GciTsBreak(session.handle, true);
                settle(() => reject(new NbCancelledError()));
              }
            });
            return new Promise<void>(res => { progressResolve = res; });
          },
        );
      }

      setTimeout(doPoll, interval);
    };

    doPoll();
  });
}

/**
 * Start a non-blocking GemStone call and poll it to completion.
 *
 * @param start issues the `GciTsNb…` call; returns `{ success, err }`. A failed
 *              start rejects without polling.
 * @param onReady see {@link pollNbToCompletion}.
 */
export function runNbCall<T>(
  session: ActiveSession,
  start: () => { success: boolean; err: GciError },
  onReady: () => T,
  opts: NbRunOptions = {},
): Promise<T> {
  const { success, err } = start();
  if (!success) {
    return Promise.reject(new Error(err.message || `GemStone error ${err.number}`));
  }
  return pollNbToCompletion(session, onReady, opts);
}
