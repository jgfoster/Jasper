import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('koffi', () => ({
  default: {
    struct: vi.fn(() => ({})),
    array: vi.fn(() => ({})),
    opaque: vi.fn(() => ({})),
    pointer: vi.fn(() => ({})),
    union: vi.fn(() => ({})),
    load: vi.fn(() => ({
      func: vi.fn(() => vi.fn()),
    })),
  },
}));

vi.mock('../../../client/src/gciLibrary', () => {
  return {
    GciLibrary: vi.fn(),
  };
});

vi.mock('../../../client/src/gciConstants', () => ({
  OOP_NIL: 0x14n,
  OOP_ILLEGAL: 0x01n,
}));

import { McpSession, McpSessionConfig, SessionRestartedError, isDeadSessionError } from '../mcpSession';
import { GciLibrary } from '../../../client/src/gciLibrary';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0n,
  fatal: 0,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
  reason: '',
};

function makeConfig(overrides: Partial<McpSessionConfig> = {}): McpSessionConfig {
  return {
    libraryPath: '/path/to/libgcirpc.dylib',
    stoneNrs: '!tcp@localhost#server!gs64stone',
    gemNrs: '!tcp@localhost#netldi:gs64ldi#task!gemnetobject',
    gsUser: 'DataCurator',
    gsPassword: 'swordfish',
    ...overrides,
  };
}

function createMockGci() {
  return {
    GciTsLogin: vi.fn(() => ({ session: {} as unknown, err: { ...noErr } })),
    GciTsLogout: vi.fn(() => ({ err: { ...noErr } })),
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: 'result', bytesReturned: 6, err: { ...noErr } })),
  };
}

describe('McpSession', () => {
  let mockGci: ReturnType<typeof createMockGci>;

  beforeEach(() => {
    mockGci = createMockGci();
    vi.mocked(GciLibrary).mockImplementation(function (this: unknown) {
      return mockGci as unknown as GciLibrary;
    } as unknown as new (...args: ConstructorParameters<typeof GciLibrary>) => GciLibrary);
  });

  describe('constructor', () => {
    it('creates a GCI library and logs in', () => {
      const config = makeConfig();
      new McpSession(config);

      expect(GciLibrary).toHaveBeenCalledWith(config.libraryPath);
      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        null,
        null,
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0, 0,
      );
    });

    it('passes host credentials when provided', () => {
      const config = makeConfig({ hostUser: 'admin', hostPassword: 'secret' });
      new McpSession(config);

      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        'admin',
        'secret',
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0, 0,
      );
    });

    it('throws on login failure', () => {
      mockGci.GciTsLogin.mockReturnValue({
        session: null,
        err: { ...noErr, number: 4065, message: 'Login failed: bad password' },
      });

      expect(() => new McpSession(makeConfig())).toThrow('Login failed: bad password');
    });
  });

  describe('executeFetchString', () => {
    it('resolves Utf8 class and executes code', () => {
      const session = new McpSession(makeConfig());
      const result = session.executeFetchString('3 + 4');

      expect(mockGci.GciTsResolveSymbol).toHaveBeenCalled();
      expect(mockGci.GciTsExecuteFetchBytes).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('caches the Utf8 class OOP across calls', () => {
      const session = new McpSession(makeConfig());

      session.executeFetchString('1 + 1');
      session.executeFetchString('2 + 2');

      expect(mockGci.GciTsResolveSymbol).toHaveBeenCalledTimes(1);
      expect(mockGci.GciTsExecuteFetchBytes).toHaveBeenCalledTimes(2);
    });

    it('throws on GCI execution error', () => {
      const session = new McpSession(makeConfig());
      mockGci.GciTsExecuteFetchBytes.mockReturnValue({
        data: '',
        bytesReturned: 0,
        err: { ...noErr, number: 2101, message: 'MessageNotUnderstood' },
      });

      expect(() => session.executeFetchString('bad code')).toThrow('MessageNotUnderstood');
    });

    it('throws on Utf8 resolve failure', () => {
      mockGci.GciTsResolveSymbol.mockReturnValue({
        result: 0n,
        err: { ...noErr, number: 2023, message: 'symbol not found' },
      });

      const session = new McpSession(makeConfig());
      expect(() => session.executeFetchString('anything')).toThrow('symbol not found');
    });
  });

  describe('logout', () => {
    it('calls GciTsLogout', () => {
      const session = new McpSession(makeConfig());
      session.logout();

      expect(mockGci.GciTsLogout).toHaveBeenCalled();
    });

    it('does not throw if logout fails', () => {
      mockGci.GciTsLogout.mockImplementation(() => {
        throw new Error('session already dead');
      });

      const session = new McpSession(makeConfig());
      expect(() => session.logout()).not.toThrow();
    });
  });

  // The dead-session detector is deliberately liberal: a false positive
  // costs one extra login (cheap) while a false negative would surface an
  // unrecoverable error to the agent — exactly the failure mode we're
  // fixing. fatal=1 is the canonical signal; the textual markers cover GCI
  // surfaces that report transport death without setting fatal.
  describe('isDeadSessionError', () => {
    it('treats fatal=1 as dead', () => {
      expect(isDeadSessionError({ ...noErr, fatal: 1, number: 4099 })).toBe(true);
    });

    it('detects the "invalid netConnection" marker', () => {
      expect(isDeadSessionError({
        ...noErr, number: 4099, message: 'lgc sendOutput: invalid netConnection',
      })).toBe(true);
    });

    it('detects a "not logged in" marker', () => {
      expect(isDeadSessionError({
        ...noErr, number: 4007, message: 'session is not logged in',
      })).toBe(true);
    });

    it('treats normal Smalltalk errors (DNU, ZeroDivide) as alive', () => {
      expect(isDeadSessionError({
        ...noErr, number: 2101, message: 'nil does not understand #foo',
      })).toBe(false);
    });
  });

  describe('auto-reconnect on dead session', () => {
    // Round-1 feedback: today, "lgc sendOutput: invalid netConnection"
    // surfaces as an opaque error and the user has to manually restart the
    // server. After this change the session transparently relogins and the
    // caller sees a SessionRestartedError they (or the agent) can retry.
    it('transparently re-logins after a netConnection-invalid error and throws SessionRestartedError', () => {
      const session = new McpSession(makeConfig());
      // First call: dead-session error. Second call: would succeed but we
      // expect throw before it ever runs.
      mockGci.GciTsExecuteFetchBytes.mockReturnValueOnce({
        data: '', bytesReturned: 0,
        err: { ...noErr, number: 4099, message: 'lgc sendOutput: invalid netConnection' },
      });

      // Constructor already logged in once; the auto-reconnect should log in again.
      expect(() => session.executeFetchString('whatever')).toThrow(SessionRestartedError);
      expect(mockGci.GciTsLogin).toHaveBeenCalledTimes(2);
    });

    it('rethrows a plain Error when reconnect itself fails', () => {
      const session = new McpSession(makeConfig());
      mockGci.GciTsExecuteFetchBytes.mockReturnValueOnce({
        data: '', bytesReturned: 0,
        err: { ...noErr, fatal: 1, message: 'gem died' },
      });
      mockGci.GciTsLogin.mockReturnValueOnce({
        session: null,
        err: { ...noErr, number: 4065, message: 'stone unavailable' },
      });

      expect(() => session.executeFetchString('1 + 1')).toThrow(/reconnect failed/);
    });

    // Cached Utf8 class OOPs are valid only for the session that produced
    // them. After a reconnect the new gem has different OOPs — we must
    // re-resolve, not reuse the cached value.
    it('clears the cached Utf8 OOP across a reconnect', () => {
      const session = new McpSession(makeConfig());
      // First call: succeeds, primes the cache.
      session.executeFetchString('1 + 1');
      // Second call: dead-session error → reconnect → throw.
      mockGci.GciTsExecuteFetchBytes.mockReturnValueOnce({
        data: '', bytesReturned: 0,
        err: { ...noErr, fatal: 1, message: 'gem died' },
      });
      expect(() => session.executeFetchString('2 + 2')).toThrow(SessionRestartedError);
      // Third call: must re-resolve Utf8 against the new session.
      const beforeResolve = mockGci.GciTsResolveSymbol.mock.calls.length;
      session.executeFetchString('3 + 3');
      expect(mockGci.GciTsResolveSymbol.mock.calls.length).toBe(beforeResolve + 1);
    });
  });

  describe('initScripts', () => {
    // The user pain: every restart, they re-paste `importlib grailDir: ... ;
    // CPythonShim libraryPath: ...`. The config-time init scripts replay
    // that block automatically — once on initial login, once after every
    // reconnect.
    it('runs each init script after the initial login', () => {
      new McpSession(makeConfig({
        initScripts: ['importlib grailDir: /opt/grail', 'CPythonShim libraryPath: /opt/py'],
      }));

      const codes = mockGci.GciTsExecuteFetchBytes.mock.calls.map((c: unknown[]) => c[1]);
      expect(codes).toContain('importlib grailDir: /opt/grail');
      expect(codes).toContain('CPythonShim libraryPath: /opt/py');
    });

    it('runs the init scripts again after an auto-reconnect', () => {
      const session = new McpSession(makeConfig({
        initScripts: ['importlib grailDir: /opt/grail'],
      }));
      mockGci.GciTsExecuteFetchBytes.mockClear();

      // Trigger a dead-session error → reconnect → init scripts replayed.
      mockGci.GciTsExecuteFetchBytes.mockReturnValueOnce({
        data: '', bytesReturned: 0,
        err: { ...noErr, fatal: 1, message: 'gem died' },
      });
      expect(() => session.executeFetchString('1 + 1')).toThrow(SessionRestartedError);

      const replayedScripts = mockGci.GciTsExecuteFetchBytes.mock.calls
        .map((c: unknown[]) => c[1])
        .filter((s: unknown) => s === 'importlib grailDir: /opt/grail');
      expect(replayedScripts).toHaveLength(1);
    });

    // Fail loud: if an init script doesn't compile/run, login fails — better
    // than letting the session run in a half-primed state and surprising the
    // user later.
    it('throws if an init script fails', () => {
      mockGci.GciTsExecuteFetchBytes.mockReturnValueOnce({
        data: '', bytesReturned: 0,
        err: { ...noErr, number: 1001, message: 'compile error: bad selector' },
      });

      expect(() => new McpSession(makeConfig({
        initScripts: ['this does not compile'],
      }))).toThrow(/init script 1 failed: compile error/);
    });
  });
});
