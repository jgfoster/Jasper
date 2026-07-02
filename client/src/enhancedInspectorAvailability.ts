/**
 * Shared "enhanced inspector availability" latch.
 *
 * Probes whether the session's stone has the enhanced inspector support loaded
 * and publishes the result to both the session's cached `enhancedInspectorAvailable` flag and
 * the `gemstone.enhancedInspectorAvailable` context key that the enhanced inspector commands' `when` clauses
 * gate on. Used at login and again after an install refresh, so the commands
 * light up without a reconnect.
 */
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { checkEnhancedInspectorAvailable } from './browserQueries';

/** Re-probe the session and publish `enhancedInspectorAvailable` to session state and the
 *  `gemstone.enhancedInspectorAvailable` context. Returns the freshly-probed value. */
export function refreshEnhancedInspectorAvailable(session: ActiveSession): boolean {
  session.enhancedInspectorAvailable = checkEnhancedInspectorAvailable(session);
  void vscode.commands.executeCommand('setContext', 'gemstone.enhancedInspectorAvailable', session.enhancedInspectorAvailable);
  return session.enhancedInspectorAvailable;
}
