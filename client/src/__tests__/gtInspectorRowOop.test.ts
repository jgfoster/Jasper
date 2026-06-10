import { describe, it, expect, vi } from 'vitest';
import { fetchGtRowOop, fetchGtForwardRowOop } from '../queries/getGtViewSpecs';

type RowOopFn = (execute: ReturnType<typeof vi.fn>, oop: bigint, selector: string, nodeId: number) => bigint | null;

describe.each([
  { name: 'fetchGtRowOop', fn: fetchGtRowOop as unknown as RowOopFn },
  { name: 'fetchGtForwardRowOop', fn: fetchGtForwardRowOop as unknown as RowOopFn },
])('$name', ({ fn }) => {
  it('returns a bigint OOP on happy path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '12345');
    expect(fn(execute, 1000n, 'gtItemsFor:', 5)).toBe(12345n);
  });

  it('returns null when Smalltalk error handler returns empty string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '');
    expect(fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when result is non-numeric — BigInt() throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not a number');
    expect(fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtItemsFor:');
    expect(fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    expect(fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when selector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '12345');
    expect(fn(execute, 1000n, 'bad selector!', 5)).toBeNull();
  });

  it('embeds oop, selector, and nodeId in emitted Smalltalk', () => {
    expect.assertions(3);
    const execute = vi.fn(() => '12345');
    fn(execute, 99999n, 'gtItemsFor:', 7);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
    expect(code).toContain('7');
  });
});
