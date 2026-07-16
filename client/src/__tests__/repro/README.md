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
