import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode'));

import * as vscode from 'vscode';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import { SystemBrowser } from '../../systemBrowser';
import { findMethodInClass } from '../findMethodInClass';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsPerform: vi.fn(() => ({ result: 2000n, err: { ...noErr } })),
    GciTsNewString: vi.fn(() => ({ result: 3000n, err: { ...noErr } })),
    GciTsNewSymbol: vi.fn(() => ({ result: 4000n, err: { ...noErr } })),
    GciTsCompileMethod: vi.fn(() => ({ result: 5000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: executeFetchData, err: { ...noErr } })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    GciTsClearStack: vi.fn(),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('findMethodInClass', () => {
  const session = createMockSession('0\tprinting\tfoo\n1\taccessing\tbar\n');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SystemBrowser, 'getSelectedClassName').mockReturnValue({ dictName: 'UserGlobals', className: 'Array' });
    vi.spyOn(SystemBrowser, 'navigateTo').mockReturnValue(true);
  });

  it('navigates to the picked method using the currently selected class', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'foo',
      description: 'printing',
      method: { isMeta: false, category: 'printing', selector: 'foo' },
    } as any);
    const sessionManager = { resolveSession: vi.fn().mockResolvedValue(session) } as any;

    await findMethodInClass(sessionManager);

    expect(SystemBrowser.navigateTo).toHaveBeenCalledWith(session.id, {
      dictName: 'UserGlobals',
      className: 'Array',
      isMeta: false,
      selector: 'foo',
      category: 'printing',
    });
  });

  it('does not navigate when the method pick is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
    const sessionManager = { resolveSession: vi.fn().mockResolvedValue(session) } as any;

    await findMethodInClass(sessionManager);

    expect(SystemBrowser.navigateTo).not.toHaveBeenCalled();
  });

  it('shows an informational message when the class has no methods', async () => {
    const emptySession = createMockSession('');
    const sessionManager = { resolveSession: vi.fn().mockResolvedValue(emptySession) } as any;

    await findMethodInClass(sessionManager);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No methods found for Array.');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });
});
