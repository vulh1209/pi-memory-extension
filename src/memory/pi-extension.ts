import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import { createMemoryBackend } from './backend-factory.ts';
import type { ActiveFactsInput, MemoryBackend } from './backend-types.ts';
import type { MemoryBackendStatus } from './diagnostics.ts';
import type {
  ActiveTaskRecord,
  CheckpointInput,
  CheckpointRecord,
  FactRecord,
  IngestResult,
  MemoryHit,
} from './types.ts';
import { nowIso, safeJsonParse } from './utils.ts';

const backendCache = new Map<string, Promise<MemoryBackend>>();
const HOOK_DEBUG_FILE = 'pi-hook-debug.jsonl';
const ACTIVE_TASK_FILE = 'active-task.json';
const EXTENSION_CONFIG_FILE = 'extension-config.json';

export type MemoryExtensionConfig = {
  enabled: boolean;
  autoInjectPromptMemory: boolean;
  autoRewriteHashMemory: boolean;
  autoCaptureToolEvents: boolean;
  autoSaveCheckpoints: boolean;
  autoDetectDurableMemory: boolean;
  autoSaveTrapLessons: boolean;
  showStatusIndicator: boolean;
  captureHookDebug: boolean;
};

export const DEFAULT_MEMORY_EXTENSION_CONFIG: MemoryExtensionConfig = {
  enabled: true,
  autoInjectPromptMemory: true,
  autoRewriteHashMemory: true,
  autoCaptureToolEvents: true,
  autoSaveCheckpoints: true,
  autoDetectDurableMemory: true,
  autoSaveTrapLessons: true,
  showStatusIndicator: true,
  captureHookDebug: true,
};

type HookDebugRecord = {
  timestamp: string;
  hook: string;
  payload: unknown;
  derived?: Record<string, unknown>;
};

function ensureMemoryDir(repoRoot: string): string {
  const dir = resolve(repoRoot, '.memory');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getActiveTaskFile(repoRoot: string): string {
  return resolve(repoRoot, '.memory', ACTIVE_TASK_FILE);
}

function getExtensionConfigFile(repoRoot: string): string {
  return resolve(repoRoot, '.memory', EXTENSION_CONFIG_FILE);
}

export function readMemoryExtensionConfig(args: { repoRoot: string }): MemoryExtensionConfig {
  const file = getExtensionConfigFile(args.repoRoot);
  if (!existsSync(file)) {
    return { ...DEFAULT_MEMORY_EXTENSION_CONFIG };
  }

  const parsed = safeJsonParse<Partial<MemoryExtensionConfig> | null>(readFileSync(file, 'utf8'), null);
  return {
    ...DEFAULT_MEMORY_EXTENSION_CONFIG,
    ...(parsed ?? {}),
  };
}

export function writeMemoryExtensionConfig(args: { repoRoot: string; config: MemoryExtensionConfig }): MemoryExtensionConfig {
  ensureMemoryDir(args.repoRoot);
  const normalized = {
    ...DEFAULT_MEMORY_EXTENSION_CONFIG,
    ...args.config,
  };
  writeFileSync(getExtensionConfigFile(args.repoRoot), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function updateMemoryExtensionConfig(args: { repoRoot: string; patch: Partial<MemoryExtensionConfig> }): MemoryExtensionConfig {
  const current = readMemoryExtensionConfig({ repoRoot: args.repoRoot });
  return writeMemoryExtensionConfig({
    repoRoot: args.repoRoot,
    config: {
      ...current,
      ...args.patch,
    },
  });
}

export function formatMemoryExtensionConfig(config: MemoryExtensionConfig): string {
  const entries: Array<[string, boolean, string]> = [
    ['enabled', config.enabled, 'Master switch for automatic memory behaviors'],
    ['autoInjectPromptMemory', config.autoInjectPromptMemory, 'Inject relevant memory into system prompt'],
    ['autoRewriteHashMemory', config.autoRewriteHashMemory, 'Rewrite prompts that contain #memory'],
    ['autoCaptureToolEvents', config.autoCaptureToolEvents, 'Capture write/bash/edit tool episodes automatically'],
    ['autoSaveCheckpoints', config.autoSaveCheckpoints, 'Save task checkpoints at end of assistant turns'],
    ['autoDetectDurableMemory', config.autoDetectDurableMemory, 'Detect durable rules/preferences from chat and ask to save'],
    ['autoSaveTrapLessons', config.autoSaveTrapLessons, 'Auto-save lessons after failure -> success resolution'],
    ['showStatusIndicator', config.showStatusIndicator, 'Show footer status for this extension'],
    ['captureHookDebug', config.captureHookDebug, 'Write hook payloads to .memory/pi-hook-debug.jsonl'],
  ];

  return [
    'Memory extension config',
    ...entries.map(([key, value, description]) => `- ${key}: ${value ? 'on' : 'off'}\n  ${description}`),
  ].join('\n');
}

export function detectRepoRoot(startDir?: string): string {
  let current = resolve(startDir ?? process.cwd());

  while (true) {
    if (existsSync(resolve(current, '.git')) || existsSync(resolve(current, '.pi')) || existsSync(resolve(current, 'package.json'))) {
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

export function readActiveTask(args: { repoRoot: string }): ActiveTaskRecord | null {
  const file = getActiveTaskFile(args.repoRoot);
  if (!existsSync(file)) {
    return null;
  }

  const parsed = safeJsonParse<ActiveTaskRecord | null>(readFileSync(file, 'utf8'), null);
  if (!parsed) {
    return null;
  }

  return {
    repoRoot: args.repoRoot,
    status: 'active',
    ...parsed,
  };
}

export function setActiveTask(args: {
  repoRoot: string;
  taskId: string;
  title: string;
  cwd?: string;
  branch?: string;
}): ActiveTaskRecord {
  const timestamp = nowIso();
  const previous = readActiveTask({ repoRoot: args.repoRoot });
  const next: ActiveTaskRecord = {
    taskId: args.taskId,
    title: args.title,
    status: 'active',
    repoRoot: args.repoRoot,
    cwd: args.cwd,
    branch: args.branch,
    startedAt: previous?.taskId === args.taskId ? previous.startedAt : timestamp,
    updatedAt: timestamp,
  };

  ensureMemoryDir(args.repoRoot);
  writeFileSync(getActiveTaskFile(args.repoRoot), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function completeActiveTask(args: { repoRoot: string; taskId?: string }): ActiveTaskRecord | null {
  const existing = readActiveTask({ repoRoot: args.repoRoot });
  if (!existing) {
    return null;
  }

  if (args.taskId && existing.taskId !== args.taskId) {
    return null;
  }

  const completed: ActiveTaskRecord = {
    ...existing,
    status: 'done',
    updatedAt: nowIso(),
  };

  ensureMemoryDir(args.repoRoot);
  writeFileSync(getActiveTaskFile(args.repoRoot), `${JSON.stringify(completed, null, 2)}\n`, 'utf8');
  return completed;
}

export function clearActiveTask(args: { repoRoot: string }): void {
  rmSync(getActiveTaskFile(args.repoRoot), { force: true });
}

export function createTaskId(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';

  return `${slug}-${Date.now().toString(36)}`;
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

  return facts.map((fact) => `- ${fact.id} [${fact.status}] ${fact.predicate}: ${fact.factText}`).join('\n');
}

export function formatCheckpoint(checkpoint: CheckpointRecord | null): string {
  if (!checkpoint) {
    return 'No active checkpoint.';
  }

  return [
    `Task: ${checkpoint.taskId}`,
    `Status: ${checkpoint.status}`,
    checkpoint.title ? `Title: ${checkpoint.title}` : null,
    `Summary: ${checkpoint.summary}`,
    checkpoint.nextStep ? `Next step: ${checkpoint.nextStep}` : null,
    checkpoint.blockers ? `Blockers: ${checkpoint.blockers}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatActiveTask(activeTask: ActiveTaskRecord | null): string {
  if (!activeTask) {
    return 'No active task.';
  }

  return [
    `Task ID: ${activeTask.taskId}`,
    `Title: ${activeTask.title}`,
    `Status: ${activeTask.status}`,
    activeTask.branch ? `Branch: ${activeTask.branch}` : null,
    activeTask.cwd ? `CWD: ${activeTask.cwd}` : null,
    `Started: ${activeTask.startedAt}`,
    `Updated: ${activeTask.updatedAt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function searchProjectMemory(args: {
  repoRoot: string;
  query: string;
  limit?: number;
  taskId?: string;
  cwd?: string;
  roleScope?: string;
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
    pathScope: getPathScope(args.repoRoot, args.cwd),
    taskId: args.taskId,
    roleScope: args.roleScope,
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

export async function seedRepoMemory(args: { repoRoot: string }): Promise<void> {
  const packageJsonPath = resolve(args.repoRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return;
  }

  const packageJson = safeJsonParse<Record<string, unknown>>(readFileSync(packageJsonPath, 'utf8'), {});
  const packageManager = typeof packageJson.packageManager === 'string'
    ? packageJson.packageManager.split('@')[0]
    : inferPackageManagerFromScripts(packageJson.scripts);

  if (!packageManager) {
    return;
  }

  await rememberMemoryNote({
    repoRoot: args.repoRoot,
    input: {
      projectId: toProjectId(args.repoRoot),
      scopeType: 'project',
      scopeId: toProjectId(args.repoRoot),
      sourceType: 'repo_scan',
      sourceName: 'package.json',
      actor: 'system',
      repoRoot: args.repoRoot,
      content: `Detected package manager ${packageManager}`,
      metadata: {
        kind: 'package_json',
        path: packageJsonPath,
        packageManager,
      },
    },
  });
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
        `- [checkpoint] ${checkpoint.summary}`,
        checkpoint.nextStep ? `- [next-step] ${checkpoint.nextStep}` : null,
        checkpoint.blockers ? `- [blockers] ${checkpoint.blockers}` : null,
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
  title?: string;
  status?: CheckpointRecord['status'];
  summary: string;
  nextStep?: string;
  blockers?: string;
  cwd?: string;
  filesTouched?: string[];
  commandsRun?: string[];
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
    status: args.status ?? (args.blockers ? 'blocked' : 'active'),
    title: args.title,
    summary: args.summary,
    nextStep: args.nextStep,
    blockers: args.blockers,
    filesTouched: [...new Set([...(args.filesTouched ?? []), ...(pathScope ? [pathScope] : [])])],
    commandsRun: args.commandsRun,
    sourceEpisodeId: args.sourceEpisodeId,
  };

  return backend.saveCheckpoint(args.repoRoot, checkpoint);
}

export function getActiveTask(repoRoot: string): ActiveTaskRecord | null {
  return readActiveTask({ repoRoot });
}

export async function loadActiveTaskCheckpoint(args: {
  repoRoot: string;
}): Promise<{ activeTask: ActiveTaskRecord | null; checkpoint: CheckpointRecord | null }> {
  const activeTask = readActiveTask({ repoRoot: args.repoRoot });
  if (!activeTask) {
    return { activeTask: null, checkpoint: null };
  }

  const { checkpoint } = await loadTaskCheckpoint({ repoRoot: args.repoRoot, taskId: activeTask.taskId });
  return { activeTask, checkpoint };
}

export async function markTaskDone(args: {
  repoRoot: string;
  taskId: string;
  title?: string;
  summary: string;
}): Promise<{ checkpointId: string } | null> {
  completeActiveTask({ repoRoot: args.repoRoot, taskId: args.taskId });
  const result = await saveTaskCheckpoint({
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    title: args.title,
    status: 'done',
    summary: args.summary,
  });
  clearActiveTask({ repoRoot: args.repoRoot });
  return result;
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
  const dir = ensureMemoryDir(args.repoRoot);
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

function inferPackageManagerFromScripts(scripts: unknown): string | undefined {
  if (!scripts || typeof scripts !== 'object') {
    return undefined;
  }

  const text = JSON.stringify(scripts);
  if (/pnpm/i.test(text)) {
    return 'pnpm';
  }
  if (/yarn/i.test(text)) {
    return 'yarn';
  }
  if (/npm/i.test(text)) {
    return 'npm';
  }
  return undefined;
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
