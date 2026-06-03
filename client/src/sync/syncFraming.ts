// Parsers for the two payloads exchanged by the incremental class-sync engine.
//
// Both payloads are produced server-side as a single GemStone String and pulled
// to the client through the chunked transport (see syncTransport.ts). The
// transport reassembles the exact code points the server emitted, so parsing
// happens here on the fully reassembled string.
//
// Two formats:
//   Manifest  — line oriented, used to diff what changed:
//       D \t <dictIndex> \t <dictName>
//       C \t <dictIndex> \t <className> \t <md5-decimal>
//   Content   — length framed, carries class source whose body contains
//       newlines, tabs and '%' / '!' from Topaz, so we never scan the body:
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
}

export interface ClassSource {
  dictIndex: number;
  className: string;
  source: string;
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
  for (const line of payload.split('\n')) {
    if (line.length === 0) continue;
    const p = line.split('\t');
    if (p[0] === 'D' && p.length >= 3) {
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
  return { dictionaries, classes };
}

export function parseContent(payload: string): ClassSource[] {
  const out: ClassSource[] = [];
  let i = 0;
  const n = payload.length;
  while (i < n) {
    const nl = payload.indexOf('\n', i);
    if (nl < 0) break; // malformed / truncated tail — stop rather than guess
    const header = payload.slice(i, nl);
    const parts = header.split('\t');
    if (parts.length < 3) break;
    const dictIndex = parseInt(parts[0], 10);
    const className = parts[1];
    const charLen = parseInt(parts[2], 10);
    if (Number.isNaN(charLen)) break;
    const { end, text } = takeCodePoints(payload, nl + 1, charLen);
    out.push({ dictIndex, className, source: text });
    i = end;
  }
  return out;
}
