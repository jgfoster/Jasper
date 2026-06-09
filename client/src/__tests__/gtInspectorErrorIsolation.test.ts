import { describe, it, expect, vi } from 'vitest';
import { fetchObjectMeta } from '../queries/getGtViewSpecs';

// gtExecute is private — tested here through fetchObjectMeta (simplest exported
// function with no selector validation to interfere with error path coverage).

describe('gtExecute error isolation', () => {
  it('wraps user code in AbstractException handler before sending to GemStone', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '{}');
    fetchObjectMeta(execute, 1000n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('on: AbstractException do:');
    expect(code).toContain("'GtError:'");
  });

  it('returns null for "GtError:" with no message', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:');
    expect(fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('returns null for "GtError:" with a message', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:something went wrong');
    expect(fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('passes through an empty string result — not treated as null', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '');
    expect(fetchObjectMeta(execute, 1000n)).toBe('');
  });

  it('returns null when execute throws a JavaScript error', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('GCI connection lost'); });
    expect(fetchObjectMeta(execute, 1000n)).toBeNull();
  });
});
