import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mockKoffiModule } from '../../__mocks__/koffi';

vi.mock('koffi', () => mockKoffiModule(() => vi.fn()));

import koffi from 'koffi';
import { GciLibrary } from '../../gciLibrary';
import { fakeNativeSocketLibrary } from '../../__tests__/support/fakeNativeSocketLibrary';

// On Linux a full install's libnetldi is loaded globally before libgcits.
// GemTalk's client-only package has no libnetldi, so a library loaded from it
// must not try.

const originalPlatform = process.platform;
let dir: string;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-netldi-'));
  vi.mocked(koffi.load).mockClear();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

function loadedPaths(): string[] {
  return vi.mocked(koffi.load).mock.calls.map((c) => String(c[0]));
}

describe('loading the GCI library on Linux', () => {
  it('loads libnetldi first when it sits beside libgcits, as in a full install', () => {
    const gcits = path.join(dir, 'libgcits-3.7.6-64.so');
    const netldi = path.join(dir, 'libnetldi-3.7.6-64.so');
    fs.writeFileSync(netldi, '');

    new GciLibrary(gcits, fakeNativeSocketLibrary());

    expect(loadedPaths()).toEqual([netldi, gcits]);
  });

  it('loads libgcits alone from the client-only package, which has no libnetldi', () => {
    const gcits = path.join(dir, 'libgcits-3.7.6-64.so');

    new GciLibrary(gcits, fakeNativeSocketLibrary());

    expect(loadedPaths()).toEqual([gcits]);
  });
});
