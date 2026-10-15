import { ActiveSession } from '../activeSession';
import type { GciLibrary } from '../gciLibrary';
import type { GemStoneLogin } from '../loginTypes';

type FakeFields = Partial<Omit<ActiveSession, 'gci' | 'login'>> & {
  gci?: object;
  login?: Partial<GemStoneLogin>;
};

/**
 * A real `ActiveSession` for unit tests, built around a fake GCI library and
 * whichever fields the test cares about. Fields it leaves out stay
 * `undefined` (except `id`, which defaults to 1), and the fake library
 * answers only the calls it defines.
 */
export function fakeActiveSession(fields: FakeFields = {}): ActiveSession {
  const { id = 1, gci, handle, login, stoneVersion, ...state } = fields;
  return Object.assign(
    new ActiveSession(
      id,
      gci as GciLibrary,
      handle,
      login as GemStoneLogin,
      stoneVersion as string,
    ),
    state,
  );
}
