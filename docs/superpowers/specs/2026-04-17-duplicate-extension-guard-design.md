# Duplicate Extension Guard Design

**Context**
This repo exposes the same Pi memory extension through two load paths:
- package entrypoint: `extensions/memory.ts`
- local development wrapper: `.pi/extensions/memory.ts`

When both are loaded in the same Pi runtime, the extension registers the same tool (`memory_search`) twice and Pi reports a tool conflict.

## Goal
Allow duplicate loads of the same memory extension to fail safe:
- first load remains active
- later loads skip tool/command/hook registration
- user sees a single in-product notify warning
- no duplicate hook side effects occur

## Chosen approach
Use a singleton guard stored on `globalThis` via `Symbol.for(...)`.

### Behavior
1. First extension instance claims the singleton and registers all existing hooks, commands, and tools.
2. Duplicate instances do not register the memory hooks, commands, or `memory_search` tool.
3. Duplicate instances register only a minimal notify hook so the user sees a warning.
4. The active instance clears the singleton during `session_shutdown` so `/reload` and future sessions can load normally.

## Warning behavior
- Notify only through Pi UI (`ctx.ui.notify`)
- Show at most once per runtime
- Message should clearly explain that duplicate registration was skipped

## Non-goals
- Merging multiple copies of the extension
- Supporting two simultaneously active variants of the same extension
- Changing memory behavior in the single-load case

## Verification
- Add an automated test covering duplicate load skip behavior
- Add an automated test covering singleton reset on `session_shutdown`
- Run the targeted Node test file to verify both cases
