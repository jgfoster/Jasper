// On-demand GCI smoke tests for the unified "Inspect It" routing.
//
// Inspect It routes to the Enhanced Inspector when the session reports it as
// available, and otherwise falls back to the classic Inspector tree view. Both
// halves of that decision run real Smalltalk against the image, and both were
// invisible to the unit tests — which only string-match the generated code and
// mock the availability flag. These two tests exercise the real thing on a
// live stone, which is where the recent "blank enhanced inspector" surfaced.
//
// Gated behind the 'gci' vitest project (npm run test:gci); needs a stone.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// browserQueries / debugQueries → gciLog → vscode, so stub the surface they
// touch at module load. (enhancedInspectorInstall only imports a type +
// executeFetchString, so this covers it too.)
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';
import * as debug from '../../debugQueries';
import {
  isEnhancedInspectorInstalled,
  supportsEnhancedInspector,
} from '../../enhancedInspectorInstall';
import { refreshEnhancedInspectorAvailable } from '../../enhancedInspectorAvailability';

const OOP_NIL = 0x14n;

describe('Inspect It routing (integration)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;

  beforeAll(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();

    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      // Use the stone's actual version, not a hardcoded fixture — the routing
      // decision now depends on it (the Enhanced Inspector is gated to 3.7.5+),
      // so an honest version is what makes the gated assertion below meaningful.
      stoneVersion: gci.GciTsVersion().version,
    };
  });

  afterAll(() => {
    if (session?.handle) {
      gci.GciTsLogout(session.handle);
    }
    gci.close();
  });

  // The routing flag is set from the LIGHTWEIGHT probe (marker class only), but
  // a usable Enhanced Inspector also needs the Object>>gtViewsInCurrentContext
  // extension (the DEEP check). If the lightweight probe ever reports available
  // while the deep check does not — a partial install — Inspect It opens a blank
  // enhanced panel instead of falling back to the tree. On any healthy image the
  // two agree (both true when fully installed, both false when absent); this
  // guards the exact gap the blank-tab episode exposed.
  it('the availability probe and the deep install check agree', () => {
    const available = queries.checkEnhancedInspectorAvailable(session);
    const installed = isEnhancedInspectorInstalled(session);

    expect(typeof available).toBe('boolean');
    expect(typeof installed).toBe('boolean');
    expect(available).toBe(installed);
  });

  // The flag that Inspect It actually routes on is set by
  // refreshEnhancedInspectorAvailable, which gates the raw probe behind the
  // 3.7.5+ version requirement. On a supported stone it must equal the raw
  // probe; on an older one it must be false regardless of what the probe finds.
  // Written against the live stone's real version so it stays correct across the
  // whole CI version matrix, not just 3.7.5.
  it('routes to the enhanced inspector only on a supported version with the classes present', () => {
    const routed = refreshEnhancedInspectorAvailable(session);

    const supported = supportsEnhancedInspector(session.stoneVersion);
    const probe = queries.checkEnhancedInspectorAvailable(session);
    expect(routed).toBe(supported && probe);
    if (!supported) {
      expect(routed).toBe(false);
    }
  });

  // When the enhanced inspector is absent, every Inspect It falls back to the
  // classic tree view, which reads an object's structure through these debug
  // queries. `Globals` is a live SymbolDictionary present on every stone, so it
  // is a stable fixture for the dictionary branch the tree provider uses.
  it('the classic-inspector fallback reads a live object through the real queries', () => {
    const { result: globalsOop, err } = gci.GciTsResolveSymbol(session.handle, 'Globals', OOP_NIL);
    expect(err.number).toBe(0);

    expect(debug.getObjectClassName(session, globalsOop)).toBe('SymbolDictionary');
    expect(debug.getObjectPrintString(session, globalsOop, 1024).length).toBeGreaterThan(0);

    const keys = debug.getDictionaryEntries(session, globalsOop).map((e) => e.key);
    expect(keys).toContain('Array');
    expect(keys).toContain('String');
  });
});
