import { describe, it, expect } from 'vitest';
import {
  wrapWithTranscriptCapture, unwrapTranscriptCapture, transcriptCaptureUserCodeOffset,
  TRANSCRIPT_CAPTURE_PREFIX,
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

  describe('transcriptCaptureUserCodeOffset', () => {
    it('is the prefix length for wrapped source with no leading whitespace', () => {
      const wrapped = wrapWithTranscriptCapture('JasperDebugDemo new run').wrappedCode;
      expect(transcriptCaptureUserCodeOffset(wrapped)).toBe(TRANSCRIPT_CAPTURE_PREFIX.length);
    });

    it('shifts a wrapped-coordinate offset onto the displayed (unwrapped) source', () => {
      // The contract the debugger relies on: a server offset minus this shift
      // indexes the unwrapped source at the same character.
      const code = 'JasperDebugDemo new run';
      const wrapped = wrapWithTranscriptCapture(code).wrappedCode;
      const shift = transcriptCaptureUserCodeOffset(wrapped);
      const displayed = unwrapTranscriptCapture(wrapped);
      const wrappedOffset = wrapped.indexOf('run');         // a step point in user code
      expect(displayed[wrappedOffset - shift]).toBe('r');    // lands on the same char
      expect(displayed.slice(wrappedOffset - shift)).toBe('run');
    });

    it('accounts for whitespace trimmed from both the whole source and the inner code', () => {
      const inner = '  6 * 7';   // leading whitespace inside the block, trimmed on display
      const wrapped = `\n${wrapWithTranscriptCapture(inner).wrappedCode}\n`;
      const shift = transcriptCaptureUserCodeOffset(wrapped);
      const displayed = unwrapTranscriptCapture(wrapped);    // '6 * 7'
      const wrappedOffset = wrapped.indexOf('* 7');
      expect(displayed.slice(wrappedOffset - shift)).toBe('* 7');
    });

    it('is 0 for non-wrapped source (raw Debug It / 1:1 method shown unmodified)', () => {
      expect(transcriptCaptureUserCodeOffset('JasperDebugDemo new run')).toBe(0);
      expect(transcriptCaptureUserCodeOffset(`${TRANSCRIPT_CAPTURE_PREFIX}no suffix`)).toBe(0);
    });
  });
});
