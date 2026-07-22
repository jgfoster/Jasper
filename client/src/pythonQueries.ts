import { ActiveSession } from './sessionManager';
import { BrowserQueryError } from './browserQueries';
import { QueryExecutor } from './queries/types';
import { logQuery, logResult, logError } from './gciLog';

import {
  evalPython as sharedEvalPython,
  evalPythonInScope as sharedEvalPythonInScope,
  resetPythonScope as sharedResetPythonScope,
  compilePython as sharedCompilePython,
} from './queries/python';

/**
 * Binds a session to the QueryExecutor shape that shared queries expect,
 * backed by GciLibrary.executeAndFetchString.
 *
 * executeAndFetchString explicitly encodes the evaluated result as UTF-8 in
 * Smalltalk before paging it out, so results decode correctly regardless of
 * their original encoding and are not capped at a single fixed-size buffer.
 */
function defaultQueryExecutorUsing(session: ActiveSession): QueryExecutor {
  return (label, code) => {
    logQuery(session.id, label, code);

    const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
    if (inProgress !== 0) {
      const msg = 'Session is busy with another operation. Please wait or use a different session.';
      logError(session.id, msg);
      throw new BrowserQueryError(msg);
    }

    try {
      const data = session.gci.executeAndFetchString(session.handle, code);
      logResult(session.id, data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);
      throw new BrowserQueryError(msg);
    }
  };
}

export function evalPython(session: ActiveSession, source: string) {
  return sharedEvalPython(defaultQueryExecutorUsing(session), source);
}

export function evalPythonInScope(session: ActiveSession, source: string, scopeId: string) {
  return sharedEvalPythonInScope(defaultQueryExecutorUsing(session), source, scopeId);
}

export function resetPythonScope(session: ActiveSession, scopeId: string) {
  return sharedResetPythonScope(defaultQueryExecutorUsing(session), scopeId);
}

export function compilePython(session: ActiveSession, source: string) {
  return sharedCompilePython(defaultQueryExecutorUsing(session), source);
}
