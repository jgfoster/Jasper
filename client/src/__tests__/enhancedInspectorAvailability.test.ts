import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: executeFetchData, err: { ...noErr } })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('checkEnhancedInspectorAvailable', () => {
  it('returns true when stone returns "true"', () => {
    const session = createMockSession('true');
    expect(queries.checkEnhancedInspectorAvailable(session)).toBe(true);
  });

  it('returns true when response has trailing whitespace', () => {
    const session = createMockSession('true\n');
    expect(queries.checkEnhancedInspectorAvailable(session)).toBe(true);
  });

  it('returns false when stone returns "false"', () => {
    const session = createMockSession('false');
    expect(queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('returns false when stone returns an unexpected string', () => {
    const session = createMockSession('maybe');
    expect(queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('returns false when GCI returns an error', () => {
    const session = createMockSession('');
    (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: '',
      err: { ...noErr, number: 2010, message: 'GCI error' },
    });
    expect(queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('emitted Smalltalk references GtRemotePhlowViewedObject', () => {
    const session = createMockSession('true');
    queries.checkEnhancedInspectorAvailable(session);
    const mockExec = session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>;
    const code = mockExec.mock.calls[0][1] as string;
    expect(code).toContain('GtRemotePhlowViewedObject');
  });
});
