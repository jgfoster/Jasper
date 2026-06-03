// Chunked transport: pull one server-built payload to the client, regardless of
// size, with the small case costing a single round trip.
//
// The executor runs a Smalltalk string and returns the (UTF-8 decoded) result,
// with a caller-chosen result-buffer size. Offsets are GemStone code points; the
// server slices on code-point boundaries so each chunk decodes losslessly and
// plain string concatenation reproduces the payload exactly.

import {
  prepareCode, fetchCode, releaseCode, SYNC_CHUNK_CHARS, SYNC_MAX_RESULT_BYTES,
} from './syncProtocol';

export type LimitExecutor = (label: string, code: string, maxBytes: number) => string;

export interface TransportStats {
  roundTrips: number;
  chars: number;
}

export interface TransportOptions {
  chunkChars?: number;
  maxBytes?: number;
}

// Build `buildExpr` server-side and return the full payload string.
export function fetchBlob(
  exec: LimitExecutor,
  label: string,
  buildExpr: string,
  opts: TransportOptions = {},
  stats?: TransportStats,
): string {
  const chunkChars = opts.chunkChars ?? SYNC_CHUNK_CHARS;
  const maxBytes = opts.maxBytes ?? SYNC_MAX_RESULT_BYTES;

  const prep = exec(`${label}:prepare`, prepareCode(buildExpr, chunkChars), maxBytes);
  if (stats) stats.roundTrips++;

  const nl = prep.indexOf('\n');
  const total = nl < 0 ? 0 : parseInt(prep.slice(0, nl), 10) || 0;
  let payload = nl < 0 ? '' : prep.slice(nl + 1);

  // Code points consumed so far. The first chunk holds min(chunkChars, total)
  // code points by construction, so we track the offset from what we requested
  // rather than measuring the (UTF-16) JS string length.
  let offset = Math.min(chunkChars, total);

  // Everything fit in the first chunk — the server stored nothing to release.
  if (offset >= total) {
    if (stats) stats.chars = total;
    return payload;
  }

  while (offset < total) {
    const start = offset + 1; // GemStone copyFrom: is 1-based
    const end = Math.min(offset + chunkChars, total);
    payload += exec(`${label}:fetch`, fetchCode(start, end), maxBytes);
    if (stats) stats.roundTrips++;
    offset = end;
  }

  exec(`${label}:release`, releaseCode(), 1024);
  if (stats) stats.roundTrips++;
  if (stats) stats.chars = total;
  return payload;
}
