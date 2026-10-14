/**
 * Working out what reversing a method edit actually has to do (issue #434).
 *
 * Pure functions over captured state — no session, no vscode — so every rule here is
 * unit-testable as data.
 *
 * The plan is computed against the LIVE state at undo time, not against what the edit
 * was expected to leave. That is the same choice the refactoring engine's undo makes,
 * and for the same reason: a slot someone else already put back needs no reversal, and
 * a slot that never changed contributes nothing. Comparing to a remembered "after"
 * would invent work that the stone does not need.
 */
import { MethodSlot, MethodSlotOp, MethodSlotState, slotLabel } from './undoTypes';

/**
 * Whether a slot that held `was` before the change needs any work to get back there from `is`.
 *
 * The one test both the reversal and the plan the user approves first (`undoPlan.ts`) apply, so
 * the panel cannot count a slot the reversal will walk past.
 */
export function slotNeedsReversal(
  was: MethodSlotState | undefined,
  is: MethodSlotState | undefined,
): boolean {
  if (!was || !is) return false;
  if (!was.exists) return is.exists;
  return !is.exists || was.source !== is.source || was.category !== is.category;
}

/**
 * The ordered operations that put `before` back, given what is there `now`.
 *
 * Ordered restore → recompile → remove, so a reversal that both brings a method back
 * and takes another away does the restoring first. Undoing a rename-shaped edit
 * therefore never leaves the class with neither selector, even momentarily.
 */
export function planReversal(
  slots: MethodSlot[],
  before: MethodSlotState[],
  now: MethodSlotState[],
): MethodSlotOp[] {
  const restore: MethodSlotOp[] = [];
  const recompile: MethodSlotOp[] = [];
  const remove: MethodSlotOp[] = [];

  slots.forEach((slot, i) => {
    const was = before[i];
    const is = now[i];
    if (!slotNeedsReversal(was, is)) return;

    if (!was.exists) remove.push({ kind: 'remove', slot, source: null, category: null });
    else if (!is.exists)
      restore.push({ kind: 'restore', slot, source: was.source, category: was.category });
    else recompile.push({ kind: 'recompile', slot, source: was.source, category: was.category });
  });

  return [...restore, ...recompile, ...remove];
}

/**
 * The slots someone has changed since the edit was recorded.
 *
 * Drift is a WARNING, never a refusal — the same policy the refactoring undo follows.
 * Undoing still does exactly what it says it will (put the slot back as it was); the
 * point of naming the drift is that doing so now discards work the user may not
 * remember doing.
 */
export function driftedSlots(
  slots: MethodSlot[],
  after: MethodSlotState[],
  now: MethodSlotState[],
): MethodSlot[] {
  return slots.filter((_slot, i) => {
    const expected = after[i];
    const actual = now[i];
    if (!expected || !actual) return false;
    if (expected.exists !== actual.exists) return true;
    if (!expected.exists) return false;
    return expected.source !== actual.source || expected.category !== actual.category;
  });
}

/** A one-line summary of a completed reversal, for the post-undo notice. */
export function describeOps(ops: MethodSlotOp[]): string {
  if (ops.length === 0) return 'nothing to change';
  if (ops.length === 1) {
    const op = ops[0];
    const what = slotLabel(op.slot);
    if (op.kind === 'restore') return `restored ${what}`;
    if (op.kind === 'remove') return `removed ${what}`;
    return `reverted ${what}`;
  }
  const counts = {
    restore: ops.filter((o) => o.kind === 'restore').length,
    recompile: ops.filter((o) => o.kind === 'recompile').length,
    remove: ops.filter((o) => o.kind === 'remove').length,
  };
  const parts: string[] = [];
  if (counts.restore) parts.push(`${counts.restore} restored`);
  if (counts.recompile) parts.push(`${counts.recompile} reverted`);
  if (counts.remove) parts.push(`${counts.remove} removed`);
  return parts.join(', ');
}
