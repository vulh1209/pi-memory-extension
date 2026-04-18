import type { ActiveFactsInput, MemoryBackend } from './backend-types.ts';
import { unavailableStatus } from './diagnostics.ts';
import { detectMemoryRuntime, resolveHelperPath } from './runtime-detection.ts';
import type {
  CheckpointInput,
  CheckpointRecord,
  EpisodeInput,
  FactRecord,
  IngestResult,
  MemoryHit,
  SearchMemoryInput,
} from './types.ts';

class UnavailableMemoryBackend implements MemoryBackend {
  private readonly summary: string;
  private readonly details?: Record<string, unknown>;

  constructor(summary: string, details?: Record<string, unknown>) {
    this.summary = summary;
    this.details = details;
  }

  async initRepo(): Promise<void> {}

  async getStatus() {
    return unavailableStatus(this.summary, this.details);
  }

  async searchMemory(): Promise<MemoryHit[]> {
    return [];
  }

  async ingestEpisode(_repoRoot: string, input: EpisodeInput): Promise<IngestResult> {
    return { episodeId: `unavailable:${input.sourceType}`, facts: [] };
  }

  async saveCheckpoint(_repoRoot: string, input: CheckpointInput): Promise<{ checkpointId: string }> {
    return { checkpointId: `unavailable:${input.taskId}` };
  }

  async loadCheckpoint(): Promise<CheckpointRecord | null> {
    return null;
  }

  async getActiveFacts(): Promise<FactRecord[]> {
    return [];
  }

  async forgetFact(): Promise<FactRecord | null> {
    return null;
  }

  async getFactById(): Promise<FactRecord | null> {
    return null;
  }
}

export function createUnavailableMemoryBackend(summary: string, details?: Record<string, unknown>): MemoryBackend {
  return new UnavailableMemoryBackend(summary, details);
}

export async function createMemoryBackend(): Promise<MemoryBackend> {
  const runtime = detectMemoryRuntime();
  if (runtime.kind === 'local') {
    const { createLocalSqliteBackend } = await import('./local-sqlite-backend.ts');
    return createLocalSqliteBackend();
  }

  const helperPath = resolveHelperPath(runtime);
  if (!helperPath) {
    return createUnavailableMemoryBackend('desktop memory helper unavailable', { runtime: 'desktop' });
  }

  try {
    const { createRpcMemoryBackend } = await import('./rpc-memory-backend.ts');
    return createRpcMemoryBackend({ command: helperPath, args: runtime.helperArgs });
  } catch (error) {
    return createUnavailableMemoryBackend('desktop memory helper unavailable', {
      runtime: 'desktop',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
