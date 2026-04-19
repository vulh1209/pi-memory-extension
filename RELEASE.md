# Release Checklist

## Current bugfix release target

- Version: `0.1.3`
- Package: `@lehoangvu/pi-memory-extension`
- Scope: publish the current Pi-compatible memory MVP, including the no-FTS5 storage path, active-task flow, and legacy FTS5 database auto-recovery

## Recommended release flow for 0.1.3

1. Verify the package locally
2. Publish `0.1.3` to npm
3. Reinstall the npm package in Pi
4. Run `/reload`
5. Confirm Pi no longer reports runtime startup failures for the current MVP build

For historical recovery details such as legacy local SQLite / FTS5 migration, see:

```text
docs/solutions/runtime-issues/legacy-fts5-local-sqlite-recovery-20260419.md
```

6. Confirm that duplicate loads now degrade safely by showing one warning instead of failing hard
7. Confirm any legacy local DB recovery behavior matches the dedicated runtime lesson doc above

## 0. Preconditions

Make sure you own or have publish access to the npm scope:

```bash
npm whoami
```

If `@vule` is not your actual npm scope, update `package.json` first.

## 1. Validate the package locally

```bash
npm run check:schema
npm run check:package
npm run pack:dry-run
npm run demo
```

## 2. Test install into Pi locally before publishing

From the package repo:

```bash
pi install ./
```

Or project-local:

```bash
pi install -l ./
```

Then open Pi and verify:

```text
/reload
/memory-inspect
/memory-remember Always use pnpm test
/memory-why package manager
/memory-hook-debug before_agent_start
```

Also test:
- one successful tool run
- one failing tool run
- a prompt containing `#memory`
- `/task-start fix auth redirect`
- `/memory-checkpoint`
- `/task-done`
- `/memory-forget <factId>`

## 3. Log in to npm

```bash
npm login
```

Verify account again:

```bash
npm whoami
```

## 4. Publish to npm

Because this is a scoped public package:

```bash
npm publish --access public
```

## 5. Install from npm into Pi

Global/user-level:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```

Project-local:

```bash
pi install -l npm:@lehoangvu/pi-memory-extension
```

## 6. Alternative settings.json install

```json
{
  "packages": [
    "npm:@lehoangvu/pi-memory-extension"
  ]
}
```

## 7. Post-publish verification

Open Pi in a repo and verify:

```text
/reload
/memory-search package manager
/memory-remember Always use pnpm test
/memory-why package manager
/memory-hook-debug before_agent_start
```

Confirm these files appear in the target repo:

```text
.memory/pi-memory.sqlite
.memory/pi-hook-debug.jsonl
.memory/active-task.json
```

## 8. If npm global install is needed

Possible but not preferred:

```bash
npm i -g @lehoangvu/pi-memory-extension
```

Preferred flow for Pi remains:

```bash
pi install npm:@lehoangvu/pi-memory-extension
```
