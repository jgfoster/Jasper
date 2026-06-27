// Vite only makes variables prefixed with `VITE_` available in `process.env`
// during tests. A `.env.test` entry named `GEMSTONE_GLOBAL_DIR` (without the
// prefix) would not reach test code at all.
//
// However, GemStone expects the environment variable to be named
// `GEMSTONE_GLOBAL_DIR`. We therefore read `VITE_GEMSTONE_GLOBAL_DIR` (exposed
// by Vite) and copy it to `GEMSTONE_GLOBAL_DIR` here, so each GemStone version
// can point at its own global directory without conflicting with others running
// locally at the same time.
if (process.env.GEMSTONE_GLOBAL_DIR) {
  throw new Error("GEMSTONE_GLOBAL_DIR is not expected to be set when running tests.")
}
process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;