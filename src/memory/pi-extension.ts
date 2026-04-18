import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import { createMemoryBackend } from './backend-factory.ts';
import type { ActiveFactsInput, MemoryBackend } from './backend-types.ts';
import type { MemoryBackendStatus } from './diagnostics.ts';
import type { CheckpointInput, CheckpointRecord, FactRecord, IngestResult, MemoryHit } from './types.ts';

const backendCache = new Map<string, Promise<MemoryBackend>>();
const HOOK_DEBUG_FILE = 'pi-hook-debug.jsonl';

type HookDebugRecord = {
  timestamp: string;
  hook: string;
  payload: unknown;
  derived?: Record<string, unknown>;
};

export function detectRepoRoot(startDir?: string): string {
  let current = resolve(startDir ?? process.cwd());

  while (true) {
    if (
      existsSync(resolve(current, '.git')) ||
      existsSync(resolve(current, '.pi')) ||
      existsSync(resolve(current, 'package.json'))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir ?? process.cwd());
    }
    current = parent;
  }
}

export function toProjectId(repoRoot: string): string {
  return `repo:${repoRoot}`;
}

export function getPathScope(repoRoot: string, cwd?: string): string | undefined {
  if (!cwd) {
    return undefined;
  }

  const rel = relative(repoRoot, cwd);
  if (!rel || rel === '' || rel === '.') {
    return undefined;
  }

  return rel.split(sep).join('/');
}

export async function getStoreForRepo(repoRoot: string): Promise<MemoryBackend> {
  const normalizedRoot = resolve(repoRoot);
  const existing = backendCache.get(normalizedRoot);
  if (existing) {
    return existing;
  }

  const created = createMemoryBackend();
  backendCache.set(normalizedRoot, created);
  return created;
}

export async function clearMemoryBackendCache(): Promise<void> {
  const entries = [...backendCache.values()];
  backendCache.clear();
  for (const backendPromise of entries) {
    const backend = await backendPromise;
    await backend.dispose?.();
  }
}

export async function initializeMemoryRepo(repoRoot: string): Promise<MemoryBackendStatus> {
  const backend = await getStoreForRepo(repoRoot);
  await backend.initRepo(repoRoot);
  return backend.getStatus(repoRoot);
}

export async function getMemoryStatus(args: { repoRoot: string }): Promise<MemoryBackendStatus> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  return backend.getStatus(args.repoRoot);
}

export function formatMemoryHits(hits: MemoryHit[]): string {
  if (hits.length === 0) {
    return 'No relevant memory loaded.';
  }

  return hits
    .map((hit, index) => {
      const why = hit.why.join(', ');
      return `${index + 1}. [${hit.factType}] ${hit.factText}\n   confidence=${hit.confidence.toFixed(2)} score=${hit.score.toFixed(3)} why=${why}`;
    })
    .join('\n');
}

export function formatFactList(facts: FactRecord[]): string {
  if (facts.length === 0) {
    return 'No facts found.';
  }

  return facts
    .map((fact) => `- ${fact.id} [${fact.status}] ${fact.predicate}: ${fact.factText}`)
    .join('\n');
}

export function formatCheckpoint(checkpoint: CheckpointRecord | null): string {
  if (!checkpoint) {
    return 'No active checkpoint.';
  }

  return [
    `Task: ${checkpoint.taskId}`,
    `Status: ${checkpoint.status}`,
    `Summary: ${checkpoint.summary}`,
    checkpoint.nextStep ? `Next step: ${checkpoint.nextStep}` : null,
    checkpoint.blockers ? `Blockers: ${checkpoint.blockers}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function searchProjectMemory(args: {
  repoRoot: string;
  query: string;
  limit?: number;
}): Promise<{ status: MemoryBackendStatus; hits: MemoryHit[] }> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return { status, hits: [] };
  }

  const hits = await backend.searchMemory(args.repoRoot, {
    query: args.query,
    scopeType: 'project',
    scopeId: toProjectId(args.repoRoot),
    activeOnly: true,
    limit: args.limit ?? 8,
  });

  return { status, hits };
}

export async function inspectMemoryFacts(args: {
  repoRoot: string;
  input: ActiveFactsInput;
}): Promise<{ status: MemoryBackendStatus; facts: FactRecord[] }> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return { status, facts: [] };
  }

  const facts = await backend.getActiveFacts(args.repoRoot, args.input);
  return { status, facts };
}

export async function loadTaskCheckpoint(args: {
  repoRoot: string;
  taskId: string;
}): Promise<{ status: MemoryBackendStatus; checkpoint: CheckpointRecord | null }> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return { status, checkpoint: null };
  }

  const checkpoint = await backend.loadCheckpoint(args.repoRoot, args.taskId);
  return { status, checkpoint };
}

export async function rememberMemoryNote(args: {
  repoRoot: string;
  input: Parameters<MemoryBackend['ingestEpisode']>[1];
}): Promise<{ status: MemoryBackendStatus; result: IngestResult | null }> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return { status, result: null };
  }

  const result = await backend.ingestEpisode(args.repoRoot, args.input);
  return { status, result };
}

export async function buildPromptMemory(args: {
  repoRoot: string;
  query: string;
  cwd?: string;
  taskId?: string;
  roleScope?: string;
  limit?: number;
}): Promise<{
  promptBlock: string;
  hits: MemoryHit[];
  checkpoint: CheckpointRecord | null;
  status: MemoryBackendStatus;
}> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return {
      promptBlock: '',
      hits: [],
      checkpoint: null,
      status,
    };
  }

  const projectId = toProjectId(args.repoRoot);
  const pathScope = getPathScope(args.repoRoot, args.cwd);
  const hits = await backend.searchMemory(args.repoRoot, {
    query: args.query,
    scopeType: 'project',
    scopeId: projectId,
    pathScope,
    roleScope: args.roleScope,
    taskId: args.taskId,
    activeOnly: true,
    limit: args.limit ?? 6,
  });

  const checkpoint = args.taskId ? await backend.loadCheckpoint(args.repoRoot, args.taskId) : null;
  const memoryLines = hits.map((hit) => `- [${hit.factType}] ${hit.factText}`);

  const checkpointLines = checkpoint
    ? [
        `Checkpoint summary: ${checkpoint.summary}`,
        checkpoint.nextStep ? `Checkpoint next step: ${checkpoint.nextStep}` : null,
        checkpoint.blockers ? `Checkpoint blockers: ${checkpoint.blockers}` : null,
      ].filter(Boolean)
    : [];

  return {
    promptBlock: [...memoryLines, ...checkpointLines].join('\n').trim(),
    hits,
    checkpoint,
    status,
  };
}

export async function captureToolEpisode(args: {
  repoRoot: string;
  cwd?: string;
  taskId?: string;
  toolName: string;
  input?: unknown;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return;
  }

  const projectId = toProjectId(args.repoRoot);
  const pathScope = getPathScope(args.repoRoot, args.cwd);
  const command = extractCommand(args.input);
  const errorText = extractErrorText(args.error ?? args.result);
  const success = !args.error && !looksLikeError(args.result);
  const summary = success
    ? `${args.toolName} succeeded${command ? `: ${command}` : ''}`
    : `${args.toolName} failed${command ? `: ${command}` : ''}${errorText ? ` (${errorText})` : ''}`;

  await backend.ingestEpisode(args.repoRoot, {
    projectId,
    taskId: args.taskId,
    scopeType: pathScope ? 'path' : 'project',
    scopeId: pathScope ?? projectId,
    sourceType: 'tool_run',
    sourceName: args.toolName,
    actor: 'tool',
    repoRoot: args.repoRoot,
    cwd: args.cwd,
    content: summary,
    metadata: {
      success,
      command,
      error: errorText,
      input: safeSerialize(args.input),
      result: safeSerialize(args.result),
    },
  });
}

export async function saveTaskCheckpoint(args: {
  repoRoot: string;
  taskId: string;
  summary: string;
  nextStep?: string;
  blockers?: string;
  cwd?: string;
  sourceEpisodeId?: string;
}): Promise<{ checkpointId: string } | null> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return null;
  }

  const projectId = toProjectId(args.repoRoot);
  const pathScope = getPathScope(args.repoRoot, args.cwd);
  const checkpoint: CheckpointInput = {
    projectId,
    taskId: args.taskId,
    scopeType: 'task',
    scopeId: args.taskId,
    status: args.blockers ? 'blocked' : 'active',
    summary: args.summary,
    nextStep: args.nextStep,
    blockers: args.blockers,
    filesTouched: pathScope ? [pathScope] : [],
    sourceEpisodeId: args.sourceEpisodeId,
  };

  return backend.saveCheckpoint(args.repoRoot, checkpoint);
}

export async function forgetMemoryFact(args: {
  repoRoot: string;
  factId: string;
  reason?: string;
}): Promise<FactRecord | null> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return null;
  }
  return backend.forgetFact(args.repoRoot, args.factId, args.reason ?? 'Forgotten by user');
}

export async function getMemoryFactById(args: {
  repoRoot: string;
  factId: string;
}): Promise<FactRecord | null> {
  const backend = await getStoreForRepo(args.repoRoot);
  await backend.initRepo(args.repoRoot);
  const status = await backend.getStatus(args.repoRoot);
  if (!status.available) {
    return null;
  }
  return backend.getFactById(args.repoRoot, args.factId);
}

export function appendHookDebug(args: {
  repoRoot: string;
  hook: string;
  payload: unknown;
  derived?: Record<string, unknown>;
}): void {
  const dir = resolve(args.repoRoot, '.memory');
  mkdirSync(dir, { recursive: true });
  const record: HookDebugRecord = {
    timestamp: new Date().toISOString(),
    hook: args.hook,
    payload: safeSerialize(args.payload),
    derived: args.derived,
  };
  appendFileSync(resolve(dir, HOOK_DEBUG_FILE), `${JSON.stringify(record)}\n`, 'utf8');
}

export function readHookDebug(args: {
  repoRoot: string;
  hook?: string;
  limit?: number;
}): HookDebugRecord[] {
  const file = resolve(args.repoRoot, '.memory', HOOK_DEBUG_FILE);
  if (!existsSync(file)) {
    return [];
  }

  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as HookDebugRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is HookDebugRecord => Boolean(record));

  const filtered = args.hook ? rows.filter((record) => record.hook === args.hook) : rows;
  return filtered.slice(-(args.limit ?? 20));
}

export function formatHookDebug(records: HookDebugRecord[]): string {
  if (records.length === 0) {
    return 'No hook debug entries captured yet.';
  }

  return records
    .map((record, index) => {
      const derived = record.derived ? `\nDerived: ${JSON.stringify(record.derived, null, 2)}` : '';
      return `${index + 1}. [${record.timestamp}] ${record.hook}${derived}\nPayload: ${JSON.stringify(record.payload, null, 2)}`;
    })
    .join('\n\n');
}

function extractCommand(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const command = candidate.command ?? candidate.cmd ?? candidate.args;
  if (typeof command === 'string') {
    return command;
  }

  return undefined;
}

function looksLikeError(result: unknown): boolean {
  if (!result) {
    return false;
  }

  if (typeof result === 'string') {
    return /error|failed|exception/i.test(result);
  }

  if (typeof result === 'object') {
    const text = JSON.stringify(result);
    return /error|failed|exception/i.test(text);
  }

  return false;
}

function extractErrorText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.error === 'string') {
      return candidate.error;
    }
    if (typeof candidate.message === 'string') {
      return candidate.message;
    }
    return JSON.stringify(candidate).slice(0, 500);
  }

  return String(value);
}

function safeSerialize(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
