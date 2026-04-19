import type { ActiveFactsInput, MemoryBackend } from './backend-types.ts';
import { createHelperClient } from './helper-client.ts';
import type { MemoryBackendStatus } from './diagnostics.ts';
import type {
  CheckpointInput,
  CheckpointRecord,
  EpisodeInput,
  FactRecord,
  IngestResult,
  MemoryHit,
  SearchMemoryInput,
} from './types.ts';

export class RpcMemoryBackend implements MemoryBackend {
  private readonly client: ReturnType<typeof createHelperClient>;

  constructor(options: { command: string; args?: string[]; env?: NodeJS.ProcessEnv }) {
    this.client = createHelperClient(options);
  }

  async initRepo(repoRoot: string): Promise<void> {
    await this.getStatus(repoRoot);
  }

  async hello(): Promise<void> {
    await this.client.call('helper.hello', {});
  }

  async getStatus(repoRoot: string): Promise<MemoryBackendStatus> {
    return (await this.client.call('memory.status', { repoRoot })) as MemoryBackendStatus;
  }

  async searchMemory(repoRoot: string, input: SearchMemoryInput): Promise<MemoryHit[]> {
    return (await this.client.call('memory.search', { repoRoot, input })) as MemoryHit[];
  }

  async ingestEpisode(repoRoot: string, input: EpisodeInput): Promise<IngestResult> {
    return (await this.client.call('memory.ingestEpisode', { repoRoot, input })) as IngestResult;
  }

  async saveCheckpoint(repoRoot: string, input: CheckpointInput): Promise<{ checkpointId: string }> {
    return (await this.client.call('memory.saveCheckpoint', { repoRoot, input })) as { checkpointId: string };
  }

  async loadCheckpoint(repoRoot: string, taskId: string): Promise<CheckpointRecord | null> {
    return (await this.client.call('memory.loadCheckpoint', { repoRoot, taskId })) as CheckpointRecord | null;
  }

  async getActiveFacts(repoRoot: string, input: ActiveFactsInput): Promise<FactRecord[]> {
    return (await this.client.call('memory.getActiveFacts', { repoRoot, input })) as FactRecord[];
  }

  async forgetFact(repoRoot: string, factId: string, reason?: string): Promise<FactRecord | null> {
    return (await this.client.call('memory.forgetFact', { repoRoot, factId, reason })) as FactRecord | null;
  }

  async getFactById(repoRoot: string, factId: string): Promise<FactRecord | null> {
    return (await this.client.call('memory.getFactById', { repoRoot, factId })) as FactRecord | null;
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }
}

export async function createRpcMemoryBackend(options: { command: string; args?: string[]; env?: NodeJS.ProcessEnv }): Promise<MemoryBackend> {
  const backend = new RpcMemoryBackend(options);

  try {
    await backend.hello();
    return backend;
  } catch (error) {
    await backend.dispose();
    throw error;
  }
}
