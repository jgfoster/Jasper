import { describe, it, expect, beforeEach, vi } from 'vitest';

// Functions that older / client GCI libraries do NOT export.
// The GciTs* functions below (per a gcits.hf diff of 3.6.2 vs 3.7.5) were added
// after 3.6.2; the NbLogin/Debug ones are also absent from Windows client DLLs.
const OPTIONAL_FUNCTIONS = [
  'GciTsLogin_',
  'GciTsFetchNamedOops',
  'GciTsFetchVaryingOops',
  'GciTsStoreNamedOops',
  'GciTsStoreIdxOops',
  'GciTsNbPoll',
  'GciTsAddOopsToNsc',
  'GciTsPerformFetchOops',
  'GciTsFetchGbjInfo',
  'GciTsNewStringFromUtf16',
  'GciTsDirtyExportedObjs',
  'GciTsKeepAliveCount',
  'GciTsKeyfilePermissions',
  'GciTsNbLogin',
  'GciTsNbLogin_',
  'GciTsNbLoginFinished',
  'GciTsDebugConnectToGem',
  'GciTsDebugStartDebugService',
];

// Mock koffi before importing GciLibrary
vi.mock('koffi', () => {
  const stubFn = vi.fn();
  const mockLib = {
    func: vi.fn((signature: string) => {
      for (const name of OPTIONAL_FUNCTIONS) {
        if (signature.includes(name)) {
          throw new Error(`Cannot find function '${name}' in shared library`);
        }
      }
      return stubFn;
    }),
    unload: vi.fn(),
  };
  return {
    default: {
      struct: vi.fn(() => 'MockStruct'),
      array: vi.fn(() => 'MockArray'),
      opaque: vi.fn(() => 'MockOpaque'),
      pointer: vi.fn(() => 'MockPointer'),
      union: vi.fn(() => 'MockUnion'),
      load: vi.fn(() => mockLib),
    },
  };
});

import { GciLibrary } from '../gciLibrary';

// ── GciLibrary optional function bindings ────────────────

describe('GciLibrary with Windows client DLL (missing optional functions)', () => {
  let gci: GciLibrary;

  beforeEach(() => {
    // Constructor should succeed even though 5 functions are missing
    gci = new GciLibrary('C:\\fake\\libgcits-3.7.5-64.dll');
  });

  it('constructs successfully when optional functions are missing', () => {
    expect(gci).toBeDefined();
  });

  it('throws descriptive error when calling GciTsLogin_ (absent in 3.6.2)', () => {
    expect(() =>
      gci.GciTsLogin_(null, null, null, false, null, 'user', 'pass', null, 0, 0),
    ).toThrow('GciTsLogin_ is not available in this GCI library');
  });

  // Functions added after 3.6.2 (found via the gcits.hf diff) must not crash
  // the constructor; calling them on an older library throws a clear error.
  it('throws descriptive error when calling GciTsKeepAliveCount (added after 3.6.2)', () => {
    expect(() => gci.GciTsKeepAliveCount(null)).toThrow(
      'GciTsKeepAliveCount is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsKeyfilePermissions (added after 3.6.2)', () => {
    expect(() => gci.GciTsKeyfilePermissions(null)).toThrow(
      'GciTsKeyfilePermissions is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsFetchNamedOops (added after 3.6.2)', () => {
    expect(() => gci.GciTsFetchNamedOops(null, 0n, 0n, 1)).toThrow(
      'GciTsFetchNamedOops is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsNbLogin', () => {
    expect(() => gci.GciTsNbLogin(null, null, null, false, null, 'user', 'pass', 0, 0)).toThrow(
      'GciTsNbLogin is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsNbLogin_', () => {
    expect(() =>
      gci.GciTsNbLogin_(null, null, null, false, null, 'user', 'pass', null, 0, 0),
    ).toThrow('GciTsNbLogin_ is not available in this GCI library');
  });

  it('throws descriptive error when calling GciTsNbLoginFinished', () => {
    expect(() => gci.GciTsNbLoginFinished(null)).toThrow(
      'GciTsNbLoginFinished is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsDebugConnectToGem', () => {
    expect(() => gci.GciTsDebugConnectToGem(12345)).toThrow(
      'GciTsDebugConnectToGem is not available in this GCI library',
    );
  });

  it('throws descriptive error when calling GciTsDebugStartDebugService', () => {
    expect(() => gci.GciTsDebugStartDebugService(null, 0n)).toThrow(
      'GciTsDebugStartDebugService is not available in this GCI library',
    );
  });
});
