// Orchestrates stopping a stone with credential resolution and a prompt/kill
// escalation. GemStone requires a (DataCurator) password for a *clean* shutdown
// via `stopstone`. When Jasper has a stored DataCurator login for the stone it
// uses that; otherwise — or if the stored password is stale and `stopstone`
// fails — it offers to prompt for a password or to force-`kill` the stone. A
// force kill is a hard stop the stone recovers from via its transaction log on
// next start (safe for a full-logging stone), so it is offered as a peer choice,
// not only a last resort.
//
// This module is deliberately free of `vscode` and process APIs: every effect is
// an injected dependency, so the escalation logic is unit-testable in isolation.

export type StopStoneChoice = 'password' | 'kill' | 'cancel';

export interface StopStoneResult {
  ok: boolean;
  /** Failure output shown to the user (and reused as the escalation reason). */
  message: string;
}

export type StopStoneOutcome = 'stopped' | 'killed' | 'kill-failed' | 'cancelled';

export interface StopStoneDeps {
  stoneName: string;
  /** Whether a DataCurator login for this stone exists in settings. */
  hasAdminLogin: boolean;
  /** The stored/keychain password for that login, or undefined when none is
   *  available (no login, or the login carries no stored/keychain password).
   *  Never prompts — prompting is the escalation's job. */
  storedPassword: () => Promise<string | undefined>;
  /** Run `stopstone` with the given password. Resolves `ok: false` (never
   *  rejects) with the failure message so the caller can escalate. */
  stopStone: (password: string) => Promise<StopStoneResult>;
  /** Prompt for a DataCurator password. `undefined` = the user cancelled. */
  promptPassword: () => Promise<string | undefined>;
  /** Offer the escalation choice, given a one-line reason for it. */
  chooseEscalation: (reason: string) => Promise<StopStoneChoice>;
  /** Force-stop the stone (verify PID → SIGTERM/SIGKILL → clear the stale lock).
   *  Resolves true when the stone is (now) stopped. */
  forceKill: () => Promise<boolean>;
}

/**
 * Stop a stone, resolving DataCurator credentials from its login when possible
 * and escalating to a password prompt or a force kill when there is no usable
 * credential or `stopstone` fails.
 */
export async function runStopStone(deps: StopStoneDeps): Promise<StopStoneOutcome> {
  let reason: string;

  const stored = deps.hasAdminLogin ? await deps.storedPassword() : undefined;
  if (stored !== undefined) {
    const result = await deps.stopStone(stored);
    if (result.ok) return 'stopped';
    reason = result.message;
  } else {
    reason = deps.hasAdminLogin
      ? `No stored password for the DataCurator login of "${deps.stoneName}".`
      : `No DataCurator login found for "${deps.stoneName}".`;
  }

  // No usable stored credential, or stopstone failed: prompt or force-kill.
  for (;;) {
    const choice = await deps.chooseEscalation(reason);
    if (choice === 'cancel') return 'cancelled';
    if (choice === 'kill') return (await deps.forceKill()) ? 'killed' : 'kill-failed';

    const password = await deps.promptPassword();
    if (password === undefined) return 'cancelled';

    const result = await deps.stopStone(password);
    if (result.ok) return 'stopped';
    reason = result.message;
  }
}
