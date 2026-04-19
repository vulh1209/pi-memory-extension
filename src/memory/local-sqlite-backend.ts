import { existsSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { HashingEmbedder } from './hashing-embedder.ts';
import type { ActiveFactsInput, MemoryBackend } from './backend-types.ts';
import { availableStatus } from './diagnostics.ts';
import type {
  CheckpointInput,
  CheckpointRecord,
  EpisodeInput,
  FactRecord,
  IngestResult,
  MemoryHit,
  SearchMemoryInput,
} from './types.ts';

const storeCache = new Map<string, Promise<StoreLike>>();

type StoreLike = {
  init(): void;
  createProject(input: { id: string; repoRoot: string; repoName?: string }): void;
  searchMemory(input: SearchMemoryInput): Promise<MemoryHit[]>;
  ingestEpisode(input: EpisodeInput): Promise<IngestResult>;
  saveCheckpoint(input: CheckpointInput): { checkpointId: string };
  loadCheckpoint(taskId: string): CheckpointRecord | null;
  getActiveFacts(input: ActiveFactsInput): FactRecord[];
  forgetFact(factId: string, reason?: string): FactRecord | null;
  getFactById(factId: string): FactRecord | null;
  close(): void;
};

function toProjectId(repoRoot: string): string {
  return `repo:${repoRoot}`;
}

async function getStore(repoRoot: string): Promise<StoreLike> {
  const normalizedRoot = resolve(repoRoot);
  const existing = storeCache.get(normalizedRoot);
  if (existing) {
    return existing;
  }

  const created = (async () => {
    const { GraphitiLiteMemoryStore } = await import('./store.ts');
    const dbPath = resolve(normalizedRoot, '.memory/pi-memory.sqlite');

    const createStore = () => {
      const store = new GraphitiLiteMemoryStore({
        dbPath,
        embedder: new HashingEmbedder({ dimensions: 128, modelName: 'pi-local-hashing-embedder-v1' }),
      });
      store.init();
      store.createProject({
        id: toProjectId(normalizedRoot),
        repoRoot: normalizedRoot,
        repoName: normalizedRoot.split(/[\\/]+/).filter(Boolean).at(-1),
      });
      return store as StoreLike;
    };

    try {
      return createStore();
    } catch (error) {
      if (!isLegacyFts5Error(error) || !existsSync(dbPath)) {
        throw error;
      }

      backupLegacyDatabase(dbPath);
      return createStore();
    }
  })();

  storeCache.set(normalizedRoot, created);
  return created;
}

export class LocalSqliteMemoryBackend implements MemoryBackend {
  async initRepo(repoRoot: string): Promise<void> {
    await getStore(repoRoot);
  }

  async getStatus(repoRoot: string) {
    await getStore(repoRoot);
    return availableStatus('memory ready (shared db)', 'local', 'shared');
  }

  async searchMemory(repoRoot: string, input: SearchMemoryInput): Promise<MemoryHit[]> {
    return (await getStore(repoRoot)).searchMemory(input);
  }

  async ingestEpisode(repoRoot: string, input: EpisodeInput): Promise<IngestResult> {
    return (await getStore(repoRoot)).ingestEpisode(input);
  }

  async saveCheckpoint(repoRoot: string, input: CheckpointInput): Promise<{ checkpointId: string }> {
    return (await getStore(repoRoot)).saveCheckpoint(input);
  }

  async loadCheckpoint(repoRoot: string, taskId: string): Promise<CheckpointRecord | null> {
    return (await getStore(repoRoot)).loadCheckpoint(taskId);
  }

  async getActiveFacts(repoRoot: string, input: ActiveFactsInput): Promise<FactRecord[]> {
    return (await getStore(repoRoot)).getActiveFacts(input);
  }

  async forgetFact(repoRoot: string, factId: string, reason?: string): Promise<FactRecord | null> {
    return (await getStore(repoRoot)).forgetFact(factId, reason);
  }

  async getFactById(repoRoot: string, factId: string): Promise<FactRecord | null> {
    return (await getStore(repoRoot)).getFactById(factId);
  }

  async dispose(): Promise<void> {
    const entries = [...storeCache.entries()];
    storeCache.clear();
    for (const [, storePromise] of entries) {
      const store = await storePromise;
      store.close();
    }
  }
}

export async function createLocalSqliteBackend(): Promise<MemoryBackend> {
  return new LocalSqliteMemoryBackend();
}

function isLegacyFts5Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fts5/i.test(message);
}

function backupLegacyDatabase(dbPath: string): void {
  const timestamp = Date.now().toString(36);
  const backupPath = `${dbPath}.legacy-fts5-${timestamp}.bak`;
  renameSync(dbPath, backupPath);

  for (const suffix of ['-shm', '-wal']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
