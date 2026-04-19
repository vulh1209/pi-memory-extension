export type ScopeType = 'global' | 'project' | 'path' | 'task' | 'role' | 'user';
export type FactStatus = 'active' | 'superseded' | 'invalid' | 'stale' | 'archived' | 'draft';
export type FactType = 'rule' | 'knowledge' | 'lesson' | 'checkpoint' | 'preference' | 'incident';
export type TrustLevel = 'low' | 'medium' | 'high' | 'human';

export interface ProjectInput {
  id: string;
  repoRoot: string;
  repoName?: string;
  defaultBranch?: string;
}

export interface EpisodeInput {
  projectId?: string;
  sessionId?: string;
  taskId?: string;
  scopeType: ScopeType;
  scopeId: string;
  sourceType: string;
  sourceName?: string;
  actor?: 'user' | 'agent' | 'system' | 'tool';
  repoRoot?: string;
  repoRev?: string;
  cwd?: string;
  content: string;
  metadata?: Record<string, unknown>;
  observedAt?: string;
}

export interface EpisodeRecord extends EpisodeInput {
  id: string;
  contentHash: string;
  recordedAt: string;
  createdAt: string;
}

export interface CandidateFact {
  projectId?: string;
  factType: FactType;
  scopeType: ScopeType;
  scopeId: string;
  pathScope?: string;
  roleScope?: string;
  taskId?: string;
  subjectEntity?: EntityRef;
  predicate: string;
  objectEntity?: EntityRef;
  objectValue?: string;
  factText: string;
  normalizedFact: string;
  factKey: string;
  confidence: number;
  trustLevel: TrustLevel;
  priority?: number;
  sourceType?: string;
  sourceRef?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  validFrom?: string;
  conflictPolicy?: 'auto' | 'coexist' | 'supersede';
}

export interface EntityRef {
  kind: string;
  canonicalName: string;
  normalizedKey: string;
  summary?: string;
  attributes?: Record<string, unknown>;
}

export interface FactRecord {
  id: string;
  projectId?: string;
  factType: FactType;
  scopeType: ScopeType;
  scopeId: string;
  pathScope?: string;
  roleScope?: string;
  taskId?: string;
  subjectEntityId?: string;
  predicate: string;
  objectEntityId?: string;
  objectValue?: string;
  factText: string;
  normalizedFact: string;
  factKey: string;
  confidence: number;
  trustLevel: TrustLevel;
  priority: number;
  status: FactStatus;
  validFrom?: string;
  validTo?: string;
  invalidatedAt?: string;
  supersededByFactId?: string;
  sourceEpisodeId: string;
  lastSeenEpisodeId?: string;
  sourceType?: string;
  sourceRef?: string;
  lastVerifiedAt?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointInput {
  projectId?: string;
  taskId: string;
  scopeType: ScopeType;
  scopeId: string;
  status: 'active' | 'blocked' | 'done' | 'stale';
  title?: string;
  summary: string;
  nextStep?: string;
  blockers?: string;
  filesTouched?: string[];
  commandsRun?: string[];
  openQuestions?: string[];
  relatedFactIds?: string[];
  sourceEpisodeId?: string;
  expiresAt?: string;
}

export interface CheckpointRecord extends CheckpointInput {
  id: string;
  updatedAt: string;
}

export interface ActiveTaskRecord {
  taskId: string;
  title: string;
  status: 'active' | 'blocked' | 'done';
  repoRoot: string;
  cwd?: string;
  branch?: string;
  startedAt: string;
  updatedAt: string;
}

export interface SearchMemoryInput {
  query: string;
  scopeType?: ScopeType;
  scopeId?: string;
  pathScope?: string;
  roleScope?: string;
  taskId?: string;
  factTypes?: FactType[];
  activeOnly?: boolean;
  asOf?: string;
  limit?: number;
}

export interface MemoryHit {
  factId: string;
  factText: string;
  factType: FactType;
  status: FactStatus;
  confidence: number;
  score: number;
  why: string[];
  sourceEpisodeId: string;
}

export interface IngestResult {
  episodeId: string;
  facts: Array<{
    factId: string;
    action: 'inserted' | 'merged' | 'superseded_previous' | 'coexisted';
  }>;
}

export interface RetrievalLogRecord {
  id: string;
  projectId?: string;
  queryText: string;
  scopeFilter: Record<string, unknown>;
  retrievedFactIds: string[];
  reasoning: Array<{ factId: string; why: string[]; score: number }>;
  createdAt: string;
}

export interface MemoryEmbedder {
  readonly modelName: string;
  readonly dimensions: number;
  embedText(input: string): Promise<number[]>;
}
