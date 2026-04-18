# Pi Memory Extension Prototype

A small **Graphiti-lite** local memory prototype for a coding-agent / Pi CLI style extension.

## What is included

- SQLite schema with temporal facts, provenance episodes, checkpoints, and FTS5
- TypeScript repository layer using Node's built-in `node:sqlite`
- Lightweight local hashing embedder for semantic-ish retrieval without external APIs
- Demo ingestion + retrieval flow

## Quick start

### 1. Validate the schema

```bash
npm run check:schema
```

### 2. Run the local demo

```bash
npm run demo
```

The demo creates a local SQLite file at:

```text
.memory/graphiti-lite-demo.sqlite
```



## Publish as an npm Pi package

This repo is now structured so it can be published as a **Pi package** on npm.

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

### Dry-run the package contents

```bash
npm run check:package
npm run pack:dry-run
```

### Publish

If the npm package name is available and you are logged in:

```bash
npm publish
```

If you want a scoped package, rename `package.json` first, for example:

```json
{
  "name": "@lehoangvu/pi-memory-extension"
}
```

Then publish with:

```bash
npm publish --access public
```

### Install into Pi

Global/user-level:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```

Or for a scoped package:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```

Project-local install:

```bash
pi install -l npm:@lehoangvu/pi-memory-extension
```

You can also test the package without publishing:

```bash
pi install ./
```

### settings.json alternative

```json
{
  "packages": [
    "npm:@lehoangvu/pi-memory-extension"
  ]
}
```

### About `npm -g`

You **can** publish this package to npm and install it globally with:

```bash
npm i -g @lehoangvu/pi-memory-extension
```

But for Pi, the preferred flow is still:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```

because Pi resolves package resources from the package manifest (`pi.extensions`) rather than from npm's global install path.

## Pi CLI extension adapter

This repo now also includes a **Pi CLI extension entrypoint** at:

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

### Intended usage in a Pi-enabled repo

1. Copy or link this extension into a Pi project under `.pi/extensions/`
2. Ensure the Pi runtime can resolve the `src/memory/*` files
3. Start Pi and use `/reload` after changes

The extension adapter is intentionally conservative: it uses hooks + commands first, without introducing a custom remote service.

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

The extension now also contains the remaining production-hardening scaffolds mentioned in the research plan:

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
