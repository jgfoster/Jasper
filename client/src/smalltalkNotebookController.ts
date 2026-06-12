import { SessionManager, ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { wrapExecuteCode } from './queries/executeCode';
import { GemStoneNotebookKernel } from './gemstoneNotebookKernel';

// GemStone Smalltalk as a Jupyter kernel — see gemstoneNotebookKernel.ts for
// the Jupyter integration mechanics. Each cell is an independent doit (the
// same contract as the MCP execute_code tool): the cell's last statement
// value is printed as the output, and wrapExecuteCode's guards report
// compile/runtime errors inline as `Error: <class> — <messageText>`.
//
// Unlike the Grail kernel there is no synthetic cross-cell scope: Smalltalk
// has no REPL module-scope concept — undeclared variables are compile-time
// errors, not auto-created globals. State persists across cells the way it
// does everywhere else in the session: through the session itself
// (`UserGlobals at: #x put: ...`, class definitions, commits).

export const SMALLTALK_CONTROLLER_ID = 'gemstone-smalltalk-kernel';
export const SMALLTALK_CONTROLLER_LABEL = 'GemStone Smalltalk';

export function evalSmalltalk(session: ActiveSession, source: string): string {
  return executeFetchString(session, 'smalltalkNotebookCell', wrapExecuteCode(source));
}

export class SmalltalkNotebookController extends GemStoneNotebookKernel {
  constructor(sessionManager: SessionManager) {
    super(sessionManager, {
      id: SMALLTALK_CONTROLLER_ID,
      label: SMALLTALK_CONTROLLER_LABEL,
      description: 'Run Smalltalk in the active GemStone session',
      supportedLanguages: ['gemstone-smalltalk'],
      evaluate: (session, source) => evalSmalltalk(session, source),
    });
  }
}
