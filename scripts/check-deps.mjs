// pretest hook: fail fast when node_modules has drifted from package-lock.json.
// See scripts/deps-guard.mjs.
import { runCheck } from './deps-guard.mjs';

runCheck();
