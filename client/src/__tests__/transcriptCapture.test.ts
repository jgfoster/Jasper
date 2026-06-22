import { describe, it, expect } from 'vitest';
import {
  wrapWithTranscriptCapture, unwrapTranscriptCapture, TRANSCRIPT_CAPTURE_PREFIX,
} from '../transcriptCapture';

describe('transcriptCapture', () => {
  it('wrap then unwrap is a round trip (recovers the exact user code)', () => {
    const code = 'JasperDebugDemo new run';
    const { wrappedCode } = wrapWithTranscriptCapture(code);
    expect(unwrapTranscriptCapture(wrappedCode)).toBe(code);
  });

  it('codeOffset points at where the user code begins in the wrapped source', () => {
    const code = '6 * 7';
    const { wrappedCode, codeOffset } = wrapWithTranscriptCapture(code);
    expect(codeOffset).toBe(TRANSCRIPT_CAPTURE_PREFIX.length);
    expect(wrappedCode.slice(codeOffset, codeOffset + code.length)).toBe(code);
  });

  it('unwraps multi-statement user code', () => {
    const code = '| x | x := 6 * 7.\nx printNl.\nx';
    expect(unwrapTranscriptCapture(wrapWithTranscriptCapture(code).wrappedCode)).toBe(code);
  });

  it('tolerates surrounding whitespace the compiler may add to stored source', () => {
    const wrapped = wrapWithTranscriptCapture('foo bar').wrappedCode;
    expect(unwrapTranscriptCapture(`\n${wrapped}\n`)).toBe('foo bar');
  });

  it('leaves non-wrapped source unchanged (plain doit / unrecognised glue)', () => {
    const plain = 'JasperDebugDemo new run';
    expect(unwrapTranscriptCapture(plain)).toBe(plain);
  });

  it('leaves source that only has the prefix (no matching suffix) unchanged', () => {
    const partial = `${TRANSCRIPT_CAPTURE_PREFIX}JasperDebugDemo new run`;
    expect(unwrapTranscriptCapture(partial)).toBe(partial);
  });
});
