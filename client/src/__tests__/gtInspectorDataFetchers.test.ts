import { describe, it, expect, vi } from 'vitest';
import { fetchGtListTotal, fetchGtListData, fetchGtTextData, fetchGtPrintTabData, fetchGtForwardListData, fetchGtForwardListTotal, fetchGtTreeChildren } from '../queries/getGtViewSpecs';

describe('fetchGtListTotal', () => {
  it('returns count as a number on happy path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '42');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBe(42);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtItemsFor:');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('returns null when response is not a number', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not a number');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('returns null when response is an empty string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBeNull();
  });

  it('handles whitespace in response', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '  42\n');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBe(42);
  });

  it('returns 0 when response is "0" — valid count, not treated as falsy', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '0');
    expect(fetchGtListTotal(execute, 1000n, 'gtItemsFor:')).toBe(0);
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '42');
    expect(fetchGtListTotal(execute, 1000n, 'bad selector!')).toBeNull();
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '0');
    fetchGtListTotal(execute, 99999n, 'gtItemsFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
  });
});

describe('fetchGtListData', () => {
  it('returns JSON string on happy path without modification', () => {
    expect.assertions(1);
    const json = '[{"col1":"foo"},{"col1":"bar"}]';
    const execute = vi.fn(() => json);
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBe(json);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtItemsFor:');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, 100)).toBeNull();
  });

  it('embeds oop, methodSelector, fromIndex, and count in emitted Smalltalk', () => {
    expect.assertions(4);
    const execute = vi.fn(() => '[]');
    fetchGtListData(execute, 99999n, 'gtItemsFor:', 1, 50);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
    expect(code).toContain('1');
    expect(code).toContain('50');
  });

  it('returns null when fromIndex is 0 — below valid 1-based range', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 0, 100)).toBeNull();
  });

  it('returns null when count is 0', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, 0)).toBeNull();
  });

  it('returns null when fromIndex is negative', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', -1, 100)).toBeNull();
  });

  it('returns null when fromIndex is a float', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1.5, 100)).toBeNull();
  });

  it('returns null when count is negative', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, -1)).toBeNull();
  });

  it('returns null when count is a float', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, 1.5)).toBeNull();
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'bad selector!', 1, 100)).toBeNull();
  });

  it('passes through very large count — no upper bound validation', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtListData(execute, 1000n, 'gtItemsFor:', 1, Number.MAX_SAFE_INTEGER)).not.toBeNull();
  });
});

describe('fetchGtTextData', () => {
  it('returns the text data JSON string on happy path', () => {
    expect.assertions(1);
    const json = '{"string":"hello world","truncated":false}';
    const execute = vi.fn(() => json);
    expect(fetchGtTextData(execute, 1000n, 'gtTextFor:')).toBe(json);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtTextFor:');
    expect(fetchGtTextData(execute, 1000n, 'gtTextFor:')).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    expect(fetchGtTextData(execute, 1000n, 'gtTextFor:')).toBeNull();
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '{}');
    expect(fetchGtTextData(execute, 1000n, 'bad selector!')).toBeNull();
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '{}');
    fetchGtTextData(execute, 99999n, 'gtTextFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtTextFor:');
  });
});

describe('fetchGtPrintTabData', () => {
  it('returns data and truncated:false on happy path', () => {
    expect.assertions(2);
    const json = '{"string":"hello world","truncated":false}';
    const execute = vi.fn(() => json);
    const result = fetchGtPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(json);
    expect(result.truncated).toBe(false);
  });

  it('returns data and truncated:true when JSON reports truncation', () => {
    expect.assertions(2);
    const json = '{"string":"hello wo...","truncated":true}';
    const execute = vi.fn(() => json);
    const result = fetchGtPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(json);
    expect(result.truncated).toBe(true);
  });

  it('returns data and truncated:false when JSON.parse fails on malformed response', () => {
    expect.assertions(2);
    const badJson = 'not valid json {{{';
    const execute = vi.fn(() => badJson);
    const result = fetchGtPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBe(badJson);
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when execute returns a GtError string', () => {
    expect.assertions(2);
    const execute = vi.fn(() => 'GtError:does not understand #gtPrintTabFor:');
    const result = fetchGtPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when execute throws', () => {
    expect.assertions(2);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    const result = fetchGtPrintTabData(execute, 1000n, 'gtPrintTabFor:');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('returns null data and truncated:false when methodSelector is invalid', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '{}');
    const result = fetchGtPrintTabData(execute, 1000n, 'bad selector!');
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '{}');
    fetchGtPrintTabData(execute, 99999n, 'gtPrintTabFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtPrintTabFor:');
  });
});

describe('fetchGtForwardListData', () => {
  it('returns JSON string on happy path', () => {
    expect.assertions(1);
    const json = '[{"col1":"foo"},{"col1":"bar"}]';
    const execute = vi.fn(() => json);
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100)).toBe(json);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtForwardFor:');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, 100)).toBeNull();
  });

  it('returns null when forwardSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'bad selector!', 1, 100)).toBeNull();
  });

  it('returns null when fromIndex is 0', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 0, 100)).toBeNull();
  });

  it('returns null when fromIndex is negative', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', -1, 100)).toBeNull();
  });

  it('returns null when fromIndex is a float', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1.5, 100)).toBeNull();
  });

  it('returns null when count is 0', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, 0)).toBeNull();
  });

  it('returns null when count is negative', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, -1)).toBeNull();
  });

  it('returns null when count is a float', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtForwardListData(execute, 1000n, 'gtForwardFor:', 1, 1.5)).toBeNull();
  });

  it('embeds oop, forwardSelector, fromIndex, and count in emitted Smalltalk', () => {
    expect.assertions(4);
    const execute = vi.fn(() => '[]');
    fetchGtForwardListData(execute, 99999n, 'gtForwardFor:', 1, 50);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtForwardFor:');
    expect(code).toContain('1');
    expect(code).toContain('50');
  });
});

describe('fetchGtForwardListTotal', () => {
  it('returns count as a number on happy path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '42');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(42);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtForwardFor:');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBeNull();
  });

  it('returns null when response is not a number', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not a number');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBeNull();
  });

  it('returns null when response is an empty string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBeNull();
  });

  it('handles whitespace in response', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '  42\n');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(42);
  });

  it('returns 0 when response is "0" — valid count, not treated as falsy', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '0');
    expect(fetchGtForwardListTotal(execute, 1000n, 'gtForwardFor:')).toBe(0);
  });

  it('returns null when forwardSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '42');
    expect(fetchGtForwardListTotal(execute, 1000n, 'bad selector!')).toBeNull();
  });

  it('embeds oop and forwardSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '0');
    fetchGtForwardListTotal(execute, 99999n, 'gtForwardFor:');
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtForwardFor:');
  });
});

describe('fetchGtTreeChildren', () => {
  it('returns JSON string on happy path', () => {
    expect.assertions(1);
    const json = '[{"label":"child1"},{"label":"child2"}]';
    const execute = vi.fn(() => json);
    expect(fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBe(json);
  });

  it('returns null when execute returns a GtError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'GtError:does not understand #gtTreeFor:');
    expect(fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => { throw new Error('connection lost'); });
    expect(fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', [1])).toBeNull();
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    expect(fetchGtTreeChildren(execute, 1000n, 'bad selector!', [1])).toBeNull();
  });

  it('produces {} in Smalltalk for an empty path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', []);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('{}');
  });

  it('produces {1} in Smalltalk for a single-element path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', [1]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('{1}');
  });

  it('produces {1. 2. 3} in Smalltalk for a multi-element path', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '[]');
    fetchGtTreeChildren(execute, 1000n, 'gtTreeFor:', [1, 2, 3]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('{1. 2. 3}');
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '[]');
    fetchGtTreeChildren(execute, 99999n, 'gtTreeFor:', [1]);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtTreeFor:');
  });
});
