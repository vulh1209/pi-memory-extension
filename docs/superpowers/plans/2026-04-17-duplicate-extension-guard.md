# Duplicate Extension Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `pi-memory-extension` from registering duplicate tools/commands/hooks when the same extension is loaded twice in one Pi runtime.

**Architecture:** Add a runtime singleton guard in `extensions/memory.ts`. The first instance owns full registration and clears ownership on `session_shutdown`; duplicate instances register only a minimal notify hook and skip all other registrations.

**Tech Stack:** TypeScript, Node test runner, Pi extension API

---

### Task 1: Add failing regression tests

**Files:**
- Create: `test/extensions/memory-extension.test.ts`
- Test: `test/extensions/memory-extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import memoryExtension from '../../extensions/memory.ts';
```

Cover:
- second load does not register `memory_search`
- duplicate path emits one notify warning
- active instance clears singleton on `session_shutdown`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types test/extensions/memory-extension.test.ts`
Expected: FAIL because the second load still registers the tool and no duplicate guard exists yet.

### Task 2: Implement singleton guard

**Files:**
- Modify: `extensions/memory.ts`
- Test: `test/extensions/memory-extension.test.ts`

- [ ] **Step 1: Add minimal runtime state helpers**

Add helper code for:
- global singleton access via `Symbol.for(...)`
- duplicate notify-once state
- clearing the singleton on `session_shutdown`

- [ ] **Step 2: Gate extension registration**

Behavior:
- first load: register everything as today plus `session_shutdown`
- duplicate load: register only minimal notify hook(s), skip tool/command/hook registration

- [ ] **Step 3: Run targeted tests**

Run: `node --test --experimental-strip-types test/extensions/memory-extension.test.ts`
Expected: PASS

### Task 3: Final verification

**Files:**
- Modify: none
- Test: `test/extensions/memory-extension.test.ts`

- [ ] **Step 1: Re-run targeted tests for clean output**

Run: `node --test --experimental-strip-types test/extensions/memory-extension.test.ts`
Expected: PASS with 0 failures
