import { ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { QueryExecutor } from './queries/types';

import {
  evalPython as sharedEvalPython,
  evalPythonInScope as sharedEvalPythonInScope,
  resetPythonScope as sharedResetPythonScope,
  compilePython as sharedCompilePython,
} from './queries/python';

function bind(session: ActiveSession): QueryExecutor {
  return (label, code) => executeFetchString(session, label, code);
}

export function evalPython(session: ActiveSession, source: string) {
  return sharedEvalPython(bind(session), source);
}

export function evalPythonInScope(session: ActiveSession, source: string, scopeId: string) {
  return sharedEvalPythonInScope(bind(session), source, scopeId);
}

export function resetPythonScope(session: ActiveSession, scopeId: string) {
  return sharedResetPythonScope(bind(session), scopeId);
}

export function compilePython(session: ActiveSession, source: string) {
  return sharedCompilePython(bind(session), source);
}
