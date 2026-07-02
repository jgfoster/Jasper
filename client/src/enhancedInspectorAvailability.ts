/**
 * Shared "enhanced inspector availability" latch.
 *
 * Probes whether the session's stone has the enhanced inspector support loaded
 * and caches the result on the session's `enhancedInspectorAvailable` flag,
 * which "Inspect It" routing (see inspectRouter.ts) reads to choose the Enhanced
 * Inspector vs. the classic tree view. Used at login and again after an install
 * refresh, so routing reflects a fresh install without a reconnect.
 */
import { ActiveSession } from './sessionManager';
import { checkEnhancedInspectorAvailable } from './browserQueries';

/** Re-probe the session and cache `enhancedInspectorAvailable` on it. Returns
 *  the freshly-probed value. */
export function refreshEnhancedInspectorAvailable(session: ActiveSession): boolean {
  session.enhancedInspectorAvailable = checkEnhancedInspectorAvailable(session);
  return session.enhancedInspectorAvailable;
}
