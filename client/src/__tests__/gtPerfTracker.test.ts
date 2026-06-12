import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  gtPerfTracker,
  wrapWithGtPerfProxy,
  buildGtPerfStatusBarText,
  buildGtPerfClipboardText,
  buildGtPerfQuickPickItems,
  RESET_LABEL,
  COPY_LABEL,
} from '../gtPerfTracker';
import type { GciLibrary } from '../gciLibrary';

// Reset singleton state before each test.
beforeEach(() => {
  gtPerfTracker.setEnabled(false);
  gtPerfTracker.reset();
  gtPerfTracker.onCountChanged = undefined;
});

// ── gtPerfTracker singleton ────────────────────────────────

describe('gtPerfTracker.increment', () => {
  it('does not count when disabled', () => {
    gtPerfTracker.setEnabled(false);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(gtPerfTracker.count).toBe(0);
    expect(gtPerfTracker.methodCounts.size).toBe(0);
  });

  it('increments count when enabled', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(gtPerfTracker.count).toBe(1);
  });

  it('tracks per-method counts', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsPerformFetchBytes');
    expect(gtPerfTracker.methodCounts.get('GciTsExecuteFetchBytes')).toBe(2);
    expect(gtPerfTracker.methodCounts.get('GciTsPerformFetchBytes')).toBe(1);
    expect(gtPerfTracker.count).toBe(3);
  });

  it('fires onCountChanged when enabled', () => {
    gtPerfTracker.setEnabled(true);
    const cb = vi.fn();
    gtPerfTracker.onCountChanged = cb;
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not fire onCountChanged when disabled', () => {
    gtPerfTracker.setEnabled(false);
    const cb = vi.fn();
    gtPerfTracker.onCountChanged = cb;
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('gtPerfTracker.reset', () => {
  it('clears count and methodCounts', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.reset();
    expect(gtPerfTracker.count).toBe(0);
    expect(gtPerfTracker.methodCounts.size).toBe(0);
  });

  it('fires onCountChanged', () => {
    const cb = vi.fn();
    gtPerfTracker.onCountChanged = cb;
    gtPerfTracker.reset();
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('gtPerfTracker.setEnabled', () => {
  it('enables tracking', () => {
    gtPerfTracker.setEnabled(true);
    expect(gtPerfTracker.enabled).toBe(true);
  });

  it('disabling clears count and methodCounts', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.setEnabled(false);
    expect(gtPerfTracker.count).toBe(0);
    expect(gtPerfTracker.methodCounts.size).toBe(0);
  });

  it('fires onCountChanged on enable and disable', () => {
    const cb = vi.fn();
    gtPerfTracker.onCountChanged = cb;
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ── wrapWithGtPerfProxy ────────────────────────────────────

function makeFakeGci(): GciLibrary {
  return {
    GciTsExecuteFetchBytes: vi.fn(() => ({ bytesReturned: 4, data: 'ok', err: { number: 0 } })),
    GciTsOopIsSpecial: vi.fn(() => false),
    GciTsCallInProgress: vi.fn(() => false),
  } as unknown as GciLibrary;
}

describe('wrapWithGtPerfProxy', () => {
  it('counts a round-trip method when enabled', () => {
    gtPerfTracker.setEnabled(true);
    const proxy = wrapWithGtPerfProxy(makeFakeGci());
    proxy.GciTsExecuteFetchBytes({} as never, null, -1, 0n, 0n, 0n, 1024);
    expect(gtPerfTracker.count).toBe(1);
    expect(gtPerfTracker.methodCounts.get('GciTsExecuteFetchBytes')).toBe(1);
  });

  it('does not count a round-trip method when disabled', () => {
    const proxy = wrapWithGtPerfProxy(makeFakeGci());
    proxy.GciTsExecuteFetchBytes({} as never, null, -1, 0n, 0n, 0n, 1024);
    expect(gtPerfTracker.count).toBe(0);
  });

  it('does not count a non-round-trip method even when enabled', () => {
    gtPerfTracker.setEnabled(true);
    const proxy = wrapWithGtPerfProxy(makeFakeGci());
    proxy.GciTsOopIsSpecial(0n);
    expect(gtPerfTracker.count).toBe(0);
  });

  // Regression: GciTsCallInProgress is a local session-state check called on every
  // executeFetchString guard. It must never be counted or the tracker explodes.
  it('does not count GciTsCallInProgress', () => {
    gtPerfTracker.setEnabled(true);
    const proxy = wrapWithGtPerfProxy(makeFakeGci());
    proxy.GciTsCallInProgress({} as never);
    expect(gtPerfTracker.count).toBe(0);
  });

  it('passes the return value through unchanged', () => {
    gtPerfTracker.setEnabled(true);
    const proxy = wrapWithGtPerfProxy(makeFakeGci());
    const result = proxy.GciTsExecuteFetchBytes({} as never, null, -1, 0n, 0n, 0n, 1024);
    expect(result.data).toBe('ok');
  });

  it('calls the original function', () => {
    gtPerfTracker.setEnabled(true);
    const fake = makeFakeGci();
    const proxy = wrapWithGtPerfProxy(fake);
    proxy.GciTsExecuteFetchBytes({} as never, null, -1, 0n, 0n, 0n, 1024);
    expect(fake.GciTsExecuteFetchBytes).toHaveBeenCalledOnce();
  });
});

// ── buildGtPerfStatusBarText ───────────────────────────────

describe('buildGtPerfStatusBarText', () => {
  it('formats zero count', () => {
    expect(buildGtPerfStatusBarText(0)).toBe('$(record) GT Perf: 0');
  });

  it('formats a non-zero count', () => {
    expect(buildGtPerfStatusBarText(14)).toBe('$(record) GT Perf: 14');
  });
});

// ── buildGtPerfClipboardText ───────────────────────────────

describe('buildGtPerfClipboardText', () => {
  it('shows zero total with no methods when empty', () => {
    const text = buildGtPerfClipboardText(gtPerfTracker);
    expect(text).toBe('GT Perf: 0 total GCI calls');
  });

  it('includes the total count header', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    const text = buildGtPerfClipboardText(gtPerfTracker);
    expect(text).toContain('GT Perf: 2 total GCI calls');
  });

  it('lists methods with their counts', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsPerformFetchBytes');
    const text = buildGtPerfClipboardText(gtPerfTracker);
    expect(text).toContain('  GciTsExecuteFetchBytes: 1');
    expect(text).toContain('  GciTsPerformFetchBytes: 1');
  });

  it('sorts methods by count descending', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsResolveSymbol');          // count: 1, inserted first
    gtPerfTracker.increment('GciTsPerformFetchBytes');       // count: 2, inserted second
    gtPerfTracker.increment('GciTsPerformFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');       // count: 3, inserted third
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    const lines = buildGtPerfClipboardText(gtPerfTracker).split('\n');
    expect(lines[1]).toContain('GciTsExecuteFetchBytes: 3');
    expect(lines[2]).toContain('GciTsPerformFetchBytes: 2');
    expect(lines[3]).toContain('GciTsResolveSymbol: 1');
  });
});

// ── buildGtPerfQuickPickItems ──────────────────────────────

describe('buildGtPerfQuickPickItems', () => {
  it('always has Reset Counter as first item', () => {
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(items[0].label).toBe(RESET_LABEL);
  });

  it('always has Copy to Clipboard as second item', () => {
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(items[1].label).toBe(COPY_LABEL);
  });

  it('has a separator as third item', () => {
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(items[2].isSeparator).toBe(true);
  });

  it('shows only the three fixed items when there are no method counts', () => {
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(items).toHaveLength(3);
  });

  it('Reset Counter description shows current count', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(items[0].description).toContain('2');
  });

  it('lists methods after the separator sorted by count descending', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsResolveSymbol');          // count: 1, inserted first
    gtPerfTracker.increment('GciTsPerformFetchBytes');       // count: 2, inserted second
    gtPerfTracker.increment('GciTsPerformFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');       // count: 3, inserted third
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    // items[0]=Reset, [1]=Copy, [2]=separator, [3..5]=methods high→low
    expect(items[3].label).toBe('GciTsExecuteFetchBytes');
    expect(items[3].description).toBe('3');
    expect(items[4].label).toBe('GciTsPerformFetchBytes');
    expect(items[4].description).toBe('2');
    expect(items[5].label).toBe('GciTsResolveSymbol');
    expect(items[5].description).toBe('1');
  });

  it('method descriptions are strings not numbers', () => {
    gtPerfTracker.setEnabled(true);
    gtPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildGtPerfQuickPickItems(gtPerfTracker);
    expect(typeof items[3].description).toBe('string');
  });
});
