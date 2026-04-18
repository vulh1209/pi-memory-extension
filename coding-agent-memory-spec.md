# Coding Agent Memory Specification

## Status

Draft specification for a practical coding-agent memory system that balances low token cost, simple implementation, and meaningful long-term learning.

## Purpose

This specification defines a memory system for a real coding assistant, not a generic chatbot.

The system must help the agent:

- retain durable project context across sessions
- avoid repeating known mistakes
- resume interrupted work safely
- adapt behavior using verified lessons
- stay inspectable, editable, and predictable for developers

The system must not:

- blindly replay large chat histories
- silently override current repository reality
- store unverified noise as durable guidance
- become an opaque source of behavioral drift

## Design Principles

1. Repository reality wins.
2. User instructions win over remembered preferences.
3. Memory is guidance, not authority.
4. Short always-loaded memory is better than large always-loaded memory.
5. Retrieval should be relevance-based and observable.
6. Durable memory should be explicit, versionable, and easy to prune.
7. Lessons should be promoted only after evidence or repetition.

## Memory Model

The system uses four memory layers.

### 1. Rule Memory

Purpose:

- store hard constraints, conventions, and non-negotiable instructions

Examples:

- coding style rules
- forbidden workflows
- deployment guardrails
- path-specific instructions
- compliance requirements

Properties:

- high trust
- human-authored or human-approved
- always eligible for loading
- version-controlled whenever possible

### 2. Knowledge Memory

Purpose:

- store stable project facts and repeated workflows

Examples:

- architecture facts
- service boundaries
- build and test commands
- dependency quirks
- known environment assumptions
- ownership and escalation notes

Properties:

- medium to high trust
- project-scoped
- loaded by relevance, not by default in full

### 3. Episodic Memory

Purpose:

- store concrete past episodes the agent can learn from

Examples:

- failed attempts
- root causes
- debugging paths that worked or failed
- user corrections
- environment traps
- migration incidents

Properties:

- medium trust
- time-bound
- retrieved on demand
- source material for future promotion

### 4. Checkpoint Memory

Purpose:

- store resumable task state for in-progress work

Examples:

- current plan
- next recommended step
- blocked reason
- files already inspected
- tests already run
- unresolved questions

Properties:

- short-lived by default
- task-scoped
- optimized for session continuity and recovery

## Memory Scopes

Memory must support explicit scope boundaries.

- `global`: personal preferences and cross-project habits
- `organization`: shared conventions and platform rules
- `project`: repo-specific facts and lessons
- `path`: subdirectory or component-specific rules
- `task`: current work package or issue
- `agent-role`: reviewer, implementer, migration specialist, frontend specialist, and similar roles

Resolution order:

1. current user instruction
2. current repository files and runtime signals
3. task memory
4. path memory
5. project memory
6. organization memory
7. global memory

When memory conflicts, the system must surface the conflict instead of silently merging it.

## Canonical Storage Layout

Recommended filesystem layout:

```text
.memory/
  README.md
  index.md
  rules/
    global.md
    project.md
    paths/
      plugins-tender-plugin.md
  knowledge/
    architecture.yaml
    workflows.yaml
    tools.yaml
    decisions.yaml
  episodes/
    2026-04-17-ci-timeout.json
    2026-04-18-spreadsheet-grounding-failure.json
  checkpoints/
    current-task.json
    task-<id>.json
  roles/
    reviewer.md
    implementer.md
    migration-specialist.md
  indexes/
    tags.json
    entities.json
    errors.json
```

This layout can start as plain files and later move to a database without changing the conceptual model.

## Core Data Schemas

### Rule Record

```yaml
id: use-spreadsheet-read-first
scope: project
path_scope:
  - plugins/tender-plugin
role_scope:
  - implementer
title: Prefer spreadsheet_read for tender spreadsheet grounding
rule: Use spreadsheet_read before shell parsing when spreadsheet-backed facts need reviewable grounding.
rationale: The host citation flow depends on exact spreadsheet grounding.
source:
  type: repo_doc
  path: plugins/tender-plugin/skills/tender-spreadsheet-citation-grounding/SKILL.md
priority: high
confidence: 0.98
last_verified: 2026-04-17
status: active
```

### Knowledge Record

```yaml
id: plugin-runtime-surfaces
scope: project
category: architecture
title: Tender plugin uses conservative Vesper surfaces
facts:
  - Native manifest declares skills, commands, and subagents.
  - Declarative surfaces include ui_extensions and post_response_renderers.
  - Hooks include before_turn, after_response, and watchdog_poll.
tags: [plugin, vesper, runtime, manifest]
source:
  type: repo_doc
  path: plugins/tender-plugin/PLUGIN_PLATFORM_STATUS.md
confidence: 0.95
last_verified: 2026-04-17
status: active
```

### Episodic Record

```json
{
  "id": "episode-2026-04-17-spreadsheet-tool-resolution",
  "scope": "project",
  "task": "Ground spreadsheet facts in Pi runtime",
  "timestamp": "2026-04-17T10:20:00Z",
  "symptoms": [
    "Tool catalog query returned no spreadsheet tool"
  ],
  "failed_attempts": [
    "Assumed spreadsheet_read was unavailable after catalog search"
  ],
  "root_cause": "Pi runtime can expose spreadsheet access through vesper_execute wrapper instead of a top-level tool",
  "fix": "Attempt vesper_execute calling vesper.spreadsheet_read(...) before falling back",
  "lesson": "An empty tool catalog is not enough evidence to declare spreadsheet_read unavailable in Pi runtime",
  "tags": ["pi-runtime", "spreadsheet", "tooling", "grounding"],
  "source": {
    "type": "repo_doc",
    "path": "plugins/tender-plugin/skills/tender-spreadsheet-citation-grounding/SKILL.md"
  },
  "confidence": 0.96,
  "last_verified": "2026-04-17",
  "promote_candidate": true
}
```

### Checkpoint Record

```json
{
  "task_id": "memory-docs-rollout",
  "title": "Draft memory spec and Pi extension report",
  "status": "in_progress",
  "goal": "Produce reusable docs for future agents",
  "completed_steps": [
    "Inspected repo plugin surfaces",
    "Mapped Pi runtime note to spreadsheet grounding flow"
  ],
  "next_step": "Review generated docs against repo constraints",
  "open_questions": [
    "Whether the host exposes a first-class memory API in future builds"
  ],
  "related_files": [
    "docs/coding-agent-memory-spec.md",
    "docs/pi-extension-memory-report.md"
  ],
  "updated_at": "2026-04-17T10:45:00Z"
}
```

## Read Path

The agent should not load all memory on every turn.

Recommended read pipeline:

1. Load minimal always-on memory.
2. Detect task context, file paths, commands, stack, and errors.
3. Retrieve only relevant project, path, role, and task memory.
4. Expand into full episodic detail only when confidence is high enough.
5. Surface loaded memory provenance in the agent trace or response metadata.

### Always-On Memory Budget

Always-on memory should stay small.

Recommended always-on set:

- active rule memory for the current project
- concise project index
- current checkpoint for the active task

Recommended target:

- 0.5 to 2.0 KB compressed content equivalent per turn, or the smallest workable prompt footprint for the host runtime

### Retrieval Signals

Rank retrieval using exact signals first.

- repo path
- file name
- command name
- test name
- stack trace fragment
- error message substring
- tool name
- framework tag
- agent role

Semantic or embedding search is optional and should come after exact matching, not before.

## Write Path

Do not write durable memory on every turn.

Recommended write triggers:

- repeated failure
- user correction
- verified root cause discovered
- surprising environment constraint
- successful fix after a failed attempt
- repeated workflow clarification from the user
- explicit user instruction to remember something

Write flow:

1. Capture a candidate note.
2. Attach source, confidence, scope, and tags.
3. Classify as rule, knowledge, episode, or checkpoint.
4. Queue for consolidation or immediate update if high confidence.
5. Ask for approval when the memory is personal, preference-based, or high-impact.

## Consolidation Pipeline

Memory quality depends on consolidation.

Recommended stages:

1. `capture`
Short raw note or event summary.

2. `normalize`
Convert to schema, add tags, source, confidence, and scope.

3. `deduplicate`
Merge duplicate or overlapping memories.

4. `promote`
Promote recurring episodic lessons into project rules or knowledge.

5. `expire`
Archive or downgrade stale memories.

6. `verify`
Refresh high-value memories against current repo reality.

Promotion heuristics:

- same lesson observed more than once
- user explicitly confirms it
- backed by repository docs, tests, or stable code
- applies to a repeated workflow

## Ranking and Conflict Handling

Each memory record should carry:

- `confidence`
- `priority`
- `last_verified`
- `source_type`
- `status`

Suggested source trust order:

1. repository file or passing test
2. explicit user instruction
3. approved durable memory
4. recent episode
5. inferred association

If two active memories conflict:

- prefer the one with stronger source trust and newer verification
- flag the conflict
- avoid silently combining incompatible instructions

## Traceability Requirements

The system must be inspectable.

At minimum, the agent should be able to show:

- which memory entries were loaded
- why they matched
- which scope they came from
- whether they are verified or inferred
- which entries affected the final answer or action plan

This can be exposed in logs, traces, or an optional developer-facing panel.

## Staleness and Forgetting

Memory should decay unless refreshed.

Recommended rules:

- checkpoints expire quickly unless pinned
- episodes downgrade when not re-observed
- knowledge records require periodic verification
- rules stay active until explicitly changed or contradicted

Suggested statuses:

- `active`
- `candidate`
- `stale`
- `archived`
- `superseded`

## Security and Safety

Memory can become a prompt-injection vector if handled badly.

Required safeguards:

- scope isolation between projects
- provenance on every durable record
- no silent import from untrusted external content
- approval gates for sensitive preferences or secrets
- secret redaction before persistence
- never treat memory as stronger than current repository or user instructions

Sensitive data that should not be stored by default:

- tokens
- passwords
- private keys
- raw credentials
- personal data unrelated to the task

## Agent Integration Contract

An implementation should expose the following operations:

- `load_memory(context)`
- `search_memory(query, scope_filters)`
- `capture_memory(event)`
- `promote_memory(record_id, target_layer)`
- `update_checkpoint(task_id, checkpoint)`
- `list_loaded_memory()`
- `deprecate_memory(record_id, reason)`

Minimal pseudocode:

```ts
const context = collectTurnContext();
const alwaysOn = loadAlwaysOnMemory(context.project);
const retrieved = searchMemory({
  project: context.project,
  role: context.role,
  paths: context.paths,
  signals: context.signals,
});

const effectiveMemory = rankAndFilter([...alwaysOn, ...retrieved]);
const result = runAgent({ context, memory: effectiveMemory });

const candidates = extractMemoryCandidates({
  context,
  result,
  userFeedback: context.userFeedback,
});

persistCheckpoint(context.taskId, result.checkpoint);
queueMemoryCandidates(candidates);
```

## UX Requirements

Developers need control, not magic.

Required UX behaviors:

- let users inspect stored memory
- let users edit, delete, or pin entries
- separate auto-generated memory from explicit rules
- show scope clearly
- allow project-only and path-only memories
- make memory usage visible in agent traces or diagnostics

Helpful UX additions:

- “remember this for this repo”
- “forget this lesson”
- “promote this to a rule”
- “show why you loaded this memory”

## Implementation Phases

### Phase 1: File-Based MVP

- plain files under `.memory/`
- rule, knowledge, episode, and checkpoint schemas
- exact-match retrieval
- manual review and editing

### Phase 2: Consolidation and Promotion

- automatic candidate capture
- dedupe and promotion jobs
- conflict detection
- staleness handling

### Phase 3: Rich Retrieval

- embedding search for large episode sets
- role-aware retrieval
- path-aware ranking
- observability UI

### Phase 4: Team and Host Integration

- shared team memory with approval flows
- host-side memory panels
- event-driven memory hooks
- policy enforcement for sensitive memory

## Success Criteria

The memory system is working if:

- developers repeat less project setup context
- the agent avoids known workflow traps
- session recovery is faster
- the agent references verified project conventions more reliably
- memory usage is inspectable and rarely surprising
- token cost stays controlled because retrieval is selective

## Anti-Goals

Do not optimize for:

- storing every message forever
- replacing repository documentation
- hiding important reasoning in opaque memory layers
- broad personal profiling unrelated to development work

## Recommended Default

If only one version is implemented, build this:

- file-based hierarchical memory
- always-on rules plus compact project index
- episodic capture on failures and corrections
- checkpoint persistence for task continuity
- consolidation that promotes repeated lessons into stable project guidance

That is the best default balance between implementation cost, token usage, and practical intelligence gains.
