import { describe, it, expect } from 'vitest';
import { fetchBlob, LimitExecutor, TransportStats } from '../syncTransport';
import { SYNC_BLOB_KEY } from '../syncProtocol';

// A fake GemStone that understands just enough of the prepare/fetch/release
// protocol to exercise the transport: it evaluates the build expression to a
// known payload, stores it under the blob key, and serves code-point slices.
function makeFakeGem(payload: string): { exec: LimitExecutor } {
  let stored: string | null = null;
  const cps = [...payload]; // array of code points

  const exec: LimitExecutor = (label, code, _maxBytes) => {
    if (label.endsWith(':prepare')) {
      // chunk size is encoded in the prepare code as `min: <n>` / `> <n>`
      const m = code.match(/firstEnd := payload size min: (\d+)/);
      const chunk = m ? parseInt(m[1], 10) : cps.length;
      if (cps.length > chunk) stored = payload;
      const first = cps.slice(0, Math.min(chunk, cps.length)).join('');
      return `${cps.length}\n${first}`;
    }
    if (label.endsWith(':fetch')) {
      const m = code.match(/copyFrom: (\d+) to: (\d+)/);
      const start = parseInt(m![1], 10);
      const end = parseInt(m![2], 10);
      const src = stored ?? '';
      return [...src].slice(start - 1, end).join('');
    }
    if (label.endsWith(':release')) {
      stored = null;
      return '';
    }
    throw new Error(`unexpected label ${label}`);
  };
  return { exec };
}

describe('fetchBlob', () => {
  it('returns a payload that fits in one chunk with a single round trip', () => {
    const { exec } = makeFakeGem('small payload');
    const stats: TransportStats = { roundTrips: 0, chars: 0 };
    const out = fetchBlob(exec, 'manifest', 'BUILD', { chunkChars: 1000 }, stats);
    expect(out).toBe('small payload');
    expect(stats.roundTrips).toBe(1); // prepare only, nothing stored/released
    expect(stats.chars).toBe('small payload'.length);
  });

  it('streams a large payload across chunks and releases', () => {
    const payload = 'x'.repeat(25);
    const { exec } = makeFakeGem(payload);
    const stats: TransportStats = { roundTrips: 0, chars: 0 };
    const out = fetchBlob(exec, 'content', 'BUILD', { chunkChars: 10 }, stats);
    expect(out).toBe(payload);
    // 25 chars / 10 = first chunk (prepare) + 2 fetches + 1 release
    expect(stats.roundTrips).toBe(4);
    expect(stats.chars).toBe(25);
  });

  it('reassembles astral characters split across chunk boundaries by code point', () => {
    // Each 😀 is one code point; slicing by code point must not split surrogates.
    const payload = '😀😀😀😀😀'; // 5 code points, 10 UTF-16 units
    const { exec } = makeFakeGem(payload);
    const out = fetchBlob(exec, 'content', 'BUILD', { chunkChars: 2 });
    expect(out).toBe(payload);
    expect([...out].length).toBe(5);
  });

  it('handles an empty payload', () => {
    const { exec } = makeFakeGem('');
    const stats: TransportStats = { roundTrips: 0, chars: 0 };
    const out = fetchBlob(exec, 'manifest', 'BUILD', { chunkChars: 10 }, stats);
    expect(out).toBe('');
    expect(stats.roundTrips).toBe(1);
  });

  it('uses the configured blob key in generated code', () => {
    // Guards against drift between protocol code and the transport's parsing.
    let prepareCodeSeen = '';
    const exec: LimitExecutor = (label, code) => {
      if (label.endsWith(':prepare')) { prepareCodeSeen = code; return '0\n'; }
      return '';
    };
    fetchBlob(exec, 'manifest', 'BUILD');
    expect(prepareCodeSeen).toContain(SYNC_BLOB_KEY);
  });
});
