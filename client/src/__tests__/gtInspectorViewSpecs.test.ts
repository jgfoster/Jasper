import { describe, it, expect, vi } from 'vitest';
import { getGtViewSpecs } from '../queries/getGtViewSpecs';

describe('getGtViewSpecs', () => {
  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:viewed object not found');
    expect(getGtViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns null when execute returns malformed JSON', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not valid json {{{');
    expect(getGtViewSpecs(execute, 1000n)).toBeNull();
  });

  it('returns specs sorted by ascending priority', () => {
    const priorities = [50, 10, 80, 30, 70, 20, 90, 40, 60, 1];
    expect.assertions(priorities.length);
    const specs = priorities.map((priority, i) => ({
      viewName: 'GtPhlowListViewSpecification',
      title: `View${i}`,
      priority,
      methodSelector: `gtView${i}For:`,
      dataTransport: 1,
    }));
    const execute = vi.fn(() => JSON.stringify(specs));
    const result = getGtViewSpecs(execute, 1000n)!;
    const sorted = [...priorities].sort((a, b) => a - b);
    sorted.forEach((p, i) => expect(result[i].priority).toBe(p));
  });

  it('makes a second execute call to resolve a forward view spec', () => {
    expect.assertions(2);
    const specs = [
      { viewName: 'GtPhlowForwardViewSpecification', title: 'Forward', priority: 1, methodSelector: 'gtForwardFor:', dataTransport: 1 },
    ];
    const execute = vi.fn()
      .mockReturnValueOnce(JSON.stringify(specs))
      .mockReturnValueOnce(JSON.stringify({ __typeName: 'GtPhlowListViewSpecification', columnSpecifications: [] }));
    const result = getGtViewSpecs(execute, 1000n);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result![0].resolvedViewName).toBe('GtPhlowListViewSpecification');
  });

  it('embeds oop in emitted Smalltalk', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    getGtViewSpecs(execute, 99999n);
    expect(execute.mock.calls[0][1]).toContain('99999');
  });
});
