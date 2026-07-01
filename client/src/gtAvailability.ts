/**
 * Shared "enhanced inspector availability" latch.
 *
 * Probes whether the session's stone has the enhanced inspector support loaded
 * and publishes the result to both the session's cached `gtAvailable` flag and
 * the `gemstone.gtAvailable` context key that the GT commands' `when` clauses
 * gate on. Used at login and again after an install refresh, so the commands
 * light up without a reconnect.
 */
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { checkGtAvailable } from './browserQueries';

/** Re-probe the session and publish `gtAvailable` to session state and the
 *  `gemstone.gtAvailable` context. Returns the freshly-probed value. */
export function refreshGtAvailable(session: ActiveSession): boolean {
  session.gtAvailable = checkGtAvailable(session);
  void vscode.commands.executeCommand('setContext', 'gemstone.gtAvailable', session.gtAvailable);
  return session.gtAvailable;
}
