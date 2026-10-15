import { describe, it, expect, vi } from 'vitest';
import type { GemStoneLogin } from '../loginTypes';
import { fakeActiveSession } from './fakeActiveSession';

const login: GemStoneLogin = {
  label: '',
  version: '3.7.5',
  gem_host: 'gemhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: 'swordfish',
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};

function libraryWhoseLoginAnswers(result: {
  session: unknown;
  err: { number: number; message: string };
}) {
  return {
    GciTsLogin: vi.fn(() => result),
  };
}

function sessionOn(gci: object) {
  return fakeActiveSession({ gci, handle: {}, login, stoneVersion: '3.7.5 build 1' });
}

describe('a transient login', () => {
  it('logs in on the same library with the given credentials', () => {
    const gci = libraryWhoseLoginAnswers({ session: {}, err: { number: 0, message: '' } });
    const session = sessionOn(gci);

    session.transientLogin({ ...login, gs_user: 'SystemUser', gs_password: 'secret' });

    expect(gci.GciTsLogin).toHaveBeenCalledWith(
      '!tcp@gemhost#server!gs64stone',
      null,
      null,
      false,
      '!tcp@gemhost#netldi:gs64ldi#task!gemnetobject',
      'SystemUser',
      'secret',
      0,
      0,
    );
  });

  it('answers an unregistered session on the new login', () => {
    const newHandle = {};
    const gci = libraryWhoseLoginAnswers({ session: newHandle, err: { number: 0, message: '' } });
    const session = sessionOn(gci);
    const systemUser = { ...login, gs_user: 'SystemUser' };

    const transient = session.transientLogin(systemUser).session!;

    expect(transient.id).toBe(-1);
    expect(transient.gci).toBe(gci);
    expect(transient.handle).toBe(newHandle);
    expect(transient.login).toBe(systemUser);
    expect(transient.stoneVersion).toBe(session.stoneVersion);
  });

  it("answers GemStone's error and no session when the login is refused", () => {
    const err = { number: 4051, message: 'Login denied' };
    const session = sessionOn(libraryWhoseLoginAnswers({ session: null, err }));

    const refused = session.transientLogin(login);

    expect(refused.session).toBeUndefined();
    expect(refused.err).toBe(err);
  });
});

describe('logging a session out', () => {
  it('logs out its own handle with the raw GCI call', () => {
    const handle = {};
    const gci = { GciTsLogout: vi.fn() };
    const session = fakeActiveSession({ gci, handle });

    session.GciTsLogout();

    expect(gci.GciTsLogout.mock.calls[0][0]).toBe(handle);
  });

  it('logs out its own handle through the library logout that warns on failure', () => {
    const handle = {};
    const gci = { logout: vi.fn() };
    const session = fakeActiveSession({ gci, handle });

    session.logout();

    expect(gci.logout.mock.calls[0][0]).toBe(handle);
  });
});
