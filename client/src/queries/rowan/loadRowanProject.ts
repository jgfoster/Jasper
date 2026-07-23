import { escapeString } from '../util';

export interface RowanLoadResult {
  success: boolean;
  // On success, the loaded project's name; on failure, the error message.
  detail: string;
}

// Load a Rowan project into the image from an on-disk load specification, then
// commit. `specPath` is the load-spec .ston file; `diskPath` is the project's
// repository root on disk. Uses projectFromUrl:diskUrl: so the on-disk location
// (diskPath) overrides whatever the spec recorded — the project loads correctly
// even from a moved or freshly-cloned copy. On any failure the transaction is
// aborted so nothing partial is committed.
//
// Runs on the working user's own session, never SystemUser. Rowan's registry is
// per-user — `symbolList objectNamed: #'Rowan'` answers a different Rowan for
// each user — so loading as SystemUser registers the project where the browsing
// session cannot see it. (An earlier comment here claimed DataCurator lacked the
// privilege, citing objectSecurityPolicyId 1; that was false. Proven twice: a
// DataCurator load succeeds, and WebGS loads this way against a 3.7.5 stone.)
//
// The builder and result parser are exported separately (rather than composed
// into one function here) because the extension runs this long operation over
// the NON-BLOCKING execute path (executeFetchStringNb, see
// browserQueries.ts's loadRowanProjectNb) — project loads can take minutes,
// and a synchronous call would freeze the extension host for the duration.
export function buildLoadRowanProjectCode(specPath: string, diskPath: string): string {
  return `| r sep resolved name |
sep := String with: Character tab.
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^'ERR' , sep , 'Rowan is not installed in this image'].
[resolved := r projectFromUrl: 'file:${escapeString(specPath)}' diskUrl: 'file:${escapeString(diskPath)}'.
 name := [resolved name] on: Error do: [:e | '?'].
 resolved load.
 System commitTransaction]
  on: Error do: [:e | System abortTransaction. ^'ERR' , sep , e messageText].
'OK' , sep , name asString`;
}

export function parseRowanLoadResult(raw: string): RowanLoadResult {
  const tab = raw.indexOf('\t');
  const status = tab === -1 ? raw.trim() : raw.slice(0, tab);
  const detail = tab === -1 ? '' : raw.slice(tab + 1).trim();
  return { success: status === 'OK', detail };
}
