import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { evalPythonInScope, resetPythonScope } from './pythonQueries';
import { logError } from './gciLog';

// Surface Grail (GemStone-Python) as a kernel in Microsoft's Jupyter
// extension. The Jupyter extension owns the `jupyter-notebook` notebook type;
// any NotebookController registered against that type appears in its kernel
// picker, so opening a .ipynb and selecting "Grail (GemStone Python)" routes
// cell execution through the active GemStone session's Grail pipeline.
//
// Cells share state the way Jupyter users expect (`x = 1` in one cell, `x + 2`
// in the next): each notebook gets a persistent module scope on the GemStone
// side, keyed by the notebook URI — see evalPythonInScope in queries/python.ts
// and ModuleAst's `evaluateSource:usingModuleScope:` REPL contract.

export const GRAIL_CONTROLLER_ID = 'gemstone-grail';
export const GRAIL_NOTEBOOK_TYPE = 'jupyter-notebook';
export const GRAIL_CONTROLLER_LABEL = 'Grail (GemStone Python)';
export const GRAIL_RESET_SCOPE_COMMAND = 'gemstone.resetGrailNotebookScope';

export interface GrailCellResult {
  success: boolean;
  /** Cell output text: the eval result, or the error / hint message. */
  message: string;
}

// Grail reports compile and runtime errors *inline* in the result string
// (see queries/python.ts): `Error: <class> — <messageText>`, plus a fixed
// hint when Grail isn't installed in the session. Classify by prefix. A
// genuine Python string result can never collide with the `Error: ` prefix
// because evalPythonInScope returns printString output, which wraps strings
// in quotes (`'Error: ...'`).
const GRAIL_ERROR_PREFIX = 'Error: ';
const GRAIL_HINT_PREFIX = 'Grail (GemStone-Python) not detected';

export function classifyGrailResult(result: string): GrailCellResult {
  if (result.startsWith(GRAIL_ERROR_PREFIX) || result.startsWith(GRAIL_HINT_PREFIX)) {
    return { success: false, message: result };
  }
  return { success: true, message: result };
}

export class GrailNotebookController {
  private readonly controller: vscode.NotebookController;
  private readonly resetCommand: vscode.Disposable;
  private executionOrder = 0;

  constructor(private sessionManager: SessionManager) {
    this.controller = vscode.notebooks.createNotebookController(
      GRAIL_CONTROLLER_ID,
      GRAIL_NOTEBOOK_TYPE,
      GRAIL_CONTROLLER_LABEL,
    );
    this.controller.supportedLanguages = ['python'];
    this.controller.supportsExecutionOrder = true;
    this.controller.description = 'Run Python in GemStone via Grail';
    this.controller.executeHandler = (cells) => this.executeCells(cells);

    this.resetCommand = vscode.commands.registerCommand(
      GRAIL_RESET_SCOPE_COMMAND,
      () => this.resetActiveNotebookScope(),
    );
  }

  dispose(): void {
    this.controller.dispose();
    this.resetCommand.dispose();
  }

  // Cells run sequentially: each shares the single GemStone session, and the
  // GCI execute call is blocking, so there is no parallelism to exploit.
  private async executeCells(cells: vscode.NotebookCell[]): Promise<void> {
    for (const cell of cells) {
      await this.executeCell(cell);
    }
  }

  private async executeCell(cell: vscode.NotebookCell): Promise<void> {
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this.executionOrder;
    execution.start(Date.now());

    const source = cell.document.getText();
    if (!source.trim()) {
      await execution.replaceOutput([]);
      execution.end(true, Date.now());
      return;
    }

    const session = await this.sessionManager.resolveSession();
    if (!session) {
      await this.endWithError(
        execution,
        'No GemStone session is active. Log in from the GemStone Logins view, then re-run the cell.',
      );
      return;
    }

    let result: GrailCellResult;
    try {
      const scopeId = cell.notebook.uri.toString();
      result = classifyGrailResult(evalPythonInScope(session, source, scopeId));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `Grail notebook cell failed: ${msg}`);
      await this.endWithError(execution, msg);
      return;
    }

    if (result.success) {
      await execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(result.message, 'text/plain'),
        ]),
      ]);
      execution.end(true, Date.now());
    } else {
      await this.endWithError(execution, result.message);
    }
  }

  // "Restart kernel" equivalent: forget the active notebook's module scope so
  // the next cell run starts with fresh globals.
  async resetActiveNotebookScope(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active notebook to reset.');
      return;
    }
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    try {
      resetPythonScope(session, editor.notebook.uri.toString());
      vscode.window.showInformationMessage('Grail notebook scope reset.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `Grail notebook scope reset failed: ${msg}`);
      vscode.window.showErrorMessage(`Failed to reset Grail notebook scope: ${msg}`);
    }
  }

  private async endWithError(
    execution: vscode.NotebookCellExecution,
    message: string,
  ): Promise<void> {
    const error = new Error(message);
    error.name = 'GrailError';
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]),
    ]);
    execution.end(false, Date.now());
  }
}
