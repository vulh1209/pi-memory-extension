# Desktop Sidecar Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the memory extension load safely on desktop runtimes without `node:sqlite`, then provide a sidecar-backed desktop path that preserves memory features while keeping CLI direct sqlite support.

**Architecture:** Introduce a transport-neutral memory backend boundary in the extension, keep `GraphitiLiteMemoryStore` as the storage core, lazy-load local sqlite only in the CLI-capable path, and add a stdio JSON-RPC helper path for desktop runtimes. Desktop must fail open when the helper is missing or unhealthy, while still surfacing diagnostics and preserving extension registration.

**Tech Stack:** TypeScript, Node built-in test runner, `node:sqlite` for direct CLI/local execution, stdio newline-delimited JSON for helper RPC, existing Pi extension hooks/commands/tools.

---

## File map

### Existing files to modify
- `src/memory/store.ts` — remove top-level sqlite hard dependency from the extension load path; support store construction from an injected database object.
- `src/memory/pi-extension.ts` — route all extension operations through the new backend boundary and fail-open diagnostics.
- `src/memory/index.ts` — export new backend/helper modules.
- `extensions/memory.ts` — continue to register commands/tools/hooks while reading backend status from the extension layer.
- `test/extensions/memory-extension.test.ts` — add regression coverage for desktop-safe loading and fail-open behavior.

### New files to create
- `src/memory/backend-types.ts` — backend contract used by the extension layer.
- `src/memory/diagnostics.ts` — normalized backend mode/availability types.
- `src/memory/runtime-detection.ts` — local sqlite capability checks and helper path resolution.
- `src/memory/local-sqlite-backend.ts` — lazy local sqlite backend for CLI-capable runtimes.
- `src/memory/helper-protocol.ts` — request/response/error/hello types.
- `src/memory/helper-client.ts` — helper process manager and request multiplexer.
- `src/memory/rpc-memory-backend.ts` — extension-facing backend using the helper client.
- `src/memory/helper-service.ts` — helper RPC method implementations mapped onto the store.
- `src/memory/helper-entry.ts` — helper process entrypoint.
- `test/memory/helper-client.test.ts` — helper client protocol and lifecycle tests.
- `test/memory/backend-selection.test.ts` — runtime/backend selection tests.
- `test/memory/helper-entry-roundtrip.test.ts` — end-to-end helper round-trip test.

---

### Task 1: Lock in the failing desktop-safe load regression test

**Files:**
- Modify: `test/extensions/memory-extension.test.ts`
- Test: `test/extensions/memory-extension.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test that imports the extension through a desktop-simulated path where local sqlite is unavailable and asserts that registration still happens without touching `node:sqlite` at import time.

```ts
test('loads on desktop runtime without node:sqlite and degrades memory operations cleanly', async () => {
  resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  assert.ok(pi.commands.some((command) => command.name === 'memory-search'));
  assert.ok(pi.tools.some((tool) => tool.name === 'memory_search'));

  const sessionStartHandlers = pi.handlers.get('session_start') ?? [];
  await assert.doesNotReject(async () => {
    for (const handler of sessionStartHandlers) {
      await handler({ cwd: process.cwd() }, { ui: {} });
    }
  });

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test test/extensions/memory-extension.test.ts
```

Expected:
- test suite fails because the current extension load path still imports `node:sqlite` through `src/memory/store.ts`
- or the new desktop-safe expectations fail because no backend abstraction exists yet

- [ ] **Step 3: Add one more failing behavior test for fail-open user commands**

Add a second test showing that a memory command returns an unavailable-style response instead of crashing when the helper path is missing.

```ts
test('memory search command returns unavailable message when desktop helper is missing', async () => {
  resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory-search');
  assert.ok(command);

  const handler = (command!.options as { execute: (args: string[], ctx: unknown) => Promise<{ content: string }> }).execute;
  const result = await handler(['pnpm'], { cwd: process.cwd(), ui: {} });

  assert.match(result.content, /unavailable|helper|desktop/i);

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});
```

- [ ] **Step 4: Run test to verify it fails for the expected reason**

Run:

```bash
node --experimental-strip-types --test test/extensions/memory-extension.test.ts
```

Expected:
- new test fails because command execution still assumes the direct store path
- failure is about missing backend behavior, not a syntax error in the test

- [ ] **Step 5: Commit checkpoint**

Current workspace is not inside a git repository, so record the intended checkpoint instead of committing.

```bash
printf '%s\n' 'checkpoint: added failing desktop-safe extension tests' >> .memory/implementation-checkpoints.log
```

---

### Task 2: Add the backend boundary and make CLI sqlite loading lazy

**Files:**
- Create: `src/memory/backend-types.ts`
- Create: `src/memory/diagnostics.ts`
- Create: `src/memory/runtime-detection.ts`
- Create: `src/memory/local-sqlite-backend.ts`
- Modify: `src/memory/store.ts`
- Modify: `src/memory/pi-extension.ts`
- Modify: `src/memory/index.ts`
- Test: `test/memory/backend-selection.test.ts`

- [ ] **Step 1: Write the failing backend selection test**

Create a dedicated selection test that expects desktop-forced runtime detection to avoid direct sqlite loading.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectMemoryRuntime, resolveHelperPath } from '../../src/memory/runtime-detection.ts';

test('detectMemoryRuntime prefers desktop helper path when desktop is forced', () => {
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '/tmp/pi-memory-helper';

  const runtime = detectMemoryRuntime();

  assert.equal(runtime.kind, 'desktop');
  assert.equal(resolveHelperPath(runtime), '/tmp/pi-memory-helper');

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
node --experimental-strip-types --test test/memory/backend-selection.test.ts
```

Expected:
- failure because `runtime-detection.ts` does not exist yet

- [ ] **Step 3: Create the diagnostics and backend contract files**

Create `src/memory/diagnostics.ts`:

```ts
export type MemoryBackendMode = 'shared' | 'fallback-isolated' | 'unavailable';

export interface MemoryBackendStatus {
  available: boolean;
  backendKind: 'local' | 'rpc' | 'unavailable';
  mode: MemoryBackendMode;
  summary: string;
  details?: Record<string, unknown>;
}

export function unavailableStatus(summary: string, details?: Record<string, unknown>): MemoryBackendStatus {
  return {
    available: false,
    backendKind: 'unavailable',
    mode: 'unavailable',
    summary,
    details,
  };
}
```

Create `src/memory/backend-types.ts`:

```ts
import type { CheckpointInput, CheckpointRecord, EpisodeInput, FactRecord, MemoryHit, SearchMemoryInput } from './types.ts';
import type { MemoryBackendStatus } from './diagnostics.ts';

export interface MemoryBackend {
  getStatus(repoRoot: string): Promise<MemoryBackendStatus>;
  searchMemory(repoRoot: string, input: SearchMemoryInput): Promise<MemoryHit[]>;
  ingestEpisode(repoRoot: string, input: EpisodeInput): Promise<void>;
  saveCheckpoint(repoRoot: string, input: CheckpointInput): Promise<{ checkpointId: string }>;
  loadCheckpoint(repoRoot: string, taskId: string): Promise<CheckpointRecord | null>;
  forgetFact(repoRoot: string, factId: string, reason?: string): Promise<FactRecord | null>;
  getFactById(repoRoot: string, factId: string): Promise<FactRecord | null>;
}
```

- [ ] **Step 4: Create runtime detection and lazy local backend**

Create `src/memory/runtime-detection.ts`:

```ts
export type MemoryRuntime =
  | { kind: 'desktop'; helperPath?: string }
  | { kind: 'local' };

export function detectMemoryRuntime(): MemoryRuntime {
  if (process.env.PI_MEMORY_FORCE_DESKTOP === '1' || !!process.versions.electron) {
    return { kind: 'desktop', helperPath: process.env.PI_MEMORY_HELPER_PATH || undefined };
  }
  return { kind: 'local' };
}

export function resolveHelperPath(runtime: MemoryRuntime): string | undefined {
  return runtime.kind === 'desktop' ? runtime.helperPath : undefined;
}
```

Create `src/memory/local-sqlite-backend.ts` with lazy `import('node:sqlite')` inside a factory instead of top-level import:

```ts
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { MemoryBackend } from './backend-types.ts';
import { unavailableStatus, type MemoryBackendStatus } from './diagnostics.ts';
import { GraphitiLiteMemoryStore } from './store.ts';
import { HashingEmbedder } from './hashing-embedder.ts';

export async function createLocalSqliteBackend(): Promise<MemoryBackend> {
  const sqlite = await import('node:sqlite');
  return new LocalSqliteMemoryBackend(sqlite.DatabaseSync);
}
```

- [ ] **Step 5: Refactor `store.ts` to accept injected DatabaseSync-like constructor**

Replace the top-level import with an injected constructor shape.

```ts
export interface DatabaseSyncLike {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown;
  };
}

export type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

interface StoreOptions {
  dbPath: string;
  embedder: MemoryEmbedder;
  schemaPath?: string | URL;
  DatabaseSync: DatabaseSyncConstructor;
}

constructor(options: StoreOptions) {
  mkdirSync(dirname(options.dbPath), { recursive: true });
  this.db = new options.DatabaseSync(options.dbPath);
  // ...
}
```

- [ ] **Step 6: Route extension-facing calls through a backend cache instead of direct store access**

Create a small backend cache in `src/memory/pi-extension.ts` and use it from `buildPromptMemory`, `captureToolEpisode`, `saveTaskCheckpoint`, `forgetMemoryFact`, and `getMemoryFactById`.

```ts
const backendPromiseCache = new Map<string, Promise<MemoryBackend>>();

async function getBackend(): Promise<MemoryBackend> {
  const key = 'global';
  const existing = backendPromiseCache.get(key);
  if (existing) return existing;

  const created = createMemoryBackend();
  backendPromiseCache.set(key, created);
  return created;
}
```

- [ ] **Step 7: Run tests to verify the new backend selection path passes**

Run:

```bash
node --experimental-strip-types --test test/memory/backend-selection.test.ts test/extensions/memory-extension.test.ts
```

Expected:
- backend selection test passes
- extension test still fails on missing RPC behavior, which is correct at this stage

- [ ] **Step 8: Commit checkpoint**

```bash
printf '%s\n' 'checkpoint: added backend boundary and lazy local sqlite loading' >> .memory/implementation-checkpoints.log
```

---

### Task 3: Implement the helper protocol, client, service, and round-trip tests

**Files:**
- Create: `src/memory/helper-protocol.ts`
- Create: `src/memory/helper-client.ts`
- Create: `src/memory/helper-service.ts`
- Create: `src/memory/helper-entry.ts`
- Create: `src/memory/rpc-memory-backend.ts`
- Test: `test/memory/helper-client.test.ts`
- Test: `test/memory/helper-entry-roundtrip.test.ts`

- [ ] **Step 1: Write the failing helper client test**

Create `test/memory/helper-client.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHelperClient } from '../../src/memory/helper-client.ts';

test('helper client rejects with structured timeout error when helper does not answer', async () => {
  const client = createHelperClient({
    command: process.execPath,
    args: ['--input-type=module', '--eval', 'setInterval(() => {}, 1000)'],
    startupTimeoutMs: 50,
    requestTimeoutMs: 50,
  });

  await assert.rejects(() => client.call('helper.hello', {}), /timeout/i);
  await client.dispose();
});
```

- [ ] **Step 2: Run the helper client test to verify it fails**

Run:

```bash
node --experimental-strip-types --test test/memory/helper-client.test.ts
```

Expected:
- failure because helper client does not exist yet

- [ ] **Step 3: Define the protocol types**

Create `src/memory/helper-protocol.ts`:

```ts
export interface HelperRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface HelperSuccessResponse {
  id: string;
  result: unknown;
}

export interface HelperErrorResponse {
  id: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type HelperResponse = HelperSuccessResponse | HelperErrorResponse;
```

- [ ] **Step 4: Implement a minimal helper client**

Create `src/memory/helper-client.ts` with spawn, line parsing, pending-map correlation, and disposal.

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function createHelperClient(options: {
  command: string;
  args?: string[];
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}) {
  // spawn once, parse stdout by lines, map responses by id, timeout pending requests
}
```

Implementation requirements:
- `stdout` parsed by newline-delimited JSON
- `stderr` captured separately
- startup is lazy on first call
- `call()` sends `{ id, method, params }`
- timeouts reject with structured error text
- `dispose()` terminates the child process cleanly

- [ ] **Step 5: Write the failing end-to-end helper round-trip test**

Create `test/memory/helper-entry-roundtrip.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHelperClient } from '../../src/memory/helper-client.ts';

test('helper entry supports hello and memory status round-trip', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-helper-'));
  const client = createHelperClient({
    command: process.execPath,
    args: ['--experimental-strip-types', 'src/memory/helper-entry.ts'],
  });

  const hello = await client.call('helper.hello', {});
  assert.equal((hello as { protocolVersion: string }).protocolVersion, '1');

  const status = await client.call('memory.status', { repoRoot });
  assert.match(String((status as { summary: string }).summary), /shared|fallback|ready/i);

  await client.dispose();
});
```

- [ ] **Step 6: Implement the helper service, entrypoint, and RPC backend**

Create `src/memory/helper-service.ts` and `src/memory/helper-entry.ts` that:
- build or reuse a store per repo
- handle `helper.hello`
- handle `memory.status`
- handle search/ingest/checkpoint/lookup/forget methods
- serialize results back as protocol responses

Create `src/memory/rpc-memory-backend.ts` that adapts extension method calls onto helper RPC calls.

Key bridge pattern:

```ts
export class RpcMemoryBackend implements MemoryBackend {
  constructor(private readonly client: ReturnType<typeof createHelperClient>) {}

  async getStatus(repoRoot: string) {
    return (await this.client.call('memory.status', { repoRoot })) as MemoryBackendStatus;
  }
}
```

- [ ] **Step 7: Run helper tests and fix until green**

Run:

```bash
node --experimental-strip-types --test test/memory/helper-client.test.ts test/memory/helper-entry-roundtrip.test.ts
```

Expected:
- both tests pass
- helper logs stay on stderr only

- [ ] **Step 8: Commit checkpoint**

```bash
printf '%s\n' 'checkpoint: implemented helper protocol, client, service, and round-trip tests' >> .memory/implementation-checkpoints.log
```

---

### Task 4: Wire desktop RPC into the extension and close the fail-open parity tests

**Files:**
- Modify: `src/memory/pi-extension.ts`
- Modify: `extensions/memory.ts`
- Modify: `src/memory/index.ts`
- Modify: `test/extensions/memory-extension.test.ts`
- Modify: `test/memory/backend-selection.test.ts`
- Modify: `test/memory/helper-entry-roundtrip.test.ts`

- [ ] **Step 1: Write or update the failing parity tests**

Expand the extension test so the desktop path can start a real helper and verify search/checkpoint behavior through the extension surface.

```ts
test('desktop path uses helper-backed memory search without crashing extension hooks', async () => {
  resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = process.execPath;
  process.env.PI_MEMORY_HELPER_ARGS = JSON.stringify(['--experimental-strip-types', 'src/memory/helper-entry.ts']);

  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_search');
  assert.ok(tool);

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
  delete process.env.PI_MEMORY_HELPER_ARGS;
});
```

- [ ] **Step 2: Run the extension tests to verify the remaining failures**

Run:

```bash
node --experimental-strip-types --test test/extensions/memory-extension.test.ts
```

Expected:
- failures are limited to missing extension wiring or command/tool behavior

- [ ] **Step 3: Finish backend factory wiring in the extension layer**

Implement a `createMemoryBackend()` path in `src/memory/pi-extension.ts` or a dedicated `backend-factory.ts` that:
- selects local backend for CLI-capable runtime
- selects RPC backend for desktop runtime with helper path
- returns an unavailable-style backend wrapper when helper resolution fails

Suggested shape:

```ts
async function createMemoryBackend(): Promise<MemoryBackend> {
  const runtime = detectMemoryRuntime();
  if (runtime.kind === 'local') {
    return createLocalSqliteBackend();
  }

  const helperPath = resolveHelperPath(runtime);
  if (!helperPath) {
    return createUnavailableMemoryBackend('Desktop memory helper unavailable');
  }

  return createRpcMemoryBackend({ command: helperPath, args: parseHelperArgsEnv() });
}
```

- [ ] **Step 4: Update command/tool handlers to surface backend status cleanly**

Make command and tool handlers consult `getStatus()` and return informative text when unavailable, while background hooks quietly skip.

```ts
const status = await backend.getStatus(repoRoot);
if (!status.available) {
  return {
    content: [{ type: 'text', text: `Memory unavailable: ${status.summary}` }],
  };
}
```

- [ ] **Step 5: Run the full targeted test suite**

Run:

```bash
node --experimental-strip-types --test \
  test/extensions/memory-extension.test.ts \
  test/memory/backend-selection.test.ts \
  test/memory/helper-client.test.ts \
  test/memory/helper-entry-roundtrip.test.ts
```

Expected:
- all targeted tests pass
- extension loads in desktop-forced mode without crashing
- helper-backed path responds correctly
- missing-helper path fails open with readable messaging

- [ ] **Step 6: Run the original package verification commands**

Run:

```bash
npm run check:schema
npm run check:package
```

Expected:
- schema still validates
- extension package entry still imports successfully in a direct-capable runtime

- [ ] **Step 7: Commit checkpoint**

```bash
printf '%s\n' 'checkpoint: wired desktop RPC backend into extension and verified targeted flows' >> .memory/implementation-checkpoints.log
```

---

## Self-review checklist

- Every requirement in `docs/superpowers/specs/2026-04-17-desktop-sidecar-memory-design.md` maps to one of the tasks above.
- No task depends on unspecified file names or unstated APIs.
- The plan preserves TDD order: failing test, verify fail, minimal code, verify green.
- The plan explicitly handles the current non-git workspace by recording checkpoints instead of pretending commits are possible.
- The plan keeps CLI direct sqlite support while adding desktop sidecar support.
