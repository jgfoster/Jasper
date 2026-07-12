import { describe, it, expect, vi, afterEach } from 'vitest';
import { InFlightGuard } from '../inFlightGuard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('InFlightGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the operation and returns its result', async () => {
    const guard = new InFlightGuard();

    const result = await guard.run('key', async () => 42);

    expect(result).toBe(42);
  });

  it('drops a second call for the same key while the first is still running', async () => {
    const guard = new InFlightGuard();
    const first = deferred<string>();
    const firstFn = vi.fn(() => first.promise);
    const secondFn = vi.fn(async () => 'second');

    const firstRun = guard.run('key', firstFn);
    const droppedResult = await guard.run('key', secondFn);
    first.resolve('first');

    expect(droppedResult).toBeUndefined();
    expect(secondFn).not.toHaveBeenCalled();
    expect(await firstRun).toBe('first');
  });

  it('runs calls for different keys concurrently', async () => {
    const guard = new InFlightGuard();
    const firstFn = vi.fn(async () => 'a');
    const secondFn = vi.fn(async () => 'b');

    const results = await Promise.all([guard.run('a', firstFn), guard.run('b', secondFn)]);

    expect(results).toEqual(['a', 'b']);
  });

  it('allows the key again once the operation finishes', async () => {
    const guard = new InFlightGuard();

    await guard.run('key', async () => 'first');
    const second = await guard.run('key', async () => 'second');

    expect(second).toBe('second');
  });

  it('frees the key after a failed operation so it can be retried', async () => {
    const guard = new InFlightGuard();

    await expect(
      guard.run('key', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const retry = await guard.run('key', async () => 'ok');

    expect(retry).toBe('ok');
  });

  it('keeps the key reserved through the cooldown, then frees it', async () => {
    vi.useFakeTimers();
    const guard = new InFlightGuard(1000);

    await guard.run('key', async () => 'first');
    const duringCooldown = await guard.run('key', async () => 'second');

    expect(duringCooldown).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);
    const afterCooldown = await guard.run('key', async () => 'third');

    expect(afterCooldown).toBe('third');
  });
});
