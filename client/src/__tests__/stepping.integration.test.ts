import { describe, it, expect, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import { acquireStepping, releaseStepping } from '../debugQueries';

/**
 * Automatic GCI integration tests for the debugger's native-code toggle: a
 * breakpoint on a benign kernel method that flips the gem to interpreted
 * execution so single-stepping works. Running against the live stone proves
 * the toggle method exists on every supported GemStone version (the previous
 * choice, GsSshSocket, silently didn't on 3.6.x) — setNativeCodeBreak only
 * logs on failure, so the breakpoint's presence is what must be asserted.
 */
describe('debugger native-code toggle (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => { gci = testContext.gciLibrary; handle = testContext.session; });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const sessionHasBreakpoints = (): boolean =>
    q.executeFetchString(session(), 'breakpoint check', 'GsNMethod _hasBreakpoints printString').trim() === 'true';

  it('sets the toggle breakpoint while a debugger holds stepping and clears it on release', () => {
    acquireStepping(session());

    expect(sessionHasBreakpoints()).toBe(true);

    releaseStepping(session());

    expect(sessionHasBreakpoints()).toBe(false);
  });

  it('keeps the toggle breakpoint until the last of several concurrent debuggers releases it', () => {
    acquireStepping(session());
    acquireStepping(session());

    releaseStepping(session());

    expect(sessionHasBreakpoints()).toBe(true);

    releaseStepping(session());

    expect(sessionHasBreakpoints()).toBe(false);
  });
});
