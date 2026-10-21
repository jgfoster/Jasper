import * as vscode from 'vscode';
import { methodSourceRef } from './languageIds';
import { methodLabel } from './methodResultsPicker';
import type { TriggerRef } from './breakpointManager';

/**
 * How a breakpoint's rule — its condition, log message and trigger — reads, in
 * every place it is shown: the label at the end of its line, that label's hover,
 * the step point hover, the GemStone Breakpoints row and its tooltip, and the
 * trigger picker.
 *
 * One module rather than a formatter per view because the views drifted apart
 * when each had its own: the trigger was left out of two of the three hovers,
 * so a breakpoint that only waited on another one had an empty hover on its own
 * "Break after …" label. The wording still differs per place on purpose — a row
 * is narrower than an editor line, and says `logs` where the editor says `Log …`
 * — but the pieces it is built from are written once.
 */

/** Why a trigger cannot arm the breakpoint waiting on it, when it cannot. */
export type TriggerProblem = 'disabled' | 'removed';

/** Everything about a breakpoint that its rule text is made from. */
export interface RuleParts {
  condition?: string;
  logMessage?: string;
  triggeredBy?: TriggerRef;
  /**
   * Set when `triggeredBy` names a breakpoint that is disabled or gone. The
   * breakpoint waiting on it then never stops, so every place that names the
   * trigger has to say why.
   */
  triggerProblem?: TriggerProblem;
}

/** How much of a condition the label at the end of a line shows. */
export const EDITOR_LABEL_MAX = 48;

/** How much a GemStone Breakpoints row shows; a row has a selector to fit too. */
export const ROW_LABEL_MAX = 40;

/** One line of text, cut to `max` characters with an ellipsis. */
export function elide(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * The breakpoint a trigger names — `Account>>deposit: @4`.
 *
 * Falls back to the step point alone when the URI does not parse as a method,
 * which is thin but not wrong.
 */
export function triggerWhere(ref: TriggerRef): string {
  const method = methodSourceRef(vscode.Uri.parse(ref.uri));
  return method ? `${methodLabel(method)} @${ref.stepPoint}` : `@${ref.stepPoint}`;
}

/** The trigger as a short clause, with the reason it cannot fire when it cannot. */
function triggerClause(ref: TriggerRef, problem: TriggerProblem | undefined, max: number): string {
  return `${elide(triggerWhere(ref), max)}${problem === undefined ? '' : ` (${problem})`}`;
}

/**
 * The condition as the label at the end of its line shows it.
 *
 * Reads "Break if …" rather than a bare "if …", which is a fragment: the label
 * is the one place a reader may not already know what they are looking at.
 */
export function conditionLabel(condition: string): string {
  return `Break if ${elide(condition, EDITOR_LABEL_MAX)}`;
}

/**
 * The label for a breakpoint that logs rather than stops. Says `Log` rather
 * than `Break`, because that is the whole difference; with a condition it reads
 * `Log if …`, and the message itself is left to the hover.
 */
export function logpointLabel(logMessage: string, condition?: string): string {
  return condition === undefined
    ? `Log ${elide(logMessage, EDITOR_LABEL_MAX)}`
    : `Log if ${elide(condition, EDITOR_LABEL_MAX)}`;
}

/**
 * The label at the end of a breakpoint's line, or undefined when it has no rule.
 *
 * A trigger leads: it is the reason the breakpoint will be passed over, and a
 * line reading only `Break if amount > 100` beside a breakpoint that is not
 * going to stop yet would be misleading. `stepPoint` is given when the line
 * holds more than one breakpoint, so the label says which one it is about.
 */
export function editorLabel(rule: RuleParts, stepPoint?: number): string | undefined {
  const own =
    rule.logMessage !== undefined
      ? logpointLabel(rule.logMessage, rule.condition)
      : rule.condition !== undefined
        ? conditionLabel(rule.condition)
        : undefined;
  let label = own;
  if (rule.triggeredBy !== undefined) {
    const head = `Break after ${triggerClause(rule.triggeredBy, rule.triggerProblem, EDITOR_LABEL_MAX)}`;
    // `Break if …` would repeat the verb; the condition rides as a bare clause.
    label = own === undefined ? head : `${head}, ${own.replace(/^Break /, '')}`;
  }
  if (label === undefined) return undefined;
  return stepPoint === undefined ? label : `@${stepPoint} ${label}`;
}

/**
 * The rule as a row's trailing description, beside its step point.
 *
 * A logpoint says `logs` rather than repeating its message: a row is one line,
 * and what it needs to say is which *kind* of breakpoint this is.
 */
export function rowDescription(rule?: RuleParts): string {
  if (!rule) return '';
  const parts: string[] = [];
  if (rule.triggeredBy) {
    parts.push(`after ${triggerClause(rule.triggeredBy, rule.triggerProblem, ROW_LABEL_MAX)}`);
  }
  if (rule.condition !== undefined) parts.push(`if ${elide(rule.condition, ROW_LABEL_MAX)}`);
  if (rule.logMessage !== undefined) parts.push('logs');
  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`;
}

/**
 * One line saying what a breakpoint does, for the trigger picker, where every
 * row is already named by method and step point.
 */
export function pickerSummary(bp: {
  enabled: boolean;
  condition?: string;
  logMessage?: string;
}): string {
  const parts: string[] = [];
  if (bp.logMessage !== undefined) parts.push(logpointLabel(bp.logMessage, bp.condition));
  else if (bp.condition !== undefined) parts.push(conditionLabel(bp.condition));
  else parts.push('Stops every time');
  // Worth saying out loud: a disabled breakpoint is never reached, so one
  // chosen as a trigger leaves the breakpoint waiting on it disarmed until it is
  // enabled again.
  if (!bp.enabled) parts.push('disabled');
  return parts.join(' · ');
}

/**
 * `text` as a fenced code block that nothing inside it can close.
 *
 * The condition and log message are the developer's own text, and they are
 * shown in hovers that carry command links. A fence of three backticks would
 * end at the first ``` inside the text, and whatever followed would be read as
 * Markdown, links included. A fence longer than any backtick run in the text
 * cannot be closed from inside it.
 */
export function fenced(text: string, language = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

/**
 * Append the rule, in full, to a hover or tooltip: the condition, the log
 * message and where it goes, and what the breakpoint waits for. Each part is a
 * paragraph of its own, preceded by a blank line.
 */
export function appendRuleMarkdown(md: vscode.MarkdownString, rule: RuleParts): void {
  if (rule.condition !== undefined) {
    md.appendMarkdown(
      `\n\n${rule.logMessage === undefined ? 'Stops only when' : 'Logs only when'}:` +
        `\n\n${fenced(rule.condition, 'smalltalk')}`,
    );
  }
  if (rule.logMessage !== undefined) {
    md.appendMarkdown(
      `\n\nWrites to the **GemStone Logpoints** panel in Output, without stopping:` +
        `\n\n${fenced(rule.logMessage)}`,
    );
  }
  if (rule.triggeredBy !== undefined) {
    md.appendMarkdown(`\n\n${triggerSentence(rule.triggeredBy, rule.triggerProblem)}`);
  }
}

/** What a trigger means for the breakpoint waiting on it, as a sentence. */
function triggerSentence(ref: TriggerRef, problem: TriggerProblem | undefined): string {
  // Backslash-escaped so a selector's `*` or `_` cannot turn into emphasis.
  const where = `**${triggerWhere(ref).replace(/[\\`*_[\]]/g, '\\$&')}**`;
  switch (problem) {
    case 'disabled':
      return (
        `Waits for ${where}, which is disabled, so this breakpoint is passed over every ` +
        'time until that one is enabled again.'
      );
    case 'removed':
      return (
        `Waits for ${where}, which no longer has a breakpoint, so this one is passed over ` +
        'every time. Choose another with Break Only After…, or choose Always armed.'
      );
    default:
      return (
        `Armed only once ${where} has been reached. Until then it is passed over. ` +
        'Arming starts over on each run.'
      );
  }
}
