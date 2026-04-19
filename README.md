# Pi Memory Extension Prototype

[![CI](https://github.com/vulh1209/pi-memory-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/vulh1209/pi-memory-extension/actions/workflows/ci.yml)
[![Publish Package](https://github.com/vulh1209/pi-memory-extension/actions/workflows/publish.yml/badge.svg)](https://github.com/vulh1209/pi-memory-extension/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40lehoangvu%2Fpi-memory-extension)](https://www.npmjs.com/package/@lehoangvu/pi-memory-extension)

A small **Graphiti-lite-inspired** local memory extension for Pi CLI / coding-agent workflows.

## Features

- SQLite schema with temporal facts, provenance episodes, checkpoints, and retrieval logs
- TypeScript repository layer using Node's built-in `node:sqlite`
- Exact-match retrieval that works even when the host SQLite build does not ship FTS5
- Pi extension entrypoint for hooks, commands, and tools
- Active-task persistence in `.memory/active-task.json` for task resume flows
- Helper-backed desktop runtime fallback support

## Install guide

### Install from npm into Pi

Preferred Pi install flow:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```

Project-local install:

```bash
pi install -l npm:@lehoangvu/pi-memory-extension
```

### Install from the local repo

```bash
pi install ./
```

### npm global install

Possible, but not the preferred Pi flow:

```bash
npm i -g @lehoangvu/pi-memory-extension
```

Pi resolves package resources from the package manifest (`pi.extensions`), so `pi install` is still the recommended path.

This package also ships a bundled skill:

- `/skill:memory-usage` -> guidance for when to search memory, when to save durable notes, and how to phrase notes so they become searchable facts

For memory-related prompts, the extension also injects a prompt hint that nudges the agent to load `/skill:memory-usage` when the skill is available.

### settings.json alternative

```json
{
  "packages": [
    "npm:@lehoangvu/pi-memory-extension"
  ]
}
```

## Quick start for contributors

### 1. Validate the schema

```bash
npm run check:schema
```

### 2. Run the test suite

```bash
npm test
```

### 3. Validate the package

```bash
npm run check:package
npm run pack:dry-run
```

### 4. Run the local demo

```bash
npm run demo
```

The demo creates a local SQLite file at:

```text
.memory/graphiti-lite-demo.sqlite
```

## Publish as an npm Pi package

This repo is structured so it can be published as a **Pi package** on npm.

### Package resources

- package extension entrypoint: `extensions/memory.ts`
- local repo wrapper for development: `.pi/extensions/memory.ts`
- package manifest uses:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  }
}
```

### Publish

If you are logged in to npm and have access to the scope:

```bash
npm publish --access public
```

## Pi CLI extension adapter

This repo includes a **Pi CLI extension entrypoint** at:

```text
.pi/extensions/memory.ts
```

It wires the local store into the Pi extension lifecycle used by current Pi builds:

- `session_start` -> initialize repo-scoped memory state and refresh status
- `before_agent_start` -> retrieve relevant memory and append it to the system prompt
- `input` -> optional opt-in rewrite when the user includes `#memory` in the prompt
- `tool_result` -> capture tool success/failure episodes
- `turn_end` -> persist a lightweight task checkpoint and auto-save resolved trap issues as lessons when root cause + fix are clearly stated after a verified failure -> success flow
- hook payloads are mirrored into `.memory/pi-hook-debug.jsonl` for runtime verification

### Included task commands

- `/task-start <title>`
- `/task-done [summary]`

### Included slash commands

- `/memory-search <query>`
- `/memory-why <query>`
- `/memory-inspect`
- `/memory-rules [query]`
- `/memory-lessons [query]`
- `/memory-checkpoint [taskId]`
- `/memory-remember <note>`
- `/memory-forget <factId>`
- `/memory-hook-debug [hook]`

### Included model-callable tools

- `memory_search` -> search existing project memory
- `memory_remember` -> ask the user for confirmation, then save a stable rule/preference/lesson note into memory

## Project layout

```text
sql/
  001_graphiti_lite_memory.sql
src/memory/
  types.ts
  utils.ts
  hashing-embedder.ts
  extractors.ts
  store.ts
  pi-extension.ts
  demo.ts
.pi/extensions/
  memory.ts
extensions/
  memory.ts
skills/
  memory-usage/
    SKILL.md
```

## Design notes

This prototype intentionally copies the **important semantics** from Graphiti, not the full graph platform:

- episodes as immutable provenance
- facts with temporal validity windows
- supersede old facts instead of deleting them
- exact-match retrieval with path/task-aware ranking
- checkpoints for resumable task state

It does **not** try to implement:

- graph DB backends
- community detection
- saga modeling
- LLM-driven contradiction resolution

## Current limitations

- retrieval is exact-match and heuristic-ranked, not embedding-backed semantic search
- extractors are intentionally conservative and rule-based
- task completion is explicit (`/task-done`) rather than inferred automatically
- memory is repo-local; there is no shared/team memory layer yet

## Pi runtime verification checklist

When you test this inside a real Pi CLI environment, verify these cases:

1. **Extension load**
   - start Pi inside this repo
   - confirm `session_start` shows a memory-ready status/notification
2. **Reload behavior**
   - edit `.pi/extensions/memory.ts`
   - run `/reload`
   - confirm the extension reinitializes cleanly
3. **Prompt injection**
   - run `/memory-remember "Always use pnpm test"`
   - ask a related question
   - confirm `before_agent_start` appends the memory block
   - inspect with `/memory-why <query>`
4. **Tool capture**
   - run a command through Pi that succeeds/fails
   - confirm `tool_result` writes an episode and retrievable lesson/knowledge fact
5. **Checkpoint flow**
   - run `/task-start fix auth redirect`
   - work in a task-scoped session
   - confirm `turn_end` writes a checkpoint visible through `/memory-checkpoint`
   - run `/task-done` when finished and confirm the active task clears
6. **Cross-host portability**
   - prefer `notify`, `input`, `editor`, `setEditorText`, `setStatus`
   - avoid relying on `ctx.ui.custom()` until terminal-only behavior is acceptable

## Advanced Pi extension features included

The extension also contains the remaining production-hardening scaffolds mentioned in the research plan:

- **payload verification** via `.memory/pi-hook-debug.jsonl`
- **hook-debug command** to inspect captured hook payloads inside Pi
- **conservative `input` hook**: if a prompt contains `#memory`, it is rewritten using Pi's current `input` transform API before the model sees it
- **`memory_search` tool** registered through `pi.registerTool()` so the model can query memory directly
- **`memory_remember` tool** so the model can propose stable memories while still requiring user confirmation before save
- **`memory-forget` command** to archive a fact without deleting history
- **active task pointer** stored in `.memory/active-task.json`

### Memory writing behavior

- **User chat alone is not auto-saved by default**
- **Stable user/project preferences** should be saved via `/memory-remember ...` or by the agent calling `memory_remember`, which asks for confirmation first
- **Tool runs** (`bash`, `edit`, `write`) are captured automatically as episodes
- **Trap issues** are auto-saved as `lesson` facts only when the extension sees a recent failure followed by a success and the assistant clearly states both **Root cause:** and **Fix:** in the resolution message

### Suggested runtime verification flow in Pi CLI

```text
/reload
/task-start fix auth redirect
/memory-remember Always use pnpm test
/memory-why package manager
/memory-hook-debug before_agent_start
/memory-checkpoint
```

Then try a normal prompt containing `#memory` and a tool execution to confirm:

- the input hook rewrites correctly
- the tool result is captured
- the payload log shows the real event field names for your Pi build
