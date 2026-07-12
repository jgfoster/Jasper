/**
 * De-duplicates concurrent, keyed async operations so a second request for a
 * key that is already running is dropped instead of started again.
 *
 * The motivating case is the login/connect button: the GciTsLogin call blocks
 * the extension-host thread while it runs, so clicks that arrive during a slow
 * login queue up and only replay once the call returns. To swallow those late
 * replays the key stays reserved for a short `cooldownMs` after the operation
 * settles, not just while it is running. Clicks that land during the cooldown
 * are dropped; a genuine retry a moment later still goes through.
 */
export class InFlightGuard {
  private readonly active = new Set<string>();

  /**
   * @param cooldownMs How long the key stays reserved after the operation
   *   settles. `0` releases it immediately (reserved only while running).
   */
  constructor(private readonly cooldownMs = 0) {}

  /** Whether an attempt for `key` is currently reserved (running or cooling down). */
  isActive(key: string): boolean {
    return this.active.has(key);
  }

  /**
   * Run `fn` for `key` unless an attempt for the same key is already reserved.
   * Returns `fn`'s result, or `undefined` if the call was dropped as a
   * duplicate. The key is released (after the cooldown) whether `fn` resolves
   * or rejects, so a failed attempt does not lock the key permanently.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.active.has(key)) {
      return undefined;
    }

    this.active.add(key);
    try {
      return await fn();
    } finally {
      if (this.cooldownMs > 0) {
        setTimeout(() => this.active.delete(key), this.cooldownMs);
      } else {
        this.active.delete(key);
      }
    }
  }
}
