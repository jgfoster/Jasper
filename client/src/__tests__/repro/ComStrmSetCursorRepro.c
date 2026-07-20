/*
 * Standalone C reproduction of a GemStone compiler finding. See README.md
 * (same directory) for the full write-up -- what we found, the trigger
 * condition, our best guess at why, and the versions we checked (reproduces
 * 3.6.2 through 3.7.4.3; doesn't reproduce in 3.7.5).
 *
 * This file loads libgcits dynamically (dlopen/dlsym) instead of linking
 * against GemStone's SDK headers, so it builds with nothing but a C compiler
 * and the shared library itself. Signatures below are transcribed from
 * gcits.hf / gci.ht (bundled in this repo under docs/3.7/) and cross-checked
 * against the koffi FFI declarations in ../../gciLibrary.ts.
 *
 * This source file is UTF-8 encoded -- the non-ASCII literals below (an
 * em dash, some Latin-1 letters) are real multi-byte UTF-8 bytes, not
 * escapes.
 *
 * Easiest way to run this: from the repo root,
 *   ./client/src/__tests__/repro/run-c-repro.sh [gemstone-version]
 * That starts the test stone, compiles this file, and runs it with the
 * connection details and GEMSTONE_GLOBAL_DIR pulled automatically from
 * client/.env.test. Works on macOS and Linux.
 *
 * To build and run by hand instead:
 *
 * Build:
 *   cc -o gci_repro ComStrmSetCursorRepro.c          # macOS
 *   cc -o gci_repro ComStrmSetCursorRepro.c -ldl     # Linux
 *
 * Run:
 *   ./gci_repro <path-to-libgcits> <stoneNrs> <gemNrs> <user> <password>
 *
 * GEMSTONE_GLOBAL_DIR must be set in the environment first, pointing at the
 * GemStone installation's `global` directory -- without it, login fails with
 * "NetLDI service ... not found on node 'localhost'" even though the NetLDI
 * is actually running (it's how local NRS name resolution finds it).
 *
 * Example, using this repo's own test stone (see client/.env.test after
 * `npm run test:server:start` for the exact values):
 *   export GEMSTONE_GLOBAL_DIR=.../GemStone64Bit3.6.2-arm64.Darwin/global
 *   ./gci_repro \
 *     .../GemStone64Bit3.6.2-arm64.Darwin/lib/libgcits-3.6.2-64.dylib \
 *     '!tcp@localhost#server!jasper-test-3.6.2-gs64-stone' \
 *     '!tcp@localhost#netldi:jasper-test-3.6.2-gs64-ldi#task!gemnetobject' \
 *     DataCurator swordfish
 *
 * Each case mints a fresh random tag rather than reusing fixed text: GemStone
 * appears to cache something keyed on exact source text, so a failing
 * snippet can stop reproducing after enough repeat attempts with that exact
 * text (verified directly against the JS harness this was ported from).
 * Re-running this binary re-rolls the tags, so it should reproduce reliably
 * run after run.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>
#include <dlfcn.h>
#include <unistd.h>

typedef uint64_t OopType;
typedef void *GciSession;
typedef int BoolType;

#define GCI_ERR_STR_SIZE 1024
#define GCI_MAX_ERR_ARGS 10

/* gci.ht:221-259 */
typedef struct {
  OopType       category;
  OopType       context;
  OopType       exceptionObj;
  OopType       args[GCI_MAX_ERR_ARGS];
  int           number;
  int           argCount;
  unsigned char fatal;
  char          message[GCI_ERR_STR_SIZE + 1];
  char          reason[GCI_ERR_STR_SIZE + 1];
} GciErrSType;

/* Well-known OOPs, from gcioop.ht (mirrored in ../../gciConstants.ts) */
#define OOP_ILLEGAL    0x01ULL
#define OOP_NIL        0x14ULL
#define OOP_CLASS_UTF8 154113ULL

/* gcits.hf:72-83 */
typedef GciSession (*GciTsLoginFn)(
    const char *stoneNameNrs,
    const char *hostUserId,
    const char *hostPassword,
    BoolType hostPwIsEncrypted,
    const char *gemServiceNrs,
    const char *gemstoneUsername,
    const char *gemstonePassword,
    unsigned int loginFlags,
    int haltOnErrNum,
    BoolType *executedSessionInit, /* out */
    GciErrSType *err);             /* out */

/* gcits.hf:181-182 */
typedef BoolType (*GciTsLogoutFn)(GciSession sess, GciErrSType *err);

/* gcits.hf:931-938 */
typedef OopType (*GciTsExecuteFn)(
    GciSession sess,
    const char *sourceStr,
    OopType sourceOop,
    OopType contextObject,
    OopType symbolList,
    int flags,
    unsigned short environmentId,
    GciErrSType *err);

typedef enum { EXPECT_SUCCESS, EXPECT_CURSOR_ERROR } Expectation;

/* Appends an 8-char random alnum suffix to `label` into `buf`, so every run
 * (and every case within a run) uses text GemStone has never compiled
 * before -- see the file header for why that matters. */
static void unique_tag(char *buf, size_t bufSize, const char *label) {
  static const char alphabet[] = "abcdefghijklmnopqrstuvwxyz0123456789";
  char suffix[9];
  int i;
  for (i = 0; i < 8; i++) {
    suffix[i] = alphabet[rand() % (sizeof(alphabet) - 1)];
  }
  suffix[8] = '\0';
  snprintf(buf, bufSize, "%s%s", label, suffix);
}

static int run_case(GciTsExecuteFn gciTsExecute, GciSession sess,
                     const char *label, const char *code, Expectation expect) {
  GciErrSType err;
  OopType result;
  int failedToCompile, sawCursorError, ok;

  memset(&err, 0, sizeof(err));
  result = gciTsExecute(sess, code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0, &err);

  failedToCompile = (result == OOP_ILLEGAL);
  sawCursorError = failedToCompile && strstr(err.message, "ComStrmSetCursor") != NULL;
  ok = (expect == EXPECT_SUCCESS) ? !failedToCompile : sawCursorError;

  printf("[%s] %s\n", ok ? "PASS" : "FAIL", label);
  printf("      code:   %s\n", code);
  printf("      result: %s\n",
         failedToCompile ? err.message : "(compiled successfully)");

  return ok;
}

int main(int argc, char **argv) {
  const char *libPath, *stoneNrs, *gemNrs, *user, *password;
  void *lib;
  GciTsLoginFn gciTsLogin;
  GciTsExecuteFn gciTsExecute;
  GciTsLogoutFn gciTsLogout;
  GciErrSType loginErr, logoutErr;
  BoolType executedSessionInit = 0;
  GciSession sess;
  int allOk = 1;
  char var[32], val[64], key[64], msg[128], code[256];

  if (argc != 6) {
    fprintf(stderr,
      "usage: %s <path-to-libgcits> <stoneNrs> <gemNrs> <user> <password>\n\n"
      "GEMSTONE_GLOBAL_DIR must be set in the environment first (the "
      "installation's `global` directory) -- without it, login fails with "
      "\"NetLDI service ... not found\" even though it's running.\n\n"
      "example (this repo's own test stone -- see client/.env.test):\n"
      "  export GEMSTONE_GLOBAL_DIR=.../GemStone64Bit3.6.2-arm64.Darwin/global\n"
      "  %s \\\n"
      "    .../GemStone64Bit3.6.2-arm64.Darwin/lib/libgcits-3.6.2-64.dylib \\\n"
      "    '!tcp@localhost#server!jasper-test-3.6.2-gs64-stone' \\\n"
      "    '!tcp@localhost#netldi:jasper-test-3.6.2-gs64-ldi#task!gemnetobject' \\\n"
      "    DataCurator swordfish\n",
      argv[0], argv[0]);
    return 2;
  }
  libPath = argv[1];
  stoneNrs = argv[2];
  gemNrs = argv[3];
  user = argv[4];
  password = argv[5];

  lib = dlopen(libPath, RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "dlopen failed: %s\n", dlerror());
    return 1;
  }

  gciTsLogin = (GciTsLoginFn) dlsym(lib, "GciTsLogin");
  gciTsExecute = (GciTsExecuteFn) dlsym(lib, "GciTsExecute");
  gciTsLogout = (GciTsLogoutFn) dlsym(lib, "GciTsLogout");
  if (!gciTsLogin || !gciTsExecute || !gciTsLogout) {
    fprintf(stderr, "dlsym failed to resolve a GCI function: %s\n", dlerror());
    return 1;
  }

  /* time(NULL) alone has 1-second resolution -- two runs launched within the
   * same second would otherwise get the same seed and mint identical tags,
   * which would silently defeat the point of unique_tag() (see file header). */
  srand((unsigned) time(NULL) ^ (unsigned) getpid());

  memset(&loginErr, 0, sizeof(loginErr));
  sess = gciTsLogin(stoneNrs, NULL, NULL, 0, gemNrs, user, password, 0, 0,
                     &executedSessionInit, &loginErr);
  if (!sess) {
    fprintf(stderr, "GciTsLogin failed [%d]: %s\n", loginErr.number, loginErr.message);
    return 1;
  }

  /* SAFE: bare non-ASCII literal, nothing else in the doit */
  unique_tag(val, sizeof(val), "\xe2\x80\x94" /* em dash */);
  snprintf(code, sizeof(code), "'%s'", val);
  allOk &= run_case(gciTsExecute, sess,
      "bare non-ASCII literal, nothing else in the doit", code, EXPECT_SUCCESS);

  /* TRIGGER: non-ASCII literal assigned (:=) to a declared temp */
  unique_tag(var, sizeof(var), "t");
  unique_tag(val, sizeof(val), "\xe2\x80\x94");
  snprintf(code, sizeof(code), "| %s | %s := '%s'", var, var, val);
  allOk &= run_case(gciTsExecute, sess,
      "non-ASCII literal assigned to a declared temp", code, EXPECT_CURSOR_ERROR);

  /* TRIGGER: non-ASCII literal stored via at:put:, no temp declared at all */
  unique_tag(key, sizeof(key), "GciNonAsciiSourceScratch");
  unique_tag(val, sizeof(val), "\xe2\x80\x94");
  snprintf(code, sizeof(code), "UserGlobals at: #%s put: '%s'. UserGlobals at: #%s",
           key, val, key);
  allOk &= run_case(gciTsExecute, sess,
      "non-ASCII literal stored via at:put:, even with no temp declared",
      code, EXPECT_CURSOR_ERROR);

  /* SAFE: temp declared but unused; non-ASCII text in an unrelated statement */
  unique_tag(var, sizeof(var), "t");
  unique_tag(val, sizeof(val), "\xe2\x80\x94");
  snprintf(code, sizeof(code), "| %s | '%s'", var, val);
  allOk &= run_case(gciTsExecute, sess,
      "declared-but-unused temp, non-ASCII text in an unrelated statement",
      code, EXPECT_SUCCESS);

  /* SAFE: ^-return guard-clause idiom (the queries/ pattern), non-ASCII text */
  unique_tag(msg, sizeof(msg), "Not found: \xc3\x91o\xc3\xb1o\xe2\x80\x94" /* Ñoño— */);
  snprintf(code, sizeof(code),
           "| base | base := nil. base ifNil: [^ '%s']. 'unreachable'", msg);
  allOk &= run_case(gciTsExecute, sess,
      "^-return guard-clause idiom, non-ASCII text", code, EXPECT_SUCCESS);

  /* Added 2026-07-18 -- see README's Update section, "Open question 1"
   * (session poisoning). Ported from the equivalent Vitest test in
   * ComStrmSetCursorRepro.test.ts. Deliberately a fixed sequence on the
   * SAME session established above, not independent cases -- the sequence
   * itself is what's under test. */
  printf("\n--- session-poisoning check (README's Update, open question 1) ---\n");
  allOk &= run_case(gciTsExecute, sess,
      "ascii-only, before the poisoning throw", "1 + 1", EXPECT_SUCCESS);

  unique_tag(var, sizeof(var), "t");
  unique_tag(val, sizeof(val), "\xe2\x80\x94");
  snprintf(code, sizeof(code), "| %s | %s := '%s'. %s printString", var, var, val, var);
  allOk &= run_case(gciTsExecute, sess,
      "poisoning throw", code, EXPECT_CURSOR_ERROR);

  allOk &= run_case(gciTsExecute, sess,
      "ascii-only, after (unrelated)", "2 + 2", EXPECT_SUCCESS);
  allOk &= run_case(gciTsExecute, sess,
      "ascii-only, after (temp declared and referenced)",
      "| x | x := 5. x printString", EXPECT_SUCCESS);

  unique_tag(var, sizeof(var), "t");
  unique_tag(val, sizeof(val), "\xe2\x80\x94");
  snprintf(code, sizeof(code), "| %s | %s := '%s'. %s printString", var, var, val, var);
  allOk &= run_case(gciTsExecute, sess,
      "fresh non-ASCII throw, after (still throws?)", code, EXPECT_CURSOR_ERROR);

  memset(&logoutErr, 0, sizeof(logoutErr));
  gciTsLogout(sess, &logoutErr);

  printf("\n%s\n", allOk ? "ALL CASES MATCHED EXPECTATIONS"
                         : "SOME CASES DID NOT MATCH EXPECTATIONS");
  return allOk ? 0 : 1;
}
