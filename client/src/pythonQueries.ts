import { ActiveSession } from './sessionManager';
import { defaultQueryExecutorUsing } from './browserQueries';

import {
  evalPython as sharedEvalPython,
  evalPythonInScope as sharedEvalPythonInScope,
  resetPythonScope as sharedResetPythonScope,
  compilePython as sharedCompilePython,
} from './queries/python';

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
