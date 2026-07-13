import { describe, it, expect, vi } from 'vitest';
import { runStopStone, StopStoneDeps } from '../stopStoneManager';

function makeDeps(overrides: Partial<StopStoneDeps> = {}): StopStoneDeps {
  return {
    stoneName: 'gs64stone',
    hasAdminLogin: false,
    storedPassword: vi.fn(async () => undefined),
    stopStone: vi.fn(async () => ({ ok: true, message: '' })),
    promptPassword: vi.fn(async () => undefined),
    chooseEscalation: vi.fn(async () => 'cancel' as const),
    forceKill: vi.fn(async () => true),
    ...overrides,
  };
}

describe('stopping a stone', () => {
  it('uses the stored DataCurator password without prompting when it works', async () => {
    const deps = makeDeps({
      hasAdminLogin: true,
      storedPassword: vi.fn(async () => 'stored-pw'),
      stopStone: vi.fn(async () => ({ ok: true, message: '' })),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('stopped');
    expect(deps.stopStone).toHaveBeenCalledWith('stored-pw');
    expect(deps.chooseEscalation).not.toHaveBeenCalled();
    expect(deps.promptPassword).not.toHaveBeenCalled();
  });

  it('does not consult a stored password when no admin login exists', async () => {
    const deps = makeDeps({
      hasAdminLogin: false,
      chooseEscalation: vi.fn(async () => 'cancel' as const),
    });

    await runStopStone(deps);

    expect(deps.storedPassword).not.toHaveBeenCalled();
    expect(deps.chooseEscalation).toHaveBeenCalledWith(
      expect.stringContaining('No DataCurator login'),
    );
  });

  it('escalates with a distinct reason when the login carries no stored password', async () => {
    const deps = makeDeps({
      hasAdminLogin: true,
      storedPassword: vi.fn(async () => undefined),
      chooseEscalation: vi.fn(async () => 'cancel' as const),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('cancelled');
    expect(deps.stopStone).not.toHaveBeenCalled();
    expect(deps.chooseEscalation).toHaveBeenCalledWith(
      expect.stringContaining('No stored password'),
    );
  });

  it('prompts for a password and stops when the user supplies a working one', async () => {
    const deps = makeDeps({
      hasAdminLogin: false,
      chooseEscalation: vi.fn(async () => 'password' as const),
      promptPassword: vi.fn(async () => 'typed-pw'),
      stopStone: vi.fn(async () => ({ ok: true, message: '' })),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('stopped');
    expect(deps.stopStone).toHaveBeenCalledWith('typed-pw');
  });

  it('escalates after the stored password is rejected, then stops with a typed one', async () => {
    const stopStone = vi
      .fn<StopStoneDeps['stopStone']>()
      .mockResolvedValueOnce({ ok: false, message: 'login failed' })
      .mockResolvedValue({ ok: true, message: '' });
    const deps = makeDeps({
      hasAdminLogin: true,
      storedPassword: vi.fn(async () => 'stale-pw'),
      stopStone,
      chooseEscalation: vi.fn(async () => 'password' as const),
      promptPassword: vi.fn(async () => 'good-pw'),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('stopped');
    expect(stopStone.mock.calls.map((c) => c[0])).toEqual(['stale-pw', 'good-pw']);
    expect(deps.chooseEscalation).toHaveBeenCalledWith(expect.stringContaining('login failed'));
  });

  it('force-stops the stone when the user chooses to kill', async () => {
    const deps = makeDeps({
      chooseEscalation: vi.fn(async () => 'kill' as const),
      forceKill: vi.fn(async () => true),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('killed');
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('reports a failed force stop', async () => {
    const deps = makeDeps({
      chooseEscalation: vi.fn(async () => 'kill' as const),
      forceKill: vi.fn(async () => false),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('kill-failed');
  });

  it('cancels when the escalation is dismissed', async () => {
    const deps = makeDeps({ chooseEscalation: vi.fn(async () => 'cancel' as const) });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('cancelled');
  });

  it('cancels when the password prompt is dismissed', async () => {
    const deps = makeDeps({
      chooseEscalation: vi.fn(async () => 'password' as const),
      promptPassword: vi.fn(async () => undefined),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('cancelled');
  });

  it('keeps offering options after a wrong typed password', async () => {
    const chooseEscalation = vi
      .fn<StopStoneDeps['chooseEscalation']>()
      .mockResolvedValueOnce('password')
      .mockResolvedValueOnce('kill');
    const deps = makeDeps({
      chooseEscalation,
      promptPassword: vi.fn(async () => 'wrong-pw'),
      stopStone: vi.fn(async () => ({ ok: false, message: 'login failed' })),
      forceKill: vi.fn(async () => true),
    });

    const outcome = await runStopStone(deps);

    expect(outcome).toBe('killed');
    expect(chooseEscalation).toHaveBeenCalledTimes(2);
  });
});
