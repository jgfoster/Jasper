import { describe, it, expect } from 'vitest';
import {
  takeCodePoints, parseManifest, parseContent,
} from '../syncFraming';

describe('takeCodePoints', () => {
  it('takes whole code points for BMP text', () => {
    const r = takeCodePoints('hello world', 0, 5);
    expect(r.text).toBe('hello');
    expect(r.end).toBe(5);
  });

  it('treats an astral character as one code point spanning two UTF-16 units', () => {
    // 😀 (U+1F600) is two UTF-16 code units but one code point.
    const s = 'a😀b';
    expect(s.length).toBe(4); // UTF-16 length
    const r = takeCodePoints(s, 0, 2); // 'a' + emoji
    expect(r.text).toBe('a😀');
    expect(r.end).toBe(3); // advanced past the surrogate pair
  });

  it('stops at end of string when count exceeds available code points', () => {
    const r = takeCodePoints('ab', 0, 99);
    expect(r.text).toBe('ab');
    expect(r.end).toBe(2);
  });
});

describe('parseManifest', () => {
  it('parses dictionary and class lines', () => {
    const payload = [
      'D\t1\tUserGlobals',
      'C\t1\tFoo\t123',
      'C\t1\tBar\t456',
      'D\t2\tGlobals',
      'C\t2\tArray\t789',
      '',
    ].join('\n');
    const m = parseManifest(payload);
    expect(m.dictionaries).toEqual([
      { dictIndex: 1, dictName: 'UserGlobals' },
      { dictIndex: 2, dictName: 'Globals' },
    ]);
    expect(m.classes).toEqual([
      { dictIndex: 1, dictName: 'UserGlobals', className: 'Foo', hash: '123' },
      { dictIndex: 1, dictName: 'UserGlobals', className: 'Bar', hash: '456' },
      { dictIndex: 2, dictName: 'Globals', className: 'Array', hash: '789' },
    ]);
  });

  it('keeps empty dictionaries (no class lines)', () => {
    const m = parseManifest('D\t3\tPublished\n');
    expect(m.dictionaries).toEqual([{ dictIndex: 3, dictName: 'Published' }]);
    expect(m.classes).toEqual([]);
  });
});

describe('parseContent', () => {
  it('parses length-framed records whose bodies contain newlines and tabs', () => {
    const body1 = 'line one\nline two\n\twith tab\n';
    const body2 = '! topaz %\nstuff';
    const payload =
      `1\tFoo\t${[...body1].length}\n${body1}` +
      `2\tBar\t${[...body2].length}\n${body2}`;
    const records = parseContent(payload);
    expect(records).toEqual([
      { dictIndex: 1, className: 'Foo', source: body1 },
      { dictIndex: 2, className: 'Bar', source: body2 },
    ]);
  });

  it('round-trips a body containing astral characters using code-point length', () => {
    const body = 'comment with 😀 emoji and é accents';
    const codePointLen = [...body].length; // what GemStone String size reports
    const payload = `1\tEmojiClass\t${codePointLen}\n${body}`;
    const records = parseContent(payload);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe(body);
  });

  it('returns empty for empty payload', () => {
    expect(parseContent('')).toEqual([]);
  });

  it('stops cleanly on a truncated tail rather than throwing', () => {
    // header with no following newline
    expect(parseContent('1\tFoo')).toEqual([]);
  });
});
