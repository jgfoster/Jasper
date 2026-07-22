import { ActiveSession } from './sessionManager';
import { BrowserQueryError } from './browserQueries';
import { QueryExecutor } from './queries/types';
import { logQuery, logResult, logError } from './gciLog';

import { discoverTestClasses as sharedDiscoverTestClasses } from './queries/discoverTestClasses';
import { discoverTestMethods as sharedDiscoverTestMethods } from './queries/discoverTestMethods';
import { runTestMethod as sharedRunTestMethod } from './queries/runTestMethod';
import { runTestClass as sharedRunTestClass } from './queries/runTestClass';
import { runFailingTests as sharedRunFailingTests } from './queries/runFailingTests';
import { describeTestFailure as sharedDescribeTestFailure } from './queries/describeTestFailure';

// Re-export types from the shared layer.
export type { TestClassInfo } from './queries/discoverTestClasses';
export type { TestMethodInfo } from './queries/discoverTestMethods';
export type { TestRunResult } from './queries/runTestMethod';

// Backward compatibility alias — no callers catch this by class, but tests
// reference it in mocks.
export const SunitQueryError = BrowserQueryError;

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

export function discoverTestClasses(session: ActiveSession) {
  return sharedDiscoverTestClasses(defaultQueryExecutorUsing(session));
}

export function discoverTestMethods(session: ActiveSession, className: string, dictName?: string) {
  return sharedDiscoverTestMethods(defaultQueryExecutorUsing(session), className, dictName);
}

export function runTestMethod(
  session: ActiveSession,
  className: string,
  selector: string,
  dictName?: string,
) {
  return sharedRunTestMethod(defaultQueryExecutorUsing(session), className, selector, dictName);
}

export function runTestClass(session: ActiveSession, className: string, dictName?: string) {
  return sharedRunTestClass(defaultQueryExecutorUsing(session), className, dictName);
}

export function runFailingTests(
  session: ActiveSession,
  classNames?: string[],
  classNamePattern?: string,
) {
  return sharedRunFailingTests(defaultQueryExecutorUsing(session), classNames, classNamePattern);
}

export function describeTestFailure(session: ActiveSession, className: string, selector: string) {
  return sharedDescribeTestFailure(defaultQueryExecutorUsing(session), className, selector);
}
