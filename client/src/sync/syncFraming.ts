// Parsers for the two payloads exchanged by the incremental class-sync engine.
//
// Both payloads are produced server-side as a single GemStone String and pulled
// to the client through the chunked transport (see syncTransport.ts). The
// transport reassembles the exact code points the server emitted, so parsing
// happens here on the fully reassembled string.
//
// Two formats:
//   Manifest  — line oriented, used to diff what changed:
//       S \t <classCount> \t <methodCount>            (server's own count, for audit)
//       D \t <dictIndex> \t <dictName>
//       C \t <dictIndex> \t <className> \t <md5-decimal>
//   Content   — a count header then length-framed records (the source body
//       contains newlines, tabs and '%' / '!' from Topaz, so we never scan it):
//       N \t <classCount> \t <methodCount>            (for the end-of-batch audit)
//       <dictIndex> \t <className> \t <codePointLen> \n
//       <codePointLen code points of file-out source>
//       <dictIndex> \t ...                              (next record, no separator)

export interface DictEntry {
  dictIndex: number;
  dictName: string;
}

export interface ClassHashEntry {
  dictIndex: number;
  dictName: string;
  className: string;
  hash: string;
}

export interface Manifest {
  dictionaries: DictEntry[];
  classes: ClassHashEntry[];
  // From the server's `S` summary line: the counts it believes it emitted. Used
  // to detect a truncated manifest (server count ≠ parsed C-line count).
  classCount: number | null;
  methodCount: number | null;
}

export interface ClassSource {
  dictIndex: number;
  className: string;
  source: string;
}

export interface ContentParseResult {
  records: ClassSource[];
  // From the server's `N` count header (null if absent).
  declaredCount: number | null;
  declaredMethods: number | null;
  // Set when framing desyncs or the parsed count disagrees with the declared
  // count — surfaced loudly by the caller instead of silently dropping records.
  error: string | null;
}

// Advance `count` Unicode code points starting at UTF-16 index `start`, returning
// the end index and the sliced substring. A GemStone String's `size` is its
// code-point count, but a JS string indexes UTF-16 code units, so an astral
// character (emoji, rare CJK) occupies two units for one code point. Counting by
// code point keeps the framed length aligned with what the server measured.
export function takeCodePoints(
  s: string, start: number, count: number,
): { end: number; text: string } {
  let i = start;
  let taken = 0;
  const n = s.length;
  while (taken < count && i < n) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < n) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 2;
        taken++;
        continue;
      }
    }
    i += 1;
    taken++;
  }
  return { end: i, text: s.slice(start, i) };
}

export function parseManifest(payload: string): Manifest {
  const dictionaries: DictEntry[] = [];
  const nameByIndex = new Map<number, string>();
  const rawClasses: { dictIndex: number; className: string; hash: string }[] = [];
  let classCount: number | null = null;
  let methodCount: number | null = null;
  for (const line of payload.split('\n')) {
    if (line.length === 0) continue;
    const p = line.split('\t');
    if (p[0] === 'S' && p.length >= 3) {
      classCount = parseInt(p[1], 10);
      methodCount = parseInt(p[2], 10);
    } else if (p[0] === 'D' && p.length >= 3) {
      const dictIndex = parseInt(p[1], 10);
      dictionaries.push({ dictIndex, dictName: p[2] });
      nameByIndex.set(dictIndex, p[2]);
    } else if (p[0] === 'C' && p.length >= 4) {
      rawClasses.push({ dictIndex: parseInt(p[1], 10), className: p[2], hash: p[3] });
    }
  }
  // Attach each class's dictionary name (from its D line) so mirror keys survive
  // dictionary renames: a renamed dict yields new keys (old files pruned, new
  // ones fetched) without any special-casing downstream.
  const classes: ClassHashEntry[] = rawClasses.map(c => ({
    dictIndex: c.dictIndex,
    dictName: nameByIndex.get(c.dictIndex) ?? '',
    className: c.className,
    hash: c.hash,
  }));
  return { dictionaries, classes, classCount, methodCount };
}

export function parseContent(payload: string): ContentParseResult {
  const records: ClassSource[] = [];
  let declaredCount: number | null = null;
  let declaredMethods: number | null = null;
  let error: string | null = null;
  let i = 0;
  const n = payload.length;

  // Optional count header: `N \t <classes> \t <methods>`
  if (payload.startsWith('N\t')) {
    const nl = payload.indexOf('\n');
    if (nl >= 0) {
      const parts = payload.slice(0, nl).split('\t');
      declaredCount = parseInt(parts[1], 10);
      declaredMethods = parseInt(parts[2], 10);
      i = nl + 1;
    }
  }

  while (i < n) {
    const nl = payload.indexOf('\n', i);
    if (nl < 0) {
      error = `truncated record header at offset ${i}`;
      break;
    }
    const header = payload.slice(i, nl);
    const parts = header.split('\t');
    if (parts.length < 3) {
      error = `malformed record header at offset ${i}: ${JSON.stringify(header.slice(0, 80))}`;
      break;
    }
    const dictIndex = parseInt(parts[0], 10);
    const className = parts[1];
    const charLen = parseInt(parts[2], 10);
    if (Number.isNaN(charLen)) {
      error = `non-numeric record length at offset ${i}: ${JSON.stringify(header.slice(0, 80))}`;
      break;
    }
    const { end, text } = takeCodePoints(payload, nl + 1, charLen);
    records.push({ dictIndex, className, source: text });
    i = end;
  }

  if (error === null && declaredCount !== null && records.length !== declaredCount) {
    error = `record count mismatch: server declared ${declaredCount}, parsed ${records.length}`;
  }
  return { records, declaredCount, declaredMethods, error };
}
