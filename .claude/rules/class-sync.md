---
paths:
  - "client/src/sync/**"
---

# Class sync (`sync/`)

The incremental class-export engine used by `exportManager.ts`. `syncProtocol.ts` generates Smalltalk expressions that build a manifest and class-source payloads on the GemStone side; `syncTransport.ts` handles chunked streaming for payloads that exceed a single GCI response; `manifestDiff.ts` diffs the remote manifest against the local mirror to compute the minimal fetch/delete set; `syncFraming.ts` parses the manifest wire format.

See `docs/incremental-class-sync.md` for the full design.
