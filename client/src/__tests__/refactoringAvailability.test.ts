import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';
import { refreshRefactoringSupportAvailable } from '../refactoringAvailability';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0,
  fatal: false,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
};

function createMockSession(executeFetchData = '', stoneVersion = '3.7.5'): ActiveSession {
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
    stoneVersion,
  };
}

describe('checkRefactoringSupportAvailable', () => {
  it('reports available when the stone has the refactoring engine', () => {
    const session = createMockSession('true');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('tolerates trailing whitespace in the reply', () => {
    const session = createMockSession('true\n');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('reports unavailable when the engine is absent', () => {
    const session = createMockSession('false');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('reports unavailable when GCI errors', () => {
    const session = createMockSession('');
    (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: '',
      err: { ...noErr, number: 2010, message: 'GCI error' },
    });

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('probes for the rename-instance-variable refactoring class', () => {
    const session = createMockSession('true');

    queries.checkRefactoringSupportAvailable(session);

    const code = (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(code).toContain('GsRenameInstanceVariableRefactoring');
  });
});

describe('refreshRefactoringSupportAvailable', () => {
  it('latches the probe result on the session', () => {
    const session = createMockSession('true');

    expect(refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  // Not version-gated: the engine is meant to load on every supported stone, so
  // an old stone that has the engine still reports available (contrast the
  // version-gated Enhanced Inspector).
  it('is not version-gated — an older stone with the engine still counts', () => {
    const session = createMockSession('true', '3.6.2');

    expect(refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  it('latches false when the engine is absent', () => {
    const session = createMockSession('false');

    expect(refreshRefactoringSupportAvailable(session)).toBe(false);
    expect(session.rbSupportAvailable).toBe(false);
  });
});
