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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SystemBrowser, 'navigateTo').mockReturnValue(true);
  });

  describe('when a class is selected in the System Browser', () => {
    const session = createMockSession('0\tprinting\tfoo\n1\taccessing\tbar\n');

    beforeEach(() => {
      vi.spyOn(SystemBrowser, 'getSelectedClassName').mockReturnValue({ dictName: 'UserGlobals', className: 'Array' });
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

  describe('when no class is selected in the System Browser', () => {
    const classListPayload = '1\tUserGlobals\tArray\n2\tGlobals\tString\n';
    const methodListPayload = '0\tprinting\tfoo\n1\taccessing\tbar\n';

    function createSequencedSession(): ActiveSession {
      const session = createMockSession();
      vi.mocked(session.gci.GciTsExecuteFetchBytes)
        .mockReturnValueOnce({ data: classListPayload, err: { ...noErr } } as any)
        .mockReturnValueOnce({ data: methodListPayload, err: { ...noErr } } as any);
      return session;
    }

    beforeEach(() => {
      vi.spyOn(SystemBrowser, 'getSelectedClassName').mockReturnValue(null);
    });

    it('navigates to the picked method using the class picked from the list', async () => {
      const session = createSequencedSession();
      const sessionManager = { resolveSession: vi.fn().mockResolvedValue(session) } as any;
      vi.mocked(vscode.window.showQuickPick)
        .mockResolvedValueOnce({
          label: 'Array', description: 'UserGlobals',
          entry: { dictIndex: 1, dictName: 'UserGlobals', className: 'Array' },
        } as any)
        .mockResolvedValueOnce({
          label: 'foo', description: 'printing',
          method: { isMeta: false, category: 'printing', selector: 'foo' },
        } as any);

      await findMethodInClass(sessionManager);

      expect(SystemBrowser.navigateTo).toHaveBeenCalledWith(session.id, {
        dictName: 'UserGlobals',
        className: 'Array',
        isMeta: false,
        selector: 'foo',
        category: 'printing',
      });
    });

    it('opens the method directly when no System Browser is open for the session', async () => {
      vi.mocked(SystemBrowser.navigateTo).mockReturnValue(false);
      const session = createSequencedSession();
      const sessionManager = { resolveSession: vi.fn().mockResolvedValue(session) } as any;
      vi.mocked(vscode.window.showQuickPick)
        .mockResolvedValueOnce({
          label: 'Array', description: 'UserGlobals',
          entry: { dictIndex: 1, dictName: 'UserGlobals', className: 'Array' },
        } as any)
        .mockResolvedValueOnce({
          label: 'foo', description: 'printing',
          method: { isMeta: false, category: 'printing', selector: 'foo' },
        } as any);

      await findMethodInClass(sessionManager);

      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
      const [command, uri] = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
      expect(command).toBe('gemstone.openDocument');
      expect(String(uri)).toContain('UserGlobals');
      expect(String(uri)).toContain('Array');
    });

    it('does not load methods when the class pick is cancelled', async () => {
      const session = createSequencedSession();
      const sessionManager = { resolveSession: vi.fn().mockResolvedValue(session) } as any;
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

      await findMethodInClass(sessionManager);

      expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
      expect(SystemBrowser.navigateTo).not.toHaveBeenCalled();
    });
  });
});
