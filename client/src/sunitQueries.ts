import { ActiveSession } from './sessionManager';
import { BrowserQueryError, defaultQueryExecutorUsing } from './browserQueries';

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
