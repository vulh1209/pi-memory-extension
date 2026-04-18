import type {
  CheckpointInput,
  CheckpointRecord,
  EpisodeInput,
  FactRecord,
  IngestResult,
  MemoryHit,
  SearchMemoryInput,
  ScopeType,
} from './types.ts';
import type { MemoryBackendStatus } from './diagnostics.ts';

export interface ActiveFactsInput {
  scopeType: ScopeType;
  scopeId: string;
}

export interface MemoryBackend {
  initRepo(repoRoot: string): Promise<void>;
  getStatus(repoRoot: string): Promise<MemoryBackendStatus>;
  searchMemory(repoRoot: string, input: SearchMemoryInput): Promise<MemoryHit[]>;
  ingestEpisode(repoRoot: string, input: EpisodeInput): Promise<IngestResult>;
  saveCheckpoint(repoRoot: string, input: CheckpointInput): Promise<{ checkpointId: string }>;
  loadCheckpoint(repoRoot: string, taskId: string): Promise<CheckpointRecord | null>;
  getActiveFacts(repoRoot: string, input: ActiveFactsInput): Promise<FactRecord[]>;
  forgetFact(repoRoot: string, factId: string, reason?: string): Promise<FactRecord | null>;
  getFactById(repoRoot: string, factId: string): Promise<FactRecord | null>;
  dispose?(): Promise<void>;
}
