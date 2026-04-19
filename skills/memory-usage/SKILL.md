---
name: memory-usage
description: Use when working with project memory, durable rules, preferences, lessons learned, checkpoints, or when deciding whether information should be saved, searched, or left temporary. Explains how to use memory_search and memory_remember and how to phrase notes so they become searchable facts.
---

# Memory Usage

Use this skill when:

- the user asks to remember, save, store, forget, or inspect project memory
- you need prior project rules, preferences, or previously fixed issues
- you are deciding whether information is durable memory or only temporary task context
- you need to phrase a memory note so the extractor can turn it into searchable facts

## Core policy

- Do not claim something was remembered durably unless it was actually saved.
- Prefer searching memory before re-deriving stable rules or past fixes.
- Durable memory should be selective, stable, and reusable.
- Temporary context, guesses, and one-off chatter should usually not be saved.
- If an existing saved memory is outdated or conflicts with a newly verified fact, do not leave both active by accident.
- Archive the stale fact first, then save the corrected note.

## When to use `memory_search`

Use `memory_search` when:

- the user asks what was decided before
- you suspect the same issue happened earlier
- you want to check whether a rule or lesson already exists before saving a duplicate
- you need saved context before proposing a repeated fix

Good examples:

- "Search memory for previous migration lessons."
- "Check whether we already saved anything about duplicate extension loads."
- "Before proposing a fix, search project memory for related runtime issues."

## When to use `memory_remember`

Use `memory_remember` only for durable information such as:

- stable project rules
- repeated team preferences
- verified lessons learned
- guidance likely to matter in future sessions

Do not use it for:

- speculative ideas
- one-off temporary instructions
- noisy summaries with no later reuse value
- vague notes that are hard to search

## Canonical note formats

Prefer canonical phrasing so the extractor can create searchable facts.

### Rules

Good:

- `Project rule: Always run auth tests before release.`
- `Project rule: Do not import runtime-specific dependencies on the top-level extension load path.`

### Preferences

Good:

- `Always use pnpm test.`
- `Prefer helper-backed fallback over runtime crash.`

### Lessons

Good:

- `Lesson learned: Storage/runtime migrations must handle existing local databases, not just fresh installs. Root cause: legacy local databases can keep obsolete schema dependencies. Fix: add startup recovery for old DB artifacts.`
- `Lesson learned: Avoid top-level node:sqlite imports on the extension load path. Root cause: unsupported runtimes can fail during module evaluation before fallback runs. Fix: lazy-load sqlite behind backend selection. Verified at commit: abc1234. Source: src/memory/backend-factory.ts.`

### Code-tied lesson metadata

When a lesson is tied to a specific code path, runtime behavior, migration, or implementation detail, include grounding metadata in the saved note when possible:

- `Verified at commit: <short-hash or full hash>`
- `Source: <file path or doc path>`

Why:

- commit hashes make the lesson traceable to the code state where it was verified
- source paths make it easier to re-check whether the lesson is still valid after refactors
- this reduces stale or misleading context when the code changes later

Avoid vague phrasing like:

- `this seems important`
- `maybe remember this`
- `we learned something about sqlite`

## Before saving a note

Check these questions:

1. Is it stable?
2. Is it likely useful later?
3. Is it specific enough to search?
4. Is it already in memory?
5. Is it phrased canonically?

If unsure, search first.

## Recommended workflow

### Save a rule

1. Rewrite it into canonical form.
2. Call `memory_remember`.
3. Only say it was saved if the tool actually saved it.

### Save a lesson

1. Make sure it is verified.
2. Include both `Root cause:` and `Fix:`.
3. If the lesson depends on current code behavior, include `Verified at commit:` and `Source:` when available.
4. Call `memory_remember` with category `lesson`.

### Replace outdated or conflicting memory

1. Search memory first to find the existing fact.
2. If the saved fact is outdated, invalid, or conflicts with a newly verified fact, archive the old fact with `memory-forget`.
3. Save the corrected note with `memory_remember`.
4. Do not leave two active facts that contradict each other unless coexistence is intentional.

Good example:

- Old lesson says a runtime requires FTS5, but the implementation changed.
- Archive the stale lesson.
- Save the new verified lesson with updated `Root cause:`, `Fix:`, and if code-tied, `Verified at commit:` and `Source:`.

### Search memory

1. Build a focused query.
2. Call `memory_search`.
3. Use the results in the answer.
4. If there are no hits, say so plainly.

## Good agent behavior

- "I found no relevant saved memory yet."
- "This looks like a durable project rule; do you want me to save it?"
- "I can save this as a lesson if you want."

## Bad agent behavior

- "I'll remember that" when nothing was saved
- saving temporary or noisy chat as durable memory
- storing non-canonical notes that the extractor cannot turn into searchable facts
