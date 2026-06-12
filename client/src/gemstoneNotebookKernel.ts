import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { logError } from './gciLog';

// Shared base for GemStone-backed kernels in Microsoft's Jupyter extension.
// The Jupyter extension owns the `jupyter-notebook` notebook type; any
// NotebookController registered against that type appears in its kernel
// picker, so opening a .ipynb and selecting a GemStone kernel routes cell
// execution through the active GemStone session. Concrete kernels (Grail
// Python, GemStone Smalltalk) differ only in id/label/cell language and in
// how a cell's source is evaluated.

export const GEMSTONE_NOTEBOOK_TYPE = 'jupyter-notebook';

export interface NotebookKernelSpec {
  id: string;
  label: string;
  description: string;
  supportedLanguages: string[];
  /**
   * Evaluate one cell's source on the session and return the result string.
   * scopeId identifies the notebook (its URI) for kernels that keep
   * per-notebook state on the GemStone side; stateless kernels ignore it.
   */
  evaluate: (session: ActiveSession, source: string, scopeId: string) => string;
}

export interface NotebookCellResult {
  success: boolean;
  /** Cell output text: the eval result, or the error / hint message. */
  message: string;
}

// Both evaluation paths report compile and runtime errors *inline* in the
// result string (see queries/python.ts and queries/executeCode.ts):
// `Error: <class> — <messageText>`, plus a fixed hint when Grail isn't
// installed in the session. Classify by prefix. A genuine string result can
// never collide with the `Error: ` prefix because both paths return
// printString output, which wraps strings in quotes (`'Error: ...'`).
const ERROR_PREFIX = 'Error: ';
const GRAIL_HINT_PREFIX = 'Grail (GemStone-Python) not detected';

export function classifyCellResult(result: string): NotebookCellResult {
  if (result.startsWith(ERROR_PREFIX) || result.startsWith(GRAIL_HINT_PREFIX)) {
    return { success: false, message: result };
  }
  return { success: true, message: result };
}

export class GemStoneNotebookKernel {
  protected readonly controller: vscode.NotebookController;
  private readonly evaluate: NotebookKernelSpec['evaluate'];
  private executionOrder = 0;

  constructor(
    protected sessionManager: SessionManager,
    spec: NotebookKernelSpec,
  ) {
    this.evaluate = spec.evaluate;
    this.controller = vscode.notebooks.createNotebookController(
      spec.id,
      GEMSTONE_NOTEBOOK_TYPE,
      spec.label,
    );
    this.controller.supportedLanguages = spec.supportedLanguages;
    this.controller.supportsExecutionOrder = true;
    this.controller.description = spec.description;
    this.controller.executeHandler = (cells) => this.executeCells(cells);
  }

  dispose(): void {
    this.controller.dispose();
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

    let result: NotebookCellResult;
    try {
      const scopeId = cell.notebook.uri.toString();
      result = classifyCellResult(this.evaluate(session, source, scopeId));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `Notebook cell failed: ${msg}`);
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

  protected async endWithError(
    execution: vscode.NotebookCellExecution,
    message: string,
  ): Promise<void> {
    const error = new Error(message);
    error.name = 'GemStoneError';
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]),
    ]);
    execution.end(false, Date.now());
  }
}
