import { describe, it, expect } from 'vitest';
import { takeCodePoints, parseManifest, parseContent } from '../syncFraming';

describe('takeCodePoints', () => {
  it('takes whole code points for BMP text', () => {
    const r = takeCodePoints('hello world', 0, 5);
    expect(r.text).toBe('hello');
    expect(r.end).toBe(5);
  });

  it('treats an astral character as one code point spanning two UTF-16 units', () => {
    const s = 'a😀b'; // 😀 (U+1F600) is two UTF-16 units but one code point.
    expect(s.length).toBe(4);
    const r = takeCodePoints(s, 0, 2); // 'a' + emoji
    expect(r.text).toBe('a😀');
    expect(r.end).toBe(3);
  });

  it('stops at end of string when count exceeds available code points', () => {
    const r = takeCodePoints('ab', 0, 99);
    expect(r.text).toBe('ab');
    expect(r.end).toBe(2);
  });
});

describe('parseManifest', () => {
  it('parses the summary, dictionary, and class lines', () => {
    const payload = [
      'S\t3\t99',
      'D\t1\tUserGlobals',
      'C\t1\tFoo\t123',
      'C\t1\tBar\t456',
      'D\t2\tGlobals',
      'C\t2\tArray\t789',
      '',
    ].join('\n');
    const m = parseManifest(payload);
    expect(m.classCount).toBe(3);
    expect(m.methodCount).toBe(99);
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

  it('reports null counts when there is no summary line', () => {
    const m = parseManifest('D\t3\tPublished\n');
    expect(m.classCount).toBeNull();
    expect(m.methodCount).toBeNull();
    expect(m.dictionaries).toEqual([{ dictIndex: 3, dictName: 'Published' }]);
    expect(m.classes).toEqual([]);
  });
});

describe('parseContent', () => {
  it('parses a count header then length-framed records with newlines/tabs in bodies', () => {
    const body1 = 'line one\nline two\n\twith tab\n';
    const body2 = '! topaz %\nstuff';
    const payload =
      'N\t2\t5\n' +
      `1\tFoo\t${[...body1].length}\n${body1}` +
      `2\tBar\t${[...body2].length}\n${body2}`;
    const r = parseContent(payload);
    expect(r.error).toBeNull();
    expect(r.declaredCount).toBe(2);
    expect(r.declaredMethods).toBe(5);
    expect(r.records).toEqual([
      { dictIndex: 1, className: 'Foo', source: body1 },
      { dictIndex: 2, className: 'Bar', source: body2 },
    ]);
  });

  it('round-trips a body with astral + accented characters using code-point length', () => {
    const body = 'comment with 😀 emoji and é accents';
    const payload = `N\t1\t0\n1\tEmojiClass\t${[...body].length}\n${body}`;
    const r = parseContent(payload);
    expect(r.error).toBeNull();
    expect(r.records).toHaveLength(1);
    expect(r.records[0].source).toBe(body);
  });

  it('parses without a count header (back-compat)', () => {
    const r = parseContent('1\tFoo\t1\nx');
    expect(r.declaredCount).toBeNull();
    expect(r.error).toBeNull();
    expect(r.records).toEqual([{ dictIndex: 1, className: 'Foo', source: 'x' }]);
  });

  it('returns an empty, error-free result for empty payload', () => {
    const r = parseContent('');
    expect(r.records).toEqual([]);
    expect(r.error).toBeNull();
  });

  it('flags a count mismatch instead of silently dropping records', () => {
    // Declares 2 records but only one well-formed record follows.
    const r = parseContent('N\t2\t0\n1\tFoo\t1\nx');
    expect(r.records).toHaveLength(1);
    expect(r.error).toMatch(/count mismatch/);
  });

  it('flags a truncated tail rather than dropping silently', () => {
    const r = parseContent('N\t1\t0\n1\tFoo'); // header with no newline
    expect(r.error).not.toBeNull();
  });
});
