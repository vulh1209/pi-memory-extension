# Desktop Sidecar Memory Design

**Date:** 2026-04-17  
**Project:** `@lehoangvu/pi-memory-extension`  
**Topic:** Desktop support via host-shipped sidecar helper

## Goal

Add real desktop support for the memory extension without requiring system Node 22, without upgrading Electron for this issue, and without crashing extension load on runtimes that do not provide `node:sqlite`.

The design targets:

- desktop support on macOS, Windows, and Linux
- host-shipped helper/runtime provided by `pi-gui`
- no host-provided memory API; the extension keeps memory protocol and logic ownership
- functional parity close to CLI for search, ingest, checkpoints, remember, and forget
- shared repo DB preferred, but fallback tolerated when runtime/path/locking prevents shared access
- fail-open behavior when helper is unavailable

---

## Problem statement

The extension currently imports `DatabaseSync` from `node:sqlite` at top level in `src/memory/store.ts`. That works in runtimes with sufficiently new Node support, but it fails in the desktop Electron runtime where `node:sqlite` is unavailable.

Because the import is top-level and sits on the extension load path, the package can fail during module evaluation before runtime detection, graceful fallback, or user-visible diagnostics can happen.

This is both a compatibility issue and an architectural boundary issue:

- the extension assumes a specific built-in Node capability
- the desktop host does not provide that capability
- the current package structure gives no safe runtime selection boundary

---

## Non-goals

This phase does not attempt to:

- upgrade Electron / embedded Node just for this extension issue
- replace SQLite with a different persistence technology
- introduce host-owned memory business logic or a host memory API
- guarantee cross-process sync semantics when desktop must fall back to an isolated DB
- redesign the full memory data model or rewrite `GraphitiLiteMemoryStore`

---

## Chosen approach

Use an **extension-managed sidecar helper over stdio**, with a **host-shipped helper runtime/binary**, and introduce a **backend boundary inside the extension**.

### Why this approach

It fits all agreed constraints:

- avoids dependency on system Node 22
- avoids Electron native addon ABI complexity
- preserves extension ownership of protocol and semantics
- allows real desktop functionality, not just fail-soft loading
- supports fail-open behavior when the helper is missing or unhealthy
- preserves the current direct local path for CLI

### Why not Option 4

Upgrading Electron to a version whose embedded Node supports `node:sqlite` is too heavy and app-wide for an extension-specific issue.

### Why not a host memory API

The agreed boundary is that `pi-gui` should not become the owner of memory semantics. The host may ship the helper runtime and expose only the minimum information needed to run it.

---

## Architecture overview

### 1. Backend boundary in the extension

Introduce a backend interface used by extension-facing code.

Planned backend roles:

- **Local backend**: used in CLI or runtimes that can safely use local sqlite directly
- **RPC backend**: used in desktop to speak to the sidecar helper over stdio
- **Unavailable backend state**: represents a fail-open degraded mode with clear diagnostics

This keeps `pi-extension.ts` and command/tool handlers independent of storage transport details.

### 2. Desktop helper process

The helper is a separate process launched by the extension using a host-provided executable/runtime path.

Responsibilities:

- accept RPC requests over stdin/stdout
- execute memory store operations
- initialize schema when needed
- report mode and diagnostics
- manage DB connection lifecycle
- keep protocol output on stdout and logs on stderr

### 3. Storage core reuse

`GraphitiLiteMemoryStore` remains the core storage implementation for the helper side and the CLI local side.

The design deliberately avoids rewriting core data logic. Instead, it adds:

- lazy runtime selection
- transport separation
- helper service method mapping to existing store operations

### 4. Host responsibility

`pi-gui` is responsible only for shipping and making available:

- the helper executable/runtime
- a resolvable helper path or equivalent runtime hint
- optional lifecycle cleanup assistance

`pi-gui` is not responsible for:

- memory request semantics
- schema logic
- query behavior
- retry policy
- memory protocol evolution

---

## Runtime selection flow

### CLI path

When running in a runtime that supports direct local sqlite access:

1. extension initializes backend factory
2. backend factory selects local backend
3. local backend lazy-loads sqlite capability
4. store is opened directly against repo-scoped DB

### Desktop path

When running in desktop runtime without local sqlite capability:

1. extension initializes backend factory
2. backend factory selects RPC backend
3. RPC backend resolves host-shipped helper path
4. extension spawns helper process
5. extension performs handshake
6. helper becomes active and serves requests

### Failure path

If helper resolution, startup, handshake, or runtime health checks fail:

1. extension remains loaded
2. memory backend enters unavailable state
3. user-triggered memory operations return clear unavailable diagnostics
4. background hooks skip memory writes rather than crashing host behavior

---

## RPC protocol design

### Transport

Use **newline-delimited JSON** over stdio.

Each message is one JSON object per line.

Request shape:

```json
{"id":"1","method":"memory.search","params":{"repoRoot":"/repo","query":"pnpm test"}}
```

Response shape:

```json
{"id":"1","result":{"hits":[]}}
```

Error shape:

```json
{"id":"1","error":{"code":"HELPER_UNAVAILABLE","message":"Helper failed to start","details":{}}}
```

### Protocol properties

- simple to debug in logs
- cross-platform safe over stdio
- correlation by `id`
- no heavy external RPC framework required
- sufficient for concurrent in-flight requests with a pending map

### Handshake

The first call after helper startup is `helper.hello`.

Expected response includes:

- protocol version
- helper version
- supported methods
- runtime information
- DB mode capabilities

Handshake is used to detect:

- protocol mismatch
- unsupported helper version
- capability mismatches
- startup health before normal requests begin

### Initial method surface

Expected methods for phase 1 parity:

- `helper.hello`
- `memory.initRepo`
- `memory.search`
- `memory.ingestEpisode`
- `memory.saveCheckpoint`
- `memory.loadCheckpoint`
- `memory.rememberNote` or equivalent note-ingest path
- `memory.forgetFact`
- `memory.getFactById`
- `memory.status`

The exact final method names can be standardized during implementation, but the plan must keep the surface small and aligned with current extension behavior.

---

## Process lifecycle

### Helper ownership

The extension owns the helper process lifecycle.

### Helper granularity

Use a **singleton helper per repo root** for phase 1.

Rationale:

- the DB is repo-scoped
- it avoids unnecessary duplicate processes
- behavior remains close to current repo-oriented store cache semantics

### Startup flow

1. first memory request for a repo triggers backend acquisition
2. RPC backend resolves helper path
3. helper process is spawned
4. stdout reader and stderr logging are attached
5. handshake runs
6. helper state becomes ready

### Reuse and shutdown

- the helper stays alive for subsequent requests for that repo
- on session/process shutdown, extension attempts graceful helper termination
- if helper exits unexpectedly, the backend marks itself unhealthy and future requests may attempt a bounded respawn

### Timeouts

Use explicit request timeouts:

- short timeout for lightweight calls such as search/status/lookup
- longer timeout for initialization, schema setup, or retry-sensitive flows

### Restart policy

- fail current pending requests with structured errors if the helper exits
- allow a bounded respawn on the next request
- do not loop forever on repeated startup failure

---

## Data path and DB semantics

### Primary DB path

The preferred DB path remains:

```text
<repo>/.memory/pi-memory.sqlite
```

This preserves parity with the current CLI path.

### Shared DB first

Desktop helper should always try shared repo DB first.

If it succeeds:

- desktop and CLI share the same memory file
- parity is close to current semantics
- no sync layer is required

### Fallback isolated DB

If the shared DB cannot be used for reasons such as:

- permission errors
- invalid path
- host write restrictions
- unrecoverable locking/runtime issues

then the helper may fall back to an isolated app-data DB.

That fallback must be:

- deterministic
- repo-specific
- explicitly reported back to the extension

Likely keying strategy:

- app-data directory controlled by host environment
- per-repo subdirectory or hash of normalized repo root

### Mode reporting

The backend must expose one of these modes:

- `shared`
- `fallback-isolated`
- `unavailable`

This mode should be visible to extension diagnostics/status behavior.

### Consistency note

If the backend runs in `fallback-isolated` mode, desktop functionality may be close to CLI in feature coverage, but not in shared-state semantics. This is acceptable in phase 1 and must be documented.

---

## Fail-open behavior

If helper startup or operation fails:

- the extension must still load
- commands/tools/hooks must not crash the package
- interactive memory actions should return a clear unavailable result
- background hooks should skip or degrade quietly while logging structured reasons

### User-visible behavior

Suggested status examples:

- `memory ready (shared db)`
- `memory ready (desktop isolated db)`
- `memory unavailable`

### Interactive operations

Commands and tool-triggered memory requests should surface a direct explanation, for example:

- helper missing
- helper startup failed
- protocol mismatch
- DB unavailable

### Background hook behavior

For background flows such as prompt enrichment, tool-result capture, and checkpoint capture:

- skip when backend unavailable
- avoid noisy user interruption
- preserve logs/diagnostics for investigation

---

## Diagnostics and observability

### Extension side

Track structured status such as:

- backend type selected
- helper path resolution success/failure
- handshake success/failure
- current DB mode
- timeout/crash summaries

These diagnostics should be suitable for:

- user-facing status text
- extension logs
- future host diagnostics if surfaced indirectly

### Helper side

Rules:

- stdout is protocol only
- stderr is logs only
- logs should be structured enough to identify startup, crash, DB mode, and request failures

### Protocol mismatch handling

Handshake should detect and report mismatches early so that extension behavior can degrade cleanly rather than producing confusing runtime errors later.

---

## Proposed file structure

### Existing files to modify

- `src/memory/store.ts`
- `src/memory/pi-extension.ts`
- `src/memory/index.ts`
- `extensions/memory.ts`
- `test/extensions/memory-extension.test.ts`

### New files to add

- `src/memory/backend-types.ts`
- `src/memory/backend-factory.ts`
- `src/memory/local-sqlite-backend.ts`
- `src/memory/rpc-memory-backend.ts`
- `src/memory/helper-protocol.ts`
- `src/memory/helper-client.ts`
- `src/memory/helper-entry.ts`
- `src/memory/helper-service.ts`
- `src/memory/runtime-detection.ts`
- `src/memory/diagnostics.ts`

### Responsibility split

- `store.ts`: core store logic reused by direct and helper-executed paths
- `backend-types.ts`: transport-neutral memory backend contract
- `backend-factory.ts`: runtime/backend selection
- `local-sqlite-backend.ts`: local direct backend with lazy sqlite loading
- `rpc-memory-backend.ts`: extension-facing RPC backend
- `helper-protocol.ts`: request/response/error shapes
- `helper-client.ts`: process spawn, request queue, timeout, restart behavior
- `helper-entry.ts`: helper executable entrypoint
- `helper-service.ts`: protocol method handlers calling store operations
- `runtime-detection.ts`: capability checks and helper-path resolution inputs
- `diagnostics.ts`: shared status objects and normalization

---

## Testing strategy

### 1. Backend selection tests

Verify:

- local-capable runtime selects local backend
- desktop runtime selects RPC backend
- missing helper path produces unavailable state without crashing extension load

### 2. Helper protocol/client tests

Verify:

- request/response correlation by `id`
- timeout handling
- malformed response handling
- helper exit during pending requests
- handshake version mismatch behavior

### 3. Extension fail-open tests

Extend existing extension tests to verify:

- extension import/load does not hard-fail when desktop runtime lacks local sqlite
- hooks still register
- duplicate-load behavior still works
- memory operations degrade cleanly when helper is unavailable

### 4. Helper service tests

Verify helper-backed memory operations for:

- repo initialization
- search
- episode ingestion
- checkpoint save/load
- fact lookup
- forget/archive behavior
- mode reporting for shared/fallback/unavailable

### 5. End-to-end helper harness

Add at least one test that spawns the real helper entrypoint and exercises request round-trips. IPC failures often escape unit tests and should be caught here.

---

## Verification criteria

The feature is complete only if all of these are verified:

1. **CLI remains functional**
   - local memory operations still work
   - schema initialization still works

2. **Desktop no longer crashes on import/load**
   - no top-level `node:sqlite` hard dependency on the extension load path

3. **Desktop RPC path works**
   - helper startup works
   - handshake succeeds
   - search/write/checkpoint/forget flows work

4. **Helper-missing path is fail-open**
   - extension still loads
   - memory features report unavailability clearly
   - host is not taken down by the extension

5. **DB mode is clear**
   - shared vs isolated fallback vs unavailable is surfaced correctly

---

## Risks

### 1. Version drift between extension and host-shipped helper

Mitigation:

- handshake version checks
- explicit protocol versioning
- structured mismatch errors

### 2. Cross-platform helper path discovery

Mitigation:

- make helper path resolution explicit and testable
- keep host responsibility minimal but precise

### 3. IPC complexity and hidden failure modes

Mitigation:

- line-oriented protocol
- strict stdout/stderr separation
- e2e helper round-trip tests

### 4. Shared DB access edge cases

Mitigation:

- shared-first policy
- deterministic fallback path
- clear mode reporting

### 5. Regressions in CLI path

Mitigation:

- keep local backend reuse close to current store implementation
- add backend-selection coverage and direct-path verification

---

## Recommendation summary

Implement desktop support with:

- a backend abstraction inside the extension
- lazy local sqlite loading for CLI
- an RPC backend for desktop
- a host-shipped helper/runtime launched by the extension over stdio
- shared repo DB as the preferred mode
- explicit fallback-isolated mode when shared DB is unavailable
- fail-open behavior when the helper is missing or unhealthy

This gives the best balance of:

- correctness
- portability
- extension ownership
- desktop viability
- minimal disruption to the existing store core
