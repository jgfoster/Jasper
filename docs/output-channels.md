# Output channels

Jasper writes diagnostics and activity logs to VS Code **Output channels**
(the *Output* view; pick a channel from its dropdown). All of them are created
during `activate()` so the full set is discoverable up front — before any of
them has produced a line — rather than appearing only the first time a feature
runs.

| Channel | Created by | What it shows |
|---|---|---|
| **Jasper** | `extension.ts` (`activate`) | Top-level extension activity and general logging. |
| **GemStone GCI** | `gciLog.ts` (`getGciLog`) | Every Smalltalk query/execute and its result or error, plus lower-level GCI calls. Each line is timestamped `[HH:MM:SS.mmm]`; a result/error line also reports the time spent in the call, e.g. `(42 ms)`. |
| **GemStone Transcript** | `transcriptChannel.ts` (`getTranscriptChannel`) | Server-side `Transcript` output (see [the Transcript sink](../CLAUDE.md)). Live during Execute/Display/Inspect It and notebook cells; buffered-then-drained elsewhere. |
| **GemStone Admin** | `sysadminChannel.ts` (`getSysadminChannel`) | Stone / NetLDI process management — `startstone`, `stopstone`, `gslist`, stale-lock handling. |
| **GemStone Class Sync** | `exportManager.ts` (`ensureLogChannel`) | The incremental `.gemstone` mirror sync (see [incremental-class-sync.md](incremental-class-sync.md)). |
| **GemStone Enhanced Inspector Perf** | `extension.ts` (`activate`) | Enhanced Inspector round-trip counts, for perf tuning. Populated only while perf tracking is enabled. |
| **GemStone Smalltalk Language Server** | `vscode-languageclient` (`client.start()`) | The LSP server's log/trace (parsing, completion, diagnostics). Named from the `LanguageClient` display name; its verbosity follows the `gemstoneSmalltalk.trace.server` setting. |

## The GemStone GCI channel

`gciLog.ts` is the shared logger for GemStone interaction. A logged call is a
pair:

- `logQuery(sessionId, label, code)` records the start of a query/execute and
  stamps the session's start time.
- `logResult(sessionId, result)` / `logError(sessionId, message)` records the
  outcome and reports the elapsed time since that `logQuery`.

```
[14:03:09.087] [Session 1] Display It
3 + 4

[14:03:09.129] [Session 1] (42 ms) → 7
```

Because GCI allows only one call in progress per session, the elapsed time is
tracked per session and is exact even when two sessions interleave. A
standalone error (one not preceded by a `logQuery` — e.g. a debugger callback)
is timestamped but carries no duration.

## Conventions for adding a channel

- Create it during `activate()` (directly, or via a module getter called from
  `activate()`), and push it to `context.subscriptions` for disposal.
- Prefix the display name with `GemStone ` for anything tied to a live session,
  so the channels sort together in the dropdown.
- Add a row to the table above.
