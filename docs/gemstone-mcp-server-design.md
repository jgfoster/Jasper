# GemStone MCP Server — Architecture Design

**Status:** Draft for discussion
**Scope:** How to host a Model Context Protocol (MCP) server inside/alongside GemStone, and how to reconcile MCP's per-client session model with GemStone's transactional session model.

---

## 1. Purpose

We want to expose GemStone to MCP clients (LLM agents and MCP-aware tools). The core design question is not "how do we speak MCP" but **how MCP client identity maps onto GemStone sessions**, because that mapping determines transaction isolation, security, and operational risk.

This document presents two architectures:

- **A — Single shared session:** one GemStone session serves every MCP client.
- **B — Per-client sessions:** authenticate each client and route its requests to a dedicated GemStone session.

It then addresses the two operational hazards that Architecture B raises: **idle-session lifetime** and **commit-record backlog**. Both hazards are rooted in GemStone's transaction model, so we start there.

---

## 2. Background: the GemStone session and transaction model

A GemStone login creates a **session** (a *gem* process) with a private, transactionally consistent **view** of the repository. Key properties that drive this design:

- **Isolation.** A session sees its own uncommitted changes plus a snapshot of committed state as of its view. Other sessions' commits are invisible until this session advances its view.
- **View advancement.** A session's view advances to the latest committed state on `commit` or `abort`. Until it does one of those, it keeps looking at the *old* snapshot.
- **Optimistic concurrency.** Write–write conflicts are detected at commit time; `System commitTransaction` returns `false` on conflict and `System transactionConflicts` describes them.
- **Transaction modes** (`System class >> transactionMode:`), verified in the target image, accept `#autoBegin`, `#manualBegin`, and `#transactionless`. The kernel comment states transactionless mode is *"intended primarily for idle sessions"* — sessions may read but risk an inconsistent view. This matters directly for §7.

The consequence for any multi-client design: **a session is stateful and comparatively expensive** (a real gem process with its own view and page-cache footprint), and **an idle session that never advances its view is an operational liability**, not just idle capacity.

---

## 3. Where the MCP server process can live

Two hosting styles are available regardless of A vs. B, and it's worth separating them from the session-mapping question:

- **In-image server.** An HTTP/SSE (or stdio-bridged) MCP endpoint runs *inside a gem*, in Smalltalk. Client requests become Smalltalk executions in that gem or in gems it controls. Everything stays in one process tree; no external runtime.
- **External-process server.** A Node/Python (etc.) MCP server runs outside GemStone and talks to it over GCI, creating one gem per login the ordinary way. The router lives in the external process; GemStone just sees normal logins.

The in-image style pairs naturally with Architecture A (the server *is* the session) and can also do B via external-session control (§5). The external-process style is the cleanest way to do B, because each client login is simply a separate gem with no in-image multiplexing to manage.

### MCP session identity

The streamable-HTTP MCP transport already carries a session identifier (`Mcp-Session-Id`), and stdio connections are 1:1 with a client. That identifier is the natural key for mapping an MCP client to a GemStone session in Architecture B. MCP also has a defined place to authenticate at connection setup, which is where we hang GemStone credential exchange.

---

## 4. Architecture A — Single shared session

### How it works

The server logs in once (at startup, or lazily) and executes every incoming request in that one session. There is no per-client state on the GemStone side; all clients share one view, one transaction, one export set.

### Pros

- **Trivial to build and operate.** One login, one lifecycle, no routing, no reaper, no backlog management beyond ordinary good citizenship.
- **Low resource footprint.** One gem regardless of client count.
- **No idle-session problem.** There is one long-lived session you control directly.

### Cons

- **No isolation.** Every client shares uncommitted state. One client's `begin`/partial edits are visible to — and clobberable by — the next request, from any client. Interleaved writes across clients produce surprising results.
- **No per-client identity or authorization.** Requests run as whatever `UserProfile` the server logged in as, which is typically privileged. GemStone's own object/segment authorization can't distinguish clients because there's only one identity.
- **Arbitrary-code-execution exposure.** If the server accepts Smalltalk (or anything Turing-complete) from callers, then *anyone who can reach the port has the full powers of that login* — read/write/delete of anything that identity can touch, plus host-level reach GemStone exposes. This is the dominant risk.

### When it's acceptable

- Local development, single operator.
- A trusted, network-isolated deployment where "shared scratch session" is the intended semantics (e.g., a shared analysis console).
- Read-mostly, low-sensitivity data where shared view is a feature, not a bug.

### Hardening (if you ship A anyway)

- Bind to loopback or a tightly controlled interface; never expose to an untrusted network.
- Log in as a **least-privilege** `UserProfile`, not `SystemUser`/`DataCurator`.
- Consider constraining what callers can do (a fixed tool vocabulary rather than raw `executeString:`), so the server is not a remote-code-execution gateway.
- Decide a commit policy: commit-per-request (statelessness) is usually right here, so one client's abandoned edits don't leak into the next request.

---

## 5. Architecture B — Per-client sessions (authenticated + routed)

Each authenticated MCP client gets its own GemStone session; the server maintains a map `MCP session id → GemStone session` and routes requests accordingly. This restores isolation and lets GemStone's authorization apply per client — at the cost of managing session lifecycle.

### 5.1 Two implementation variants

**B1 — External process, one gem per login.** The external MCP server calls GCI to `login` a gem for each authenticated client. Each client is an ordinary independent gem; there is no in-image multiplexing. Simplest isolation story; routing and lifecycle live in the external server.

**B2 — In-image gateway using external sessions.** A gateway gem hosts the MCP endpoint and drives one *controlled* session per client using GemStone's external-session classes. Verified against the target image:

- **`GsTsExternalSession`** is the recommended class. It uses the thread-safe GCI library, is safe to use with multiple in-gem green threads (`GsProcess`), and crucially offers **non-blocking calls** (`nbExecute:`, `waitForReadReady`, `nbResult`). That lets a single gateway multiplex many client sessions without serializing on each remote call.
- **`GsExternalSession`** is the older FFI/RPC implementation. Its own class comment warns it is *not* green-thread-safe when multiple `GsProcess`es are active — avoid it for a concurrent server.

Representative gateway flow (illustrative, using the verified `GsTsExternalSession` API):

```smalltalk
"On client authentication:"
| sess |
sess := GsTsExternalSession newDefault.
sess username: clientUser; password: clientSecret.   "or: onetimePassword: / jwtPassword:"
sess login.
sessionMap at: mcpSessionId put: (McpSessionEntry for: sess).

"On a client request (blocking form):"
result := sess executeString: requestSource.

"Or non-blocking, to multiplex many clients from one gateway:"
sess nbExecute: requestSource.
sess waitForReadReady.        "or poll across all sessions"
result := sess nbResult.

"On disconnect / reap:"
sess abort.                    "release view first — see §7"
sess logout.
```

Two `GsTsExternalSession` details worth flagging for B2:

- **Auth options** include `password:`, `onetimePassword:`, and `jwtPassword:`, so MCP client auth can map to GemStone credentials, one-time tokens, or JWT rather than forcing plaintext passwords through the gateway.
- **Export-set growth.** Non-special, non-byte results are returned as OOP references pinned in the *remote* session's export set. Long-lived per-client sessions must `releaseOop:`/`releaseOops:` (or prefer returning specials/strings) or they accumulate memory pressure over time.

### 5.2 Authentication and authorization

Authenticate at MCP session establishment and bind the resulting GemStone identity to that MCP session for its lifetime. The payoff over Architecture A: **code runs under the client's `UserProfile`, so GemStone's segment/object authorization applies per client.** Untrusted callers get exactly the powers their GemStone account has — no more.

### 5.3 Pros / cons

**Pros:** true isolation per client; per-client authorization inherited from GemStone; a misbehaving client can't corrupt another's in-flight work.

**Cons:** each session is a real gem — capacity is now `N clients × gem footprint`, so total sessions must be capped and planned; and you inherit the two hazards below.

---

## 6. Issue 1 — Idle-session lifetime

**Problem.** A per-client session consumes a gem and (see §7) can hold back the repository. But MCP clients connect and go quiet unpredictably. How long do we keep an inactive session alive?

**Design.**

- **Track last activity** per session entry (timestamp updated on each request).
- **Two-tier timeout.**
  - *Soft idle (e.g., minutes):* move the session to `#transactionless` and/or `abort` it to release its view (§7). It stays logged in and cheap-ish, ready to serve again.
  - *Hard idle (e.g., tens of minutes):* `logout` and drop the map entry, freeing the gem entirely.
- **A reaper.** In B2, a background `GsProcess` in the gateway periodically sweeps the map; because `GsTsExternalSession` is green-thread-safe this is fine. In B1, the reaper is ordinary external-server code. It enforces the timeouts above and the backlog policy in §7.
- **Cap total sessions.** Enforce a maximum concurrent gem count with an LRU/idle-first eviction so a burst of clients can't exhaust the gem budget. Reject or queue beyond the cap rather than over-committing.
- **Resumable sessions (optional).** Give the client an opaque resumption token so a reconnect can re-establish *a fresh session* with the same identity. Note this restores identity, **not** uncommitted work — see below.
- **Graceful vs. forced logout.** Prefer `abort` then `logout`. Be prepared for the Stone to have already terminated a session out from under you (§7); treat "session already gone" as a normal reap outcome.

**The uncommitted-work question.** The hard case is an idle session with *pending, uncommitted* changes. You cannot both keep those changes and be a good repository citizen (§7 explains why). Pick an explicit policy:

- **Discard on reap (recommended default):** warn via the protocol if possible, then `abort` and reclaim. Safe for the repository; the client loses unsent edits.
- **Never auto-commit:** auto-committing an idle client's partial work silently violates the isolation the client is paying for and can commit half-finished state. Avoid unless a specific tool opts in.
- **Client-owned long transactions:** allow a client to *explicitly* request a durable long-running transaction, making it responsible for the backlog risk, with a much shorter cap and louder warnings.

---

## 7. Issue 2 — Commit-record backlog

**Why this exists.** Every commit produces a **commit record** describing a consistent view. The Stone must retain every commit record from the oldest one *still referenced by any live session* up to the newest. A session references the commit record matching its current view, and — in `#autoBegin`/`#manualBegin` — that view only advances when the session commits or aborts. So an idle session sitting on an old view **pins** all commit records newer than its view and **prevents reclamation of storage** for objects that only became garbage after that view (the reclaim/GC cannot free what the old view might still see).

Left unmanaged, this causes repository (extent) growth, stalled garbage reclamation, and eventually free-space exhaustion and performance degradation. Per-client idle sessions are the classic trigger.

**The fundamental tension.** Releasing the old view requires advancing it, and the *only* ways to advance are `commit` or `abort` — both of which discard the session's ability to hold pending uncommitted work at the old snapshot. Therefore **"hold uncommitted changes indefinitely" and "don't pin commit records" are mutually exclusive.** Every mitigation below is a way of resolving that tension in a specific direction.

**GemStone's built-in defense (verified config in the target image).** When the backlog grows, the Stone signals the session holding the oldest commit record to abort ("sig-abort"); if it doesn't comply in time, the Stone forcibly terminates it. Relevant Stone parameters (current values observed via `System stoneConfigurationReport`):

| Parameter | Observed | Role (confirm precise semantics in the System Admin Guide) |
|---|---|---|
| `STN_SIGNAL_ABORT_CR_BACKLOG` | 20 | Backlog size at which the Stone begins signaling the oldest-CR session to abort. |
| `STN_CR_BACKLOG_THRESHOLD` | 80 | Higher watermark governing more aggressive Stone response. |
| `STN_GEM_ABORT_TIMEOUT_SECONDS` | 60 | How long the Stone waits for a signaled session to abort before forcibly terminating it. |
| `STN_SIGNAL_ABORT_AGGRESSIVE` | 0 | When enabled, broadens signaling beyond just the single oldest session. |

The implication for our server is concrete: **an idle writer that ignores sig-abort will be killed by the Stone and lose its uncommitted work anyway** — so we may as well manage the situation proactively and on our own terms.

**Mitigations (apply in combination).**

1. **Idle sessions go transactionless.** On soft-idle, set `System transactionMode: #transactionless` in that session so its read view can advance without pinning an old commit record. Reserve `#autoBegin`/`#manualBegin` for sessions actively doing a unit of work. (Accept the documented caveat that transactionless reads can be inconsistent; that's acceptable for a parked session.)

2. **Abort-to-refresh on wake and on a heartbeat.** `abort` an idle session periodically (and when it next serves a request) so its view tracks the current root. This is the single most effective habit for keeping the backlog flat.

3. **Handle sig-abort cooperatively.** In each per-client session, enable and honor the Stone's abort signal via `System class >> enableSignaledAbortError` (verified present). Note the kernel requirement: **the error must be re-enabled after every delivery.** When the signal arrives, the right response for a *parked* session is to abort immediately; for a session with unsent work, surface it to the client per the §6 policy before the Stone forces the issue.

4. **Proactively reap the oldest offender.** The reaper should monitor the backlog and, when it climbs, target the session holding the oldest view first (idle-first / oldest-view-first eviction), aborting or logging it out before the Stone has to. Identify sessions and, if necessary, terminate them using the verified administrative selectors `System currentSessionNames`, `System descriptionOfSession:`, and `System stopSession:`. (Confirm the exact runtime selector for reading the current backlog / oldest-CR session against the installed version before wiring the monitor.)

5. **Tune Stone thresholds to match the deployment** rather than relying on defaults, once measured under expected client concurrency.

6. **Favor commit-or-discard-per-request semantics** for ordinary tool calls, so sessions spend almost all their time with a current view and only briefly hold a transaction while a unit of work is in flight.

**Recommended policy.** Default per-client sessions to short-lived transactions with abort-to-refresh; park idle sessions in `#transactionless`; honor sig-abort; and let the reaper evict oldest-view-first under pressure. Treat any long-lived open transaction as an explicit, capped, client-owned exception.

---

## 8. Decision guide

- **Dev box / single operator / trusted console with shared-state semantics** → **Architecture A**, loopback-bound, least-privilege login, commit-per-request, restricted tool vocabulary.
- **Multiple distinct clients, any sensitivity, or a need for per-client authorization** → **Architecture B**. Choose **B1 (external process)** when you want the simplest isolation and already have an external runtime; choose **B2 (in-image gateway)** when you want everything in-image and will use `GsTsExternalSession` with its non-blocking API to multiplex clients.
- In **either** B variant, §6 (lifetime) and §7 (backlog) are mandatory, not optional.

A reasonable path is to ship A first for internal use, then build B2 with `GsTsExternalSession`, carrying the session-map, reaper, and backlog policy as the core new components.

---

## 9. Open questions

- **Precise runtime backlog readout.** Confirm the exact selector(s) for reading current commit-record backlog and identifying the oldest-CR session on the installed version, to drive the reaper's proactive eviction (§7 mitigation 4).
- **Credential handling.** Which auth path (password / one-time / JWT) do MCP clients present, and where is it exchanged in the MCP handshake? `GsTsExternalSession` supports all three; the MCP-side mapping needs a decision.
- **Capacity model.** Per-gem footprint × target concurrent clients vs. host limits, to set the session cap in §6.
- **Result marshaling.** What gets returned to clients — printStrings, structured JSON, or object references — and the corresponding export-set release discipline in B2.
- **Failure surfacing.** How commit conflicts (`System commitTransaction` → `false`) and Stone-forced aborts are reported back through MCP so clients can retry sensibly.
