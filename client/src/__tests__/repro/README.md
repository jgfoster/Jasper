# ComStrmSetCursor: a GemStone compiler finding

While building Jasper (our VS Code extension for GemStone Smalltalk), we ran
into a case where the compiler doesn't handle certain non-ASCII source text.
We wanted to write up what we found and share it, in case it's useful for
your team.

## The symptom

Compiling source with a non-ASCII (multi-byte UTF-8) character, in a
particular shape, produces:

```
a CompileError occurred (error 1001), Internal logic error in compiler:
ComStrmSetCursor: new cursor out of range
```

There's no fallback — the compile just fails with that error.

## The trigger

It's not simply "any non-ASCII character causes this." The condition is
narrower, and a bit surprising.

| Shape | Reproduces? |
|---|---|
| A bare non-ASCII literal | No |
| `^` returning a non-ASCII literal | No |
| `:=` assigning a non-ASCII literal to a temp | Yes |
| `at:put:` storing a non-ASCII literal | Yes |

*(This table holds as the first attempt against a given stone. See
[Update (2026-07-18)](#update-2026-07-18) below: the same shapes can stop
reproducing after enough unrelated non-ASCII compiler activity has
accumulated on that stone.)*

The pattern we found: a non-ASCII character seems fine sitting in an *inert*
expression. It triggers the error once it's the value being **stored**.

One thing we should flag: that rule doesn't cover everything we found. One of
our own query functions (`getBaseMethodSource.ts`) does a *read*
(`at:otherwise:`), not a store — and it still reproduces this once wrapped in
its actual `ifNotNil:`/`ifNil:` shape. So "store vs. read" isn't the whole
picture. We're treating the table above as our best isolation so far, not a
finished rule, and we'd genuinely welcome your take on it.

## Our best guess at what's happening

We don't have access to the compiler's source, so everything here comes from
observing behavior rather than reading the implementation — please take it
as a hypothesis, not a diagnosis.

One documented detail does line up with this idea, though: the GemBuilder
for C manual notes that a compiler error carries "the offset into the source
string at which the error occurred." That tells us the compiler does track a
source position for errors — which is exactly the kind of value a
byte-vs-character-length mismatch could throw off.

## Versions we checked

| Version | Reproduces? |
|---|---|
| 3.6.2 | Yes |
| 3.6.8 | Yes |
| 3.7.2 | Yes |
| 3.7.4.3 | Yes |
| 3.7.5 | No |

We found this by binary search across the GemStone release matrix we test
Jasper against. 3.7.4.3 and 3.7.5 are adjacent in that matrix, so we haven't
pinned down exactly where in between the behavior changed — or whether it
was an intentional fix or a side effect of other changes.

## Things we're still not sure about

We'd love your perspective on either of these, if you have one:

- Hitting this once seems to affect later, unrelated compiles on the same
  session. We don't know the scope — that session? that gem process?
  something wider?
- The exact same source text stopped reproducing after we'd tried it enough
  times, while a fresh, never-used snippet reproduced every time. We're not
  sure if that's the same mechanism as the session issue above, or something
  separate.

## Update (2026-07-18)

We (well, a Claude Code session digging into this with us) went back and
tried to resolve the two open questions above, plus retest the trigger
table itself. Some of what we thought we knew didn't hold up.

### The trigger table isn't stable

We reran the exact single-statement `:=` case from the table above, on a
stone that had already been through a long, varied session of other
non-ASCII compiles. It didn't reproduce anymore. Restarted the stone fresh
and ran the identical code as the very first call: it reproduced exactly as
the table says. So the table is accurate, but only as a first attempt
against a given stone. Something about accumulated compiler activity shifts
whether a given shape reproduces, and we don't yet know what specifically
drives that (total compile count, non-ASCII byte count, something else
entirely).

This also gives us a competing candidate for the actual trigger, alongside
"storing a value": whether a *later statement* resolves a name at all
(a temp or a global), independent of whether that name touches the
non-ASCII text. For example:

```smalltalk
#'x—y' printString. Object name      "throws"
#'x—y' printString. 3 class name     "doesn't -- no name to resolve"
```

We think this fits our own `getBaseMethodSource.ts` exception (a read,
not a store, that still reproduces once wrapped in `ifNotNil:`/`ifNil:`)
better than the store/read framing did. We're not confident this is the
whole story either, given the stone-state drift above; we're noting it as
a better-fitting hypothesis, not a replacement rule.

### Open question 1 (session poisoning): no evidence found

We ran an ascii-only compile, then a compile we knew would throw, then two
more ascii-only compiles, then a fresh non-ASCII shape, all in the same
session. Every one behaved exactly as expected on its own terms -- no
carryover from the earlier throw. We couldn't get this to reproduce, in any
shape we tried.

### Open question 2 (same text eventually stops reproducing): not from repetition

The same throwing text, repeated 10 times in one session and across 5 fresh
sessions, threw every single time -- so it isn't simply "run the same
snippet enough times," and the `unique()` comment's stated reason (text-keyed
caching) looks incorrect. What we actually saw drift was tied to a long
session of *varied* non-ASCII activity (see above), not repetition of one
fixed string. That's a narrower and different claim than what we originally
wrote, and we'd guess it's the same underlying mechanism as the trigger-table
instability, though we haven't confirmed that.

### Versions

Re-ran the full matrix independently: same result as above (3.6.2, 3.6.8,
3.7.2, and 3.7.4.3 reproduce; 3.7.5 doesn't).

### Where this leaves us

We don't have a complete rule yet. What changed: we no longer think "store
vs. inert" is the deciding factor, we have a competing hypothesis that fits
our own exception case better, and we have a name for the thing we
couldn't explain before (stone-lifetime accumulation) even though we can't
yet say what specifically accumulates. Flagging this rather than
smoothing it over, since anyone trying to reproduce this against our
existing table should know it can look different depending on what's
already run against that stone.

## Reproducing this

We put together two versions of the same repro: a TypeScript/Vitest test,
and a standalone C program. Use whichever's more convenient.

### TypeScript (Vitest)

```sh
npm install                    # once, from the repo root
npm run test:server:start      # starts a local test stone
npm run test:gci -- src/__tests__/repro/ComStrmSetCursorRepro.test.ts
```

To check a specific GemStone version:

```sh
npm run test:server:stop
npm run test:server:start -- 3.7.5
npm run test:gci -- src/__tests__/repro/ComStrmSetCursorRepro.test.ts
```

### C

This script starts the stone, compiles, and runs the repro in one step:

```sh
./client/src/__tests__/repro/run-c-repro.sh          # from the repo root
./client/src/__tests__/repro/run-c-repro.sh 3.7.5    # or a specific version
```

If you'd rather build and run it by hand, the instructions are at the top of
`ComStrmSetCursorRepro.c`.

## Files in this folder

- **`ComStrmSetCursorRepro.test.ts`** — the Vitest version.
- **`ComStrmSetCursorRepro.c`** — a standalone C version, meant to be easy to
  hand off. Loads `libgcits` dynamically (`dlopen`/`dlsym`), so it builds
  with just a C compiler — no SDK headers needed.
- **`run-c-repro.sh`** — one-command build-and-run for the C version.

---

Thanks for taking a look. Happy to run more tests or share anything else
that would help.
