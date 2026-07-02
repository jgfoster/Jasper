// Setup file for the 'gci' project — trace-log cleanup.
//
// The GciTsGemTrace test (gciAsync.test.ts) turns GCI tracing on, so the GCI
// library writes gci<pid>trace.log file(s) into the working directory (flushed
// on session close). Remove them so a clean on-demand run leaves nothing behind
// — but KEEP them when any test failed, so a failing run's trace survives for
// debugging.
//
// Two subtleties this handles:
//   - Timing: the logs are flushed slightly after the trace test's file
//     finishes, so cleanup runs after EVERY file (afterAll); the last file's
//     afterAll, near worker exit, reliably clears late-flushed logs.
//   - Cross-file failure signal: vitest isolates each file's module context, so
//     an in-memory "did anything fail" flag doesn't survive across files. We
//     record failure via an on-disk marker instead, which every file's afterAll
//     can see. gciTraceGlobalSetup.ts clears a stale marker before the run.
import { afterEach, afterAll } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE_KEEP_MARKER, removeTraceLogs } from './gciTraceGlobalSetup';

const markerPath = (): string => join(process.cwd(), TRACE_KEEP_MARKER);

afterEach((ctx) => {
  if (ctx.task.result?.state === 'fail') {
    try {
      writeFileSync(markerPath(), '');
    } catch {
      // Best-effort; if we can't write the marker we fall back to cleaning up.
    }
  }
});

afterAll(() => {
  if (existsSync(markerPath())) {
    return; // a test failed this run — keep the trace logs for debugging
  }

  removeTraceLogs(process.cwd());
});
