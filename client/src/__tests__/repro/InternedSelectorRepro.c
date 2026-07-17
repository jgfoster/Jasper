/*
 * Standalone C reproduction of a GemStone finding. See README.md (same
 * directory) for the full write-up -- what we found, why picking a
 * made-up literal for a "selector cannot be resolved" test is fragile, and
 * what we verified (and didn't) about how far the effect reaches.
 *
 * This file loads libgcits dynamically (dlopen/dlsym) instead of linking
 * against GemStone's SDK headers, so it builds with nothing but a C compiler
 * and the shared library itself. Signatures below are transcribed from
 * gcits.hf / gci.ht (bundled in this repo under docs/3.7/) and cross-checked
 * against the koffi FFI declarations in ../../gciLibrary.ts.
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
 *   cc -o gci_repro InternedSelectorRepro.c          # macOS
 *   cc -o gci_repro InternedSelectorRepro.c -ldl     # Linux
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
 * Each case mints a fresh random tag rather than reusing fixed text: once a
 * given selector string has been compiled anywhere in a session (even as an
 * unrelated Symbol literal, not sent as a message), perform: on that exact
 * text switches from NameError to MessageNotUnderstood for the rest of that
 * session (see README). Re-running this binary re-rolls the tags, so it
 * reproduces reliably run after run instead of only reproducing the first
 * time any given tag is ever used.
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
#define OOP_ILLEGAL 0x01ULL
#define OOP_NIL     0x14ULL
#define OOP_FALSE   0x0cULL
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

/* gcits.hf:735-743 -- selector == OOP_ILLEGAL and selectorStr used, per the
 * header comment on this function (the alternative is selectorStr == NULL
 * and selector used). */
typedef OopType (*GciTsPerformFn)(
    GciSession sess,
    OopType receiver,
    OopType aSymbol,
    const char *selectorStr,
    const OopType *args,
    int numArgs,
    int flags,
    unsigned short environmentId,
    GciErrSType *err);

/* gcits.hf:978-979 */
typedef BoolType (*GciTsCommitFn)(GciSession sess, GciErrSType *err);

typedef enum { EXPECT_NAME_ERROR, EXPECT_DNU } Expectation;

/* Appends an 8-char random alnum suffix to `label` into `buf`, so every run
 * (and every case within a run) sends a selector this stone's sessions have
 * never seen before -- see the file header for why that matters. */
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

static int check_perform_error(GciTsPerformFn gciTsPerform, GciSession sess,
                                const char *label, const char *selector,
                                Expectation expect) {
  GciErrSType err;
  OopType result;
  int failed, sawNameError, sawDnu, ok;

  memset(&err, 0, sizeof(err));
  result = gciTsPerform(sess, OOP_FALSE, OOP_ILLEGAL, selector, NULL, 0, 0, 0, &err);

  failed = (result == OOP_ILLEGAL);
  sawNameError = failed && strstr(err.message, "NameError") != NULL;
  sawDnu = failed && strstr(err.message, "MessageNotUnderstood") != NULL;
  ok = failed && ((expect == EXPECT_NAME_ERROR) ? sawNameError : sawDnu);

  printf("[%s] %s\n", ok ? "PASS" : "FAIL", label);
  printf("      selector: %s\n", selector);
  printf("      result:   %s\n", failed ? err.message : "(message understood!)");

  return ok;
}

int main(int argc, char **argv) {
  const char *libPath, *stoneNrs, *gemNrs, *user, *password;
  void *lib;
  GciTsLoginFn gciTsLogin;
  GciTsExecuteFn gciTsExecute;
  GciTsPerformFn gciTsPerform;
  GciTsCommitFn gciTsCommit;
  GciTsLogoutFn gciTsLogout;
  GciErrSType loginErr, execErr, commitErr, logoutErr;
  BoolType executedSessionInit = 0;
  GciSession sess, otherSess;
  int allOk = 1;
  char sel[64], code[128];
  OopType execResult;

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
  gciTsPerform = (GciTsPerformFn) dlsym(lib, "GciTsPerform");
  gciTsCommit = (GciTsCommitFn) dlsym(lib, "GciTsCommit");
  gciTsLogout = (GciTsLogoutFn) dlsym(lib, "GciTsLogout");
  if (!gciTsLogin || !gciTsExecute || !gciTsPerform || !gciTsCommit || !gciTsLogout) {
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

  /* CASE 1: a selector this session has never seen raises NameError. */
  unique_tag(sel, sizeof(sel), "gciReproNeverSeen");
  allOk &= check_perform_error(gciTsPerform, sess,
      "never-before-seen selector raises NameError", sel, EXPECT_NAME_ERROR);

  /* CASE 2: repeating the exact same failed perform: doesn't change anything
   * -- a failed lookup by itself does not intern the selector. */
  unique_tag(sel, sizeof(sel), "gciReproRepeated");
  allOk &= check_perform_error(gciTsPerform, sess,
      "repeating the same failed perform: still raises NameError (1st)", sel, EXPECT_NAME_ERROR);
  allOk &= check_perform_error(gciTsPerform, sess,
      "repeating the same failed perform: still raises NameError (2nd)", sel, EXPECT_NAME_ERROR);

  /* CASE 3: once the exact selector text is compiled as a bare Symbol
   * literal -- completely unrelated to perform: or to Boolean -- the same
   * perform: call now raises MessageNotUnderstood instead. */
  unique_tag(sel, sizeof(sel), "gciReproLiteral");
  allOk &= check_perform_error(gciTsPerform, sess,
      "before the literal appears anywhere: NameError", sel, EXPECT_NAME_ERROR);
  memset(&execErr, 0, sizeof(execErr));
  snprintf(code, sizeof(code), "#%s", sel);
  execResult = gciTsExecute(sess, code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0, &execErr);
  if (execResult == OOP_ILLEGAL) {
    fprintf(stderr, "unexpected: compiling a bare Symbol literal failed: %s\n", execErr.message);
    allOk = 0;
  }
  allOk &= check_perform_error(gciTsPerform, sess,
      "after the literal appears once, unrelated to perform: MessageNotUnderstood", sel, EXPECT_DNU);

  /* CASE 4: the effect does not appear to reach other sessions, even across
   * an explicit commit -- we expected this to be a stone-wide effect (Symbol
   * creation is documented to bypass normal repository commit semantics so
   * new symbols are visible everywhere at once) but couldn't reproduce that
   * here. See the "still not sure" section in README.md. */
  unique_tag(sel, sizeof(sel), "gciReproCrossSession");
  memset(&execErr, 0, sizeof(execErr));
  snprintf(code, sizeof(code), "#%s", sel);
  gciTsExecute(sess, code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0, &execErr);
  memset(&commitErr, 0, sizeof(commitErr));
  gciTsCommit(sess, &commitErr);

  otherSess = gciTsLogin(stoneNrs, NULL, NULL, 0, gemNrs, user, password, 0, 0,
                         &executedSessionInit, &loginErr);
  if (!otherSess) {
    fprintf(stderr, "second GciTsLogin failed [%d]: %s\n", loginErr.number, loginErr.message);
    allOk = 0;
  } else {
    allOk &= check_perform_error(gciTsPerform, otherSess,
        "a brand new session still gets NameError for a selector another "
        "session just committed", sel, EXPECT_NAME_ERROR);
    memset(&logoutErr, 0, sizeof(logoutErr));
    gciTsLogout(otherSess, &logoutErr);
  }

  memset(&logoutErr, 0, sizeof(logoutErr));
  gciTsLogout(sess, &logoutErr);

  printf("\n%s\n", allOk ? "ALL CASES MATCHED EXPECTATIONS"
                         : "SOME CASES DID NOT MATCH EXPECTATIONS");
  return allOk ? 0 : 1;
}
