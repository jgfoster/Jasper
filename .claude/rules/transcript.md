---
paths:
  - "client/src/transcriptSink.ts"
  - "client/src/codeExecutor.ts"
  - "client/src/nbRunner.ts"
  - "client/src/smalltalkNotebookController.ts"
---

# Transcript sink (`transcriptSink.ts`)

Jade-style server-side Transcript. At login a small `JasperTranscriptSink` class is compiled into the session (never committed; held via `SessionTemps`, like JadeServer) and installed at `SessionTemps #TranscriptStream_SessionStream` — the stream GemStone's `TranscriptStreamPortable` actually writes to. (An earlier wrapper keyed `SessionTemps #Transcript`, which no supported version consults, so Transcript output was silently lost.)

Two modes:

- **live** (Execute/Display/Inspect It, notebook cells) — each write reaches the client mid-execution as a ClientForwarder send: the in-flight nb call returns GCI error 2336, `settleNbResult` (`nbRunner.ts`) appends the text to the "GemStone Transcript" output channel (revealed on every write), and resumes via `GciTsContinueWithAsync` — a koffi worker-thread binding, so a long run after a write never blocks the extension host.
- **buffer** (queries, MCP tools, debugger stepping) — writes buffer server-side and are drained after the call, because the FetchBytes-family GCI calls cannot host a forwarder send.
