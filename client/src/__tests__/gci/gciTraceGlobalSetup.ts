// globalSetup for the 'gci' project — start each run from a clean slate.
//
// Removes any leftover trace logs and the failure marker from a PRIOR run, so a
// stale marker can't make this run keep (or a stale log linger). The per-file
// cleanup that decides keep-vs-delete for THIS run lives in gciTraceCleanup.ts.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const TRACE_KEEP_MARKER = '.gci-trace-keep';

// Delete every gci<pid>trace.log in dir. Shared by globalSetup (start-of-run
// wipe) and gciTraceCleanup's afterAll (post-run cleanup) so the naming pattern
// lives in exactly one place.
export function removeTraceLogs(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (/^gci\d+trace\.log$/.test(name)) {
      rmSync(join(dir, name), { force: true });
    }
  }
}

export default function setup(): void {
  const dir = process.cwd();
  rmSync(join(dir, TRACE_KEEP_MARKER), { force: true });
  removeTraceLogs(dir);
}
