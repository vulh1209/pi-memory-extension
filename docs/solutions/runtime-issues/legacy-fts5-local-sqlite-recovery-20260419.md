---
title: Legacy FTS5 local SQLite recovery
date: 2026-04-19
problem_type: runtime_issue
component: sqlite_runtime
severity: moderate
tags:
  - sqlite
  - fts5
  - migration
  - pi-extension
symptoms:
  - 'Extension load fails with: no such module: fts5'
  - 'Failure happens during GraphitiLiteMemoryStore.init on an older .memory/pi-memory.sqlite database'
root_cause: old local database schema still referenced an FTS5 virtual table even after the extension code stopped requiring FTS5
status: resolved
---

# Legacy FTS5 local SQLite recovery

## Symptom

Pi fails while loading the project-local extension with an error like:

```text
Extension ".../.pi/extensions/memory.ts" error: no such module: fts5
```

The stack points into:

- `src/memory/store.ts`
- `src/memory/local-sqlite-backend.ts`
- `src/memory/pi-extension.ts`

## Root cause

The extension used to create `.memory/pi-memory.sqlite` with an FTS5-backed schema.

Even after the codebase was updated to remove the hard FTS5 dependency, existing repo-local SQLite files could still contain legacy schema objects that reference FTS5. On Node / Electron SQLite builds without FTS5 support, merely opening that old database can fail before the new schema logic gets a chance to run.

## Resolution

### Code-level fix

`src/memory/local-sqlite-backend.ts` now:

1. attempts to open the local store normally
2. detects legacy `fts5` initialization errors
3. renames the old DB to a backup file
4. removes stale `-shm` and `-wal` side files
5. recreates a fresh local DB using the current non-FTS5 schema

Backup name pattern:

```text
.memory/pi-memory.sqlite.legacy-fts5-<timestamp>.bak
```

### Manual recovery

If the repo is already stuck on an old DB, clear or rename the old files manually:

```bash
rm -f .memory/pi-memory.sqlite .memory/pi-memory.sqlite-shm .memory/pi-memory.sqlite-wal
```

Or keep a manual backup:

```bash
mv .memory/pi-memory.sqlite .memory/pi-memory.sqlite.legacy.bak
rm -f .memory/pi-memory.sqlite-shm .memory/pi-memory.sqlite-wal
```

Then restart Pi.

## Prevention / lesson learned

- Do not put runtime troubleshooting details into `README.md` if they are only relevant to recovery/debug scenarios.
- Keep durable troubleshooting knowledge in targeted lesson docs so agents can fetch it on demand.
- When removing a storage dependency like FTS5, account for already-created local databases, not just fresh installs.
- For local SQLite schema changes, recovery logic should tolerate old DB files instead of assuming a clean workspace.

## When to consult this doc

Look up this lesson only when:

- Pi extension startup fails on SQLite initialization
- the error mentions `fts5`
- the repo contains an older `.memory/pi-memory.sqlite`

## Related files

- `src/memory/local-sqlite-backend.ts`
- `src/memory/store.ts`
- `sql/001_graphiti_lite_memory.sql`
- `RELEASE.md`
