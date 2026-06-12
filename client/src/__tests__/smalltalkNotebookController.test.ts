import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => '7'),
}));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
}));

import { notebooks } from '../__mocks__/vscode';
import {
  SmalltalkNotebookController,
  SMALLTALK_CONTROLLER_ID,
  SMALLTALK_CONTROLLER_LABEL,
} from '../smalltalkNotebookController';
import { GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
import { SessionManager } from '../sessionManager';
import { executeFetchString } from '../browserQueries';

const SESSION = {
  id: 1,
  gci: {},
  handle: {},
  login: { label: 'Test' },
  stoneVersion: '3.7.2',
};

function makeSessionManager(hasSession: boolean) {
  return {
    resolveSession: vi.fn(async () => (hasSession ? SESSION : undefined)),
  } as unknown as SessionManager;
}

function makeCell(source: string, notebookUri = 'file:///tmp/demo.ipynb') {
  return {
    document: { getText: () => source, languageId: 'gemstone-smalltalk' },
    notebook: { uri: { toString: () => notebookUri } },
  };
}

function lastController() {
  const results = notebooks.createNotebookController.mock.results;
  return results[results.length - 1].value;
}

function executionAt(index: number) {
  return lastController().createNotebookCellExecution.mock.results[index].value;
}

async function runCells(cells: unknown[]) {
  await lastController().executeHandler(cells);
}

describe('SmalltalkNotebookController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a controller for the jupyter-notebook type with smalltalk cells', () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    expect(notebooks.createNotebookController).toHaveBeenCalledWith(
      SMALLTALK_CONTROLLER_ID, GEMSTONE_NOTEBOOK_TYPE, SMALLTALK_CONTROLLER_LABEL,
    );
    const mock = lastController();
    expect(mock.supportedLanguages).toEqual(['gemstone-smalltalk']);
    expect(mock.supportsExecutionOrder).toBe(true);
    ctrl.dispose();
  });

  // Each cell is an independent doit through wrapExecuteCode — the same
  // contract as the MCP execute_code tool: block-wrapped, stack-guarded,
  // printString of the last statement's value.
  it('executes a cell as a guarded doit and shows the printString result', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    await runCells([makeCell('3 + 4')]);

    expect(executeFetchString).toHaveBeenCalledTimes(1);
    const [sessionArg, label, code] = vi.mocked(executeFetchString).mock.calls[0];
    expect(sessionArg).toBe(SESSION);
    expect(label).toBe('smalltalkNotebookCell');
    expect(code).toContain('[[[3 + 4] value printString]');
    expect(code).toContain('on: AlmostOutOfStack');
    expect(code).toContain('on: AbstractException');

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(true, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(item.mime).toBe('text/plain');
    expect(new TextDecoder().decode(item.data)).toBe('7');
    ctrl.dispose();
  });

  it('ends with an error output when the doit reports an inline error', async () => {
    vi.mocked(executeFetchString).mockReturnValueOnce(
      'Error: ZeroDivide — attempt to divide 1 by zero',
    );
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    await runCells([makeCell('1 / 0')]);

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(item.mime).toBe('application/vnd.code.notebook.error');
    expect(new TextDecoder().decode(item.data)).toContain('ZeroDivide');
    ctrl.dispose();
  });

  it('reports a thrown query error (e.g. session busy) as a cell error', async () => {
    vi.mocked(executeFetchString).mockImplementationOnce(() => {
      throw new Error('Session is busy with another operation.');
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    await runCells([makeCell('3 + 4')]);
    expect(executionAt(0).end).toHaveBeenCalledWith(false, expect.any(Number));
    ctrl.dispose();
  });

  it('fails the cell without executing when no session is active', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(false));
    await runCells([makeCell('3 + 4')]);

    expect(executeFetchString).not.toHaveBeenCalled();
    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(new TextDecoder().decode(item.data)).toContain('No GemStone session');
    ctrl.dispose();
  });

  it('increments executionOrder independently of other kernels', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    await runCells([makeCell('1'), makeCell('2')]);
    expect(executionAt(0).executionOrder).toBe(1);
    expect(executionAt(1).executionOrder).toBe(2);
    ctrl.dispose();
  });

  it('dispose releases the controller', () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(true));
    const mock = lastController();
    ctrl.dispose();
    expect(mock.dispose).toHaveBeenCalled();
  });
});
