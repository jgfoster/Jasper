// postinstall hook: record the lockfile hash so pretest can detect later drift.
// See scripts/deps-guard.mjs.
import { writeStamp } from './deps-guard.mjs';

writeStamp();
