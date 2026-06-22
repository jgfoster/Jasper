import { describe, it, expect, vi } from 'vitest';
import { OOP_ILLEGAL } from '../gciConstants';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as debug from '../debugQueries';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };
const METHOD_OOP = 5000n;
const CLASS_OOP = 6000n;
const RECEIVER_OOP = 7000n;

/**
 * Creates a mock GCI that behaves like GemStone: single-word selectors work,
 * multi-word selectors (containing spaces) cause "does not understand" errors.
 *
 * This catches a class of bugs where GciTsPerform / GciTsPerformFetchBytes
 * are called with chained unary messages like 'inClass name' instead of
 * sending each message separately.
 */
function createMockSession(): ActiveSession {
  const mockGci = {
    GciTsPerform: vi.fn(
      (handle: unknown, receiver: bigint, selectorOop: bigint, selectorStr: string | null, args: bigint[]) => {
        if (selectorStr && selectorStr.includes(' ')) {
          return {
            result: 0n,
            err: { ...noErr, number: 2010, message: `a ${receiverClassName(receiver)} does not understand #'${selectorStr}'` },
          };
        }
        if (selectorStr === 'inClass' && receiver === METHOD_OOP) {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'class') {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'allInstVarNames') {
          return { result: 8000n, err: { ...noErr } };
        }
        return { result: 0n, err: { ...noErr } };
      },
    ),
    GciTsPerformFetchBytes: vi.fn(
      (handle: unknown, receiver: bigint, selector: string, args: bigint[], maxBytes: number) => {
        if (selector.includes(' ')) {
          return {
            data: '',
            err: { ...noErr, number: 2010, message: `a ${receiverClassName(receiver)} does not understand #'${selector}'` },
          };
        }
        if (selector === 'name' && receiver === CLASS_OOP) {
          return { data: 'SmallInteger', err: { ...noErr } };
        }
        if (selector === 'selector' && receiver === METHOD_OOP) {
          return { data: 'sizee', err: { ...noErr } };
        }
        if (selector === 'asString') {
          return { data: 'instVarName', err: { ...noErr } };
        }
        return { data: '', err: { ...noErr } };
      },
    ),
    GciTsFetchSize: vi.fn(() => ({ result: 0n, err: { ...noErr } })),
    GciTsFetchOops: vi.fn(() => ({ oops: [], err: { ...noErr } })),
    GciTsOopIsSpecial: vi.fn(() => false),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

function receiverClassName(oop: bigint): string {
  if (oop === METHOD_OOP) return 'GsNMethod';
  if (oop === CLASS_OOP) return 'Metaclass';
  return 'Object';
}

describe('debugQueries', () => {
  describe('getStepPoint', () => {
    const GS_PROCESS = 9000n;
    const LEVEL_OOP = 0xAAn;
    const STEP_POINT_OOP = 0xBBn;

    function stepPointSession(stepPointResultOop: bigint) {
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsI64ToOop: vi.fn(() => ({ result: LEVEL_OOP, err: { ...noErr } })),
          GciTsPerform: vi.fn(() => ({ result: stepPointResultOop, err: { ...noErr } })),
          GciTsOopToI64: vi.fn(() => ({ value: 2n, err: { ...noErr } })),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('sends _stepPointAt: with the frame level and returns the step point', () => {
      const session = stepPointSession(STEP_POINT_OOP);
      const result = debug.getStepPoint(session, GS_PROCESS, 3);

      expect(result).toBe(2);
      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(performCalls[0][1]).toBe(GS_PROCESS);      // receiver is the process
      expect(performCalls[0][3]).toBe('_stepPointAt:');  // selector
      expect(performCalls[0][4]).toEqual([LEVEL_OOP]);   // level arg
    });

    it('returns undefined (without converting) when the step point is nil', () => {
      const session = stepPointSession(0x14n /* OOP_NIL */);
      const result = debug.getStepPoint(session, GS_PROCESS, 3);

      expect(result).toBeUndefined();
      expect(session.gci.GciTsOopToI64).not.toHaveBeenCalled();
    });
  });

  describe('getMethodBlockInfo', () => {
    const BLOCK_METHOD_OOP = 5100n;
    const HOME_METHOD_OOP = 5200n;

    function blockSession(isBlockOop: bigint, homeOop: bigint) {
      return {
        id: 1,
        handle: {},
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.7.2',
        gci: {
          GciTsPerform: vi.fn(
            (_h: unknown, _r: bigint, _s: bigint, selector: string) => {
              if (selector === 'isMethodForBlock') return { result: isBlockOop, err: { ...noErr } };
              if (selector === 'homeMethod') return { result: homeOop, err: { ...noErr } };
              return { result: 0n, err: { ...noErr } };
            },
          ),
        } as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('reports a block method and its distinct home method', () => {
      const session = blockSession(0x10Cn /* OOP_TRUE */, HOME_METHOD_OOP);
      const result = debug.getMethodBlockInfo(session, BLOCK_METHOD_OOP);

      expect(result.isBlock).toBe(true);
      expect(result.homeMethodOop).toBe(HOME_METHOD_OOP);
    });

    it('reports a non-block method with homeMethod returning self', () => {
      const session = blockSession(0x0Cn /* OOP_FALSE */, BLOCK_METHOD_OOP);
      const result = debug.getMethodBlockInfo(session, BLOCK_METHOD_OOP);

      expect(result.isBlock).toBe(false);
      expect(result.homeMethodOop).toBe(BLOCK_METHOD_OOP);
    });
  });

  describe('getMethodInfo', () => {
    it('returns class name and selector by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getMethodInfo(session, METHOD_OOP);

      expect(result.className).toBe('SmallInteger');
      expect(result.selector).toBe('sizee');
    });

    it('does not send multi-word selectors to GciTsPerformFetchBytes', () => {
      const session = createMockSession();
      debug.getMethodInfo(session, METHOD_OOP);

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  describe('getObjectClassName', () => {
    it('returns class name by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getObjectClassName(session, RECEIVER_OOP);

      expect(result).toBe('SmallInteger');
    });

    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getObjectClassName(session, RECEIVER_OOP);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of performCalls) {
        const selectorStr = call[3] as string | null;
        if (selectorStr) expect(selectorStr).not.toContain(' ');
      }

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  describe('getMethodUriInfo', () => {
    it('parses tab-separated result into MethodUriInfo', () => {
      const session = createMockSession();
      // Mock GciTsResolveSymbol for Utf8 class
      (session.gci as unknown as Record<string, unknown>).GciTsResolveSymbol = vi.fn(() => ({
        result: 9000n, err: { ...noErr },
      }));
      // Mock GciTsExecuteFetchBytes to return tab-separated URI info
      (session.gci as unknown as Record<string, unknown>).GciTsExecuteFetchBytes = vi.fn(() => ({
        bytesReturned: 0,
        data: 'Globals\tSmallInteger\tinstance\tarithmetic\t/',
        err: { ...noErr },
      }));

      const result = debug.getMethodUriInfo(session, METHOD_OOP);

      expect(result).toEqual({
        dictName: 'Globals',
        className: 'SmallInteger',
        isMeta: false,
        category: 'arithmetic',
        selector: '/',
      });
    });

    it('returns undefined when GciTsResolveSymbol fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).GciTsResolveSymbol = vi.fn(() => ({
        result: 0n, err: { ...noErr, number: 2010, message: 'not found' },
      }));

      expect(debug.getMethodUriInfo(session, METHOD_OOP)).toBeUndefined();
    });

    it('returns undefined when GciTsExecuteFetchBytes fails', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).GciTsResolveSymbol = vi.fn(() => ({
        result: 9000n, err: { ...noErr },
      }));
      (session.gci as unknown as Record<string, unknown>).GciTsExecuteFetchBytes = vi.fn(() => ({
        bytesReturned: 0, data: '',
        err: { ...noErr, number: 1, message: 'error' },
      }));

      expect(debug.getMethodUriInfo(session, METHOD_OOP)).toBeUndefined();
    });

    it('parses class-side methods correctly', () => {
      const session = createMockSession();
      (session.gci as unknown as Record<string, unknown>).GciTsResolveSymbol = vi.fn(() => ({
        result: 9000n, err: { ...noErr },
      }));
      (session.gci as unknown as Record<string, unknown>).GciTsExecuteFetchBytes = vi.fn(() => ({
        bytesReturned: 0,
        data: 'Globals\tArray\tclass\tinstance creation\tnew',
        err: { ...noErr },
      }));

      const result = debug.getMethodUriInfo(session, METHOD_OOP);

      expect(result).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: true,
        category: 'instance creation',
        selector: 'new',
      });
    });
  });

  describe('getInstVarNames', () => {
    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getInstVarNames(session, RECEIVER_OOP);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of performCalls) {
        const selectorStr = call[3] as string | null;
        if (selectorStr) expect(selectorStr).not.toContain(' ');
      }

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  // These two used to call GciTsFetchNamedOops / GciTsFetchVaryingOops, which
  // don't exist in 3.6.2. They now use absolute GciTsFetchOops (present in
  // 3.6.2), so debugger/inspector variable display works on both 3.6.2 and 3.7.5.
  describe('instance variable fetch (3.6.2-compatible via GciTsFetchOops)', () => {
    function sessionWith(gci: Record<string, unknown>): ActiveSession {
      return {
        id: 1,
        handle: { h: 1 },
        login: { label: 'T' } as GemStoneLogin,
        stoneVersion: '3.6.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('getNamedInstVarOops fetches absolute OOPs starting at index 1', () => {
      const fetchOops = vi.fn(() => ({ result: 2, oops: [11n, 22n], err: { ...noErr } }));
      const session = sessionWith({ GciTsFetchOops: fetchOops });

      expect(debug.getNamedInstVarOops(session, 100n, 2)).toEqual([11n, 22n]);
      expect(fetchOops).toHaveBeenCalledWith(session.handle, 100n, 1n, 2);
    });

    it('getNamedInstVarOops returns [] for non-positive count without calling GCI', () => {
      const fetchOops = vi.fn();
      const session = sessionWith({ GciTsFetchOops: fetchOops });

      expect(debug.getNamedInstVarOops(session, 100n, 0)).toEqual([]);
      expect(fetchOops).not.toHaveBeenCalled();
    });

    it('getIndexedOops offsets the 1-based varying index by namedSize', () => {
      const fetchObjInfo = vi.fn(() => ({ info: { namedSize: 3 }, err: { ...noErr } }));
      const fetchOops = vi.fn(() => ({ result: 2, oops: [7n, 8n], err: { ...noErr } }));
      const session = sessionWith({ GciTsFetchObjInfo: fetchObjInfo, GciTsFetchOops: fetchOops });

      // First varying element (startIndex 1) of an object with 3 named instVars
      // is at absolute index 4.
      expect(debug.getIndexedOops(session, 100n, 1, 2)).toEqual([7n, 8n]);
      expect(fetchObjInfo).toHaveBeenCalledWith(session.handle, 100n, false, 0);
      expect(fetchOops).toHaveBeenCalledWith(session.handle, 100n, 4n, 2);
    });

    it('getIndexedOops returns [] (and skips the fetch) when GciTsFetchObjInfo errors', () => {
      const fetchObjInfo = vi.fn(() => ({ info: { namedSize: 0 }, err: { ...noErr, number: 2418 } }));
      const fetchOops = vi.fn();
      const session = sessionWith({ GciTsFetchObjInfo: fetchObjInfo, GciTsFetchOops: fetchOops });

      expect(debug.getIndexedOops(session, 100n, 1, 2)).toEqual([]);
      expect(fetchOops).not.toHaveBeenCalled();
    });

    it('neither path calls the post-3.6.2 GciTsFetchNamedOops / GciTsFetchVaryingOops', () => {
      const named = vi.fn();
      const varying = vi.fn();
      const session = sessionWith({
        GciTsFetchNamedOops: named,
        GciTsFetchVaryingOops: varying,
        GciTsFetchObjInfo: vi.fn(() => ({ info: { namedSize: 0 }, err: { ...noErr } })),
        GciTsFetchOops: vi.fn(() => ({ result: 0, oops: [], err: { ...noErr } })),
      });

      debug.getNamedInstVarOops(session, 100n, 2);
      debug.getIndexedOops(session, 100n, 1, 2);
      expect(named).not.toHaveBeenCalled();
      expect(varying).not.toHaveBeenCalled();
    });
  });

  // Regression for the eval-bar bug: typing "3 + 4" raised
  //   NameError 2404, _framePerform:withArgs:onLevel:, There is no Symbol …
  // because evaluateInFrame called a primitive that does NOT exist on 3.7.x (so
  // GciTsPerform couldn't resolve the selector). The fix evaluates the
  // expression via String>>evaluateInContext: with self = the frame receiver.
  // (We can't run real Smalltalk in unit tests — the live image confirms
  // `'3 + 4' evaluateInContext: nil` => 7 — so the mock supplies the printString
  // and we assert the *right call* is made, which is what regressed.)
  describe('evaluateInFrame ("3 + 4" regression)', () => {
    const GS_PROCESS = 9000n;
    const FRAME_ARRAY = 0xF0n;
    const FRAME_RECEIVER = 0x77n; // becomes `self` for the evaluation
    const EXPR_STRING = 0xE0n;
    const EVAL_RESULT = 0x07n;    // the oop the evaluation returned

    function evalSession() {
      const gci = {
        GciTsI64ToOop: vi.fn(() => ({ result: 0xAAn, err: { ...noErr } })),
        GciTsOopToI64: vi.fn(() => ({ value: 5n, err: { ...noErr } })),
        GciTsNewString: vi.fn(() => ({ result: EXPR_STRING, err: { ...noErr } })),
        GciTsFetchSize: vi.fn(() => ({ result: 10n, err: { ...noErr } })),
        // getFrameInfo reads [10]=receiver (0-indexed 9); [9]=names (0-indexed 8) = nil → skip names.
        GciTsFetchOops: vi.fn(() => ({
          oops: [1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0x14n /* OOP_NIL names */, FRAME_RECEIVER],
          err: { ...noErr },
        })),
        GciTsPerform: vi.fn((_h: unknown, _r: bigint, _sOop: bigint, sel: string | null) => {
          if (sel === '_frameContentsAt:') return { result: FRAME_ARRAY, err: { ...noErr } };
          if (sel === 'evaluateInContext:') return { result: EVAL_RESULT, err: { ...noErr } };
          return { result: 0n, err: { ...noErr } };
        }),
        // printString of the evaluation result (the EVAL_RESULT oop) is "7".
        GciTsPerformFetchBytes: vi.fn((_h: unknown, oop: bigint) =>
          oop === EVAL_RESULT
            ? { bytesReturned: 1, data: '7', err: { ...noErr } }
            : { bytesReturned: 0, data: '', err: { ...noErr } }),
      };
      return {
        id: 1, handle: {}, login: { label: 'T' } as GemStoneLogin, stoneVersion: '3.7.2',
        gci: gci as unknown as ActiveSession['gci'],
      } as ActiveSession;
    }

    it('returns the result printString ("7") for "3 + 4" instead of raising', () => {
      const session = evalSession();
      expect(debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3)).toBe('7');
    });

    it('evaluates via String>>evaluateInContext: with self = the frame receiver', () => {
      const session = evalSession();
      debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3);

      expect(session.gci.GciTsNewString).toHaveBeenCalledWith({}, '3 + 4');
      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      const evalCall = performCalls.find((c: unknown[]) => c[3] === 'evaluateInContext:');
      expect(evalCall).toBeDefined();
      expect(evalCall![1]).toBe(EXPR_STRING);         // receiver of evaluateInContext: is the expr String
      expect(evalCall![4]).toEqual([FRAME_RECEIVER]); // arg is the frame's receiver (self)
    });

    it('never sends the removed _framePerform:withArgs:onLevel: primitive (the original bug)', () => {
      const session = evalSession();
      debug.evaluateInFrame(session, GS_PROCESS, '3 + 4', 3);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      expect(performCalls.some((c: unknown[]) => c[3] === '_framePerform:withArgs:onLevel:')).toBe(false);
    });
  });
});
