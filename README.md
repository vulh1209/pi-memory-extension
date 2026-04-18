# Pi Memory Extension Prototype

[![CI](https://github.com/vulh1209/pi-memory-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/vulh1209/pi-memory-extension/actions/workflows/ci.yml)
[![Publish Package](https://github.com/vulh1209/pi-memory-extension/actions/workflows/publish.yml/badge.svg)](https://github.com/vulh1209/pi-memory-extension/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40lehoangvu%2Fpi-memory-extension)](https://www.npmjs.com/package/@lehoangvu/pi-memory-extension)

A small **Graphiti-lite** local memory prototype for Pi CLI / coding-agent style workflows.

## Features

- SQLite schema with temporal facts, provenance episodes, checkpoints, and FTS5
- TypeScript repository layer using Node's built-in `node:sqlite`
- Lightweight local hashing embedder for semantic-ish retrieval without external APIs
- Pi extension entrypoint for hooks, commands, and tools
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
    "extensions": ["./extensions"]
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

It wires the local store into the Pi extension lifecycle described in the research docs:

- `session_start` / `session_switch` / `session_fork` / `session_tree` -> initialize or reconstruct repo-scoped memory state
- `before_agent_start` -> retrieve relevant memory and append it to the system prompt
- `input` -> optional opt-in rewrite when the user includes `#memory` in the prompt
- `tool_result` -> capture tool success/failure episodes
- `turn_end` -> persist a lightweight task checkpoint
- hook payloads are mirrored into `.memory/pi-hook-debug.jsonl` for runtime verification

### Included slash commands

- `/memory-search <query>`
- `/memory-why <query>`
- `/memory-inspect`
- `/memory-checkpoint [taskId]`
- `/memory-remember <note>`
- `/memory-forget <factId>`
- `/memory-hook-debug [hook]`

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
```

## Design notes

This prototype intentionally copies the **important semantics** from Graphiti, not the full graph platform:

- episodes as immutable provenance
- facts with temporal validity windows
- supersede old facts instead of deleting them
- exact + semantic retrieval
- checkpoints for resumable task state

It does **not** try to implement:

- graph DB backends
- community detection
- saga modeling
- LLM-driven contradiction resolution

## Current limitations

- vector retrieval is backed by a local hashing embedder, not a production embedding model
- semantic retrieval is simple and local-first
- extractors are intentionally conservative and rule-based
- this repo is a prototype scaffold, not yet a packaged plugin

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
   - work in a task-scoped session
   - confirm `turn_end` writes a checkpoint visible through `/memory-checkpoint`
6. **Cross-host portability**
   - prefer `notify`, `input`, `editor`, `setEditorText`, `setStatus`
   - avoid relying on `ctx.ui.custom()` until terminal-only behavior is acceptable

## Advanced Pi extension features included

The extension also contains the remaining production-hardening scaffolds mentioned in the research plan:

- **payload verification** via `.memory/pi-hook-debug.jsonl`
- **hook-debug command** to inspect captured hook payloads inside Pi
- **conservative `input` hook**: if a prompt contains `#memory`, it is rewritten with a relevant memory block before the model sees it
- **`memory_search` tool** registered through `pi.registerTool()` so the model can query memory directly
- **`memory-forget` command** to archive a fact without deleting history

### Suggested runtime verification flow in Pi CLI

```text
/reload
/memory-remember Always use pnpm test
/memory-why package manager
/memory-hook-debug before_agent_start
```

Then try a normal prompt containing `#memory` and a tool execution to confirm:

- the input hook rewrites correctly
- the tool result is captured
- the payload log shows the real event field names for your Pi build
