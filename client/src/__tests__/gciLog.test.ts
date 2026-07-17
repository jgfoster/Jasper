import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { window } from 'vscode';
import {
  getGciLog,
  logQuery,
  logResult,
  logError,
  logInfo,
  logGciCall,
  _resetGciLogForTests,
} from '../gciLog';

/** The lines appended to the singleton channel, in order. */
function loggedLines(): string[] {
  const channel = getGciLog();
  return vi.mocked(channel.appendLine).mock.calls.map((c) => c[0] as string);
}

describe('gciLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGciLogForTests();
    vi.useFakeTimers();
    // A fixed wall-clock so timestamps are deterministic.
    vi.setSystemTime(new Date(2026, 6, 5, 14, 3, 9, 87));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the channel "GemStone GCI"', () => {
    getGciLog();
    expect(window.createOutputChannel).toHaveBeenCalledWith('GemStone GCI');
  });

  it('prefixes each entry with the current wall-clock time', () => {
    logQuery(1, 'Display It', '3 + 4');
    expect(loggedLines()[0]).toBe('[14:03:09.087] [Session 1] Display It');
  });

  it('pads the timestamp components to a stable width', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 9, 5, 3, 7));
    logInfo('boot');
    expect(loggedLines()[0]).toBe('[09:05:03.007] boot');
  });

  it('reports the time spent between a query and its result', () => {
    logQuery(1, 'Display It', '(Delay forSeconds: 1) wait');
    vi.advanceTimersByTime(1234);
    logResult(1, '42');

    const resultLine = loggedLines().find((l) => l.includes('→'))!;
    expect(resultLine).toContain('(1234 ms)');
    expect(resultLine).toContain('→ 42');
  });

  it('reports the time spent when a call ends in an error', () => {
    logQuery(1, 'Execute It', 'nil foo');
    vi.advanceTimersByTime(50);
    logError(1, 'a MessageNotUnderstood occurred');

    const errorLine = loggedLines().find((l) => l.includes('ERROR'))!;
    expect(errorLine).toContain('(50 ms)');
    expect(errorLine).toContain('ERROR: a MessageNotUnderstood occurred');
  });

  it('omits a duration for an error that was not preceded by a query', () => {
    logError(7, 'standalone failure');

    const errorLine = loggedLines()[0];
    expect(errorLine).not.toMatch(/\(\d+ ms\)/);
    expect(errorLine).toBe('[14:03:09.087] [Session 7] ERROR: standalone failure');
  });

  it('measures each session independently when calls interleave', () => {
    logQuery(1, 'A', 'a');
    vi.advanceTimersByTime(10);
    logQuery(2, 'B', 'b');
    vi.advanceTimersByTime(5); // session 1 now at 15ms, session 2 at 5ms
    logResult(1, 'x');
    logResult(2, 'y');

    const lines = loggedLines();
    expect(lines.find((l) => l.includes('→ x'))).toContain('(15 ms)');
    expect(lines.find((l) => l.includes('→ y'))).toContain('(5 ms)');
  });

  it('does not attribute a duration to a second result once the start is consumed', () => {
    logQuery(1, 'A', 'a');
    logResult(1, 'first');
    logResult(1, 'second');

    const results = loggedLines().filter((l) => l.includes('→'));
    expect(results[0]).toMatch(/\(\d+ ms\)/);
    expect(results[1]).not.toMatch(/\(\d+ ms\)/);
  });

  it('timestamps a lower-level GCI call line', () => {
    logGciCall(1, 'GciTsExecuteFetchBytes', { sourceSize: -1 });
    expect(loggedLines()[0]).toBe(
      '[14:03:09.087] [Session 1] GCI: GciTsExecuteFetchBytes(sourceSize: -1)',
    );
  });
});
