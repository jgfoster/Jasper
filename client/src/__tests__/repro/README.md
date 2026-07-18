# perform: NameError vs. MessageNotUnderstood depends on compile history

`GciTsPerform` (`perform:` on a receiver, called with a selector string) can
fail two different ways for what looks like the same input:

```
a NameError occurred (error 2404), fooBar, There is no Symbol with the
specified value
```

```
a MessageNotUnderstood occurred (error 2010), a Boolean does not
understand  #'fooBar'
```

Which one you get isn't about the receiver or the selector text in
isolation — it depends on whether that exact selector text has ever been
compiled as a Symbol before, in that session. That's easy to miss, since
nothing about the call site changes between the two outcomes. We ran into
this while building Jasper (our VS Code extension for GemStone Smalltalk):
a pair of our own unit tests picked an arbitrary "made-up" selector expecting
`NameError` every time, and started failing intermittently once we
introduced randomized test ordering — the same assertion sometimes got
`MessageNotUnderstood` instead, depending on what had run earlier in the same
session. We wanted to isolate and write up the underlying mechanism, in case
it's useful for your team, and in case you can shed light on the parts we're
still unsure about.

## The trigger

The two errors aren't about the *receiver* at all — both mean "this receiver
doesn't have a method for this selector," just by two different routes:

| Condition | Result |
|---|---|
| The selector text has never become a real Symbol in this session | `NameError` (error 2404) |
| The selector text already is a Symbol, but the receiver has no method for it | `MessageNotUnderstood` (error 2010) |

The key mechanism: **a selector text becomes a Symbol the moment it's
compiled anywhere as a Symbol literal or message send — it does not need to
be sent successfully, and it does not need to involve `perform:` at all.**
We verified two independent ways to trigger it:

- Compiling a bare literal, e.g. evaluating `#fooBar` as a doit.
- Sending `asSymbol` to a matching string, e.g. `'fooBar' asSymbol`.

Once either of those has happened, in that session, `perform:` on that exact
text stops raising `NameError` and raises `MessageNotUnderstood` instead —
permanently, for the rest of that session. We also checked that a
*repeated, identical, failed* `perform:` call does **not** do this on its
own: sending the same never-seen selector twice raises `NameError` both
times. Interning only happens through compilation, never through a failed
lookup.

The practical implication: any code that branches on `perform:` failing with
`NameError` specifically (as opposed to any failure) is implicitly making a
claim about that selector's entire compile history in the current session,
not just about the current call — and any long-lived session that compiles a
wide variety of source over its lifetime (a REPL, a worker process, a test
suite reusing one login) makes that claim progressively less safe to rely on.

## Things we're still not sure about

This comes from observing behavior rather than an implementation, so please
take it as a hypothesis, not a diagnosis.

- We initially assumed this was a stone-wide effect: Symbol creation is
  documented elsewhere as bypassing normal repository commit semantics, so
  we expected a newly-interned selector to be visible to any session
  immediately. We tested this directly — compiling the literal in one
  session, explicitly committing, then checking from a brand new session —
  and could **not** reproduce cross-session visibility. The effect appears
  scoped to the session that did the compiling, at least under the
  conditions we tried. We don't know if that's because it genuinely doesn't
  reach the shared SymbolTable the way we assumed, or because there's some
  additional step (an explicit `Symbol` filed into a `SymbolDictionary`,
  perhaps) needed to make it durable.
- We don't know the exact scope of "session" here either — whether it's tied
  to the login, the underlying gem process, or something else — since our
  test setup always tears the session down at the point we'd want to probe
  that boundary further.

## Versions we checked

| Version | Reproduces? |
|---|---|
| 3.6.1 | Yes |
| 3.6.2 | Yes |
| 3.6.3 | Yes |
| 3.6.4 | Yes |
| 3.6.5 | Yes |
| 3.6.6 | Yes |
| 3.6.8 | Yes |
| 3.7.2 | Yes |
| 3.7.4.3 | Yes |
| 3.7.5 | Yes |

Checked against every GemStone version we had a local test stone for, oldest
to newest — reproduces identically across all ten.

## Reproducing this

We put together two versions of the same repro: a TypeScript/Vitest test,
and a standalone C program. Use whichever's more convenient.

### TypeScript (Vitest)

```sh
npm install                    # once, from the repo root
npm run test:server:start      # starts a local test stone
npm run test:gci -- src/__tests__/repro/InternedSelectorRepro.test.ts
```

To check a specific GemStone version:

```sh
npm run test:server:stop
npm run test:server:start -- 3.7.5
npm run test:gci -- src/__tests__/repro/InternedSelectorRepro.test.ts
```

### C

This script starts the stone, compiles, and runs the repro in one step:

```sh
./client/src/__tests__/repro/run-c-repro.sh          # from the repo root
./client/src/__tests__/repro/run-c-repro.sh 3.7.5    # or a specific version
```

If you'd rather build and run it by hand, the instructions are at the top of
`InternedSelectorRepro.c`.

## Files in this folder

- **`InternedSelectorRepro.test.ts`** — the Vitest version.
- **`InternedSelectorRepro.c`** — a standalone C version, meant to be easy to
  hand off. Loads `libgcits` dynamically (`dlopen`/`dlsym`), so it builds
  with just a C compiler — no SDK headers needed.
- **`run-c-repro.sh`** — one-command build-and-run for the C version.

---

Thanks for taking a look. Happy to run more tests or share anything else
that would help.
