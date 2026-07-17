import { describe, it, expect } from 'vitest';
import { pickBalancedColumn } from '../explorerColumnBalance';

describe('pickBalancedColumn', () => {
  it('asks for a new column when none hold gemstone editors yet', () => {
    expect(pickBalancedColumn(new Map())).toBe('new');
  });

  it('keeps asking for new columns until the cap is reached', () => {
    expect(
      pickBalancedColumn(
        new Map([
          [1, 2],
          [2, 1],
        ]),
        3,
      ),
    ).toBe('new');
  });

  it('reuses the least-full column once the cap is reached', () => {
    expect(
      pickBalancedColumn(
        new Map([
          [1, 3],
          [2, 1],
          [3, 2],
        ]),
        3,
      ),
    ).toBe(2);
  });

  it('breaks ties toward the leftmost column', () => {
    expect(
      pickBalancedColumn(
        new Map([
          [3, 1],
          [1, 1],
          [2, 5],
        ]),
        3,
      ),
    ).toBe(1);
  });

  it('respects a custom column cap', () => {
    expect(
      pickBalancedColumn(
        new Map([
          [1, 4],
          [2, 2],
        ]),
        2,
      ),
    ).toBe(2);
  });
});
