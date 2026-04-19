import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { extractCandidateFacts } from './extractors.ts';
import type {
  CandidateFact,
  CheckpointInput,
  CheckpointRecord,
  EntityRef,
  EpisodeInput,
  EpisodeRecord,
  FactRecord,
  IngestResult,
  MemoryEmbedder,
  MemoryHit,
  ProjectInput,
  SearchMemoryInput,
} from './types.ts';
import {
  genId,
  isFactValidAt,
  isSingleWinnerPredicate,
  canCoexistPredicate,
  normalizeText,
  nowIso,
  safeJsonParse,
  sha256,
  tokenize,
} from './utils.ts';

interface StoreOptions {
  dbPath: string;
  embedder?: MemoryEmbedder;
  schemaPath?: string | URL;
}

interface RawFactRow {
  id: string;
  project_id: string | null;
  fact_type: FactRecord['factType'];
  scope_type: FactRecord['scopeType'];
  scope_id: string;
  path_scope: string | null;
  role_scope: string | null;
  task_id: string | null;
  subject_entity_id: string | null;
  predicate: string;
  object_entity_id: string | null;
  object_value: string | null;
  fact_text: string;
  normalized_fact: string;
  fact_key: string;
  confidence: number;
  trust_level: FactRecord['trustLevel'];
  priority: number;
  status: FactRecord['status'];
  valid_from: string | null;
  valid_to: string | null;
  invalidated_at: string | null;
  superseded_by_fact_id: string | null;
  source_episode_id: string;
  last_seen_episode_id: string | null;
  source_type: string | null;
  source_ref: string | null;
  last_verified_at: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCheckpointRow {
  id: string;
  project_id: string | null;
  task_id: string;
  scope_type: CheckpointRecord['scopeType'];
  scope_id: string;
  status: CheckpointRecord['status'];
  title: string | null;
  summary: string;
  next_step: string | null;
  blockers: string | null;
  files_touched_json: string | null;
  commands_run_json: string | null;
  open_questions_json: string | null;
  related_fact_ids_json: string | null;
  source_episode_id: string | null;
  updated_at: string;
  expires_at: string | null;
}

export class GraphitiLiteMemoryStore {
  private readonly db: DatabaseSync;
  private readonly schemaPath: string | URL;
  private readonly _embedder?: MemoryEmbedder;

  constructor(options: StoreOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this._embedder = options.embedder;
    this.schemaPath = options.schemaPath ?? new URL('../../sql/001_graphiti_lite_memory.sql', import.meta.url);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  init(): void {
    const schema = readFileSync(this.schemaPath, 'utf8');
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }

  createProject(project: ProjectInput): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO projects (id, repo_root, repo_name, default_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          repo_root = excluded.repo_root,
          repo_name = excluded.repo_name,
          default_branch = excluded.default_branch,
          updated_at = excluded.updated_at
      `,
      )
      .run(project.id, project.repoRoot, project.repoName ?? null, project.defaultBranch ?? null, timestamp, timestamp);
  }

  rememberEpisode(input: EpisodeInput): EpisodeRecord {
    const episodeId = genId('ep');
    const timestamp = nowIso();
    const metadata = input.metadata ?? {};

    this.db
      .prepare(
        `
        INSERT INTO episodes (
          id, project_id, session_id, task_id,
          scope_type, scope_id,
          source_type, source_name, actor,
          repo_root, repo_rev, cwd,
          content, content_hash, metadata_json,
          ts_recorded, ts_observed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        episodeId,
        input.projectId ?? null,
        input.sessionId ?? null,
        input.taskId ?? null,
        input.scopeType,
        input.scopeId,
        input.sourceType,
        input.sourceName ?? null,
        input.actor ?? null,
        input.repoRoot ?? null,
        input.repoRev ?? null,
        input.cwd ?? null,
        input.content,
        sha256(input.content),
        JSON.stringify(metadata),
        timestamp,
        input.observedAt ?? null,
        timestamp,
      );

    return {
      id: episodeId,
      ...input,
      metadata,
      contentHash: sha256(input.content),
      recordedAt: timestamp,
      createdAt: timestamp,
    };
  }

  async ingestEpisode(input: EpisodeInput): Promise<IngestResult> {
    const episode = this.rememberEpisode(input);
    const candidates = extractCandidateFacts(episode);
    const facts: IngestResult['facts'] = [];

    for (const candidate of candidates) {
      facts.push(await this.upsertFact(candidate, episode.id));
    }

    return {
      episodeId: episode.id,
      facts,
    };
  }

  async upsertFact(
    candidate: CandidateFact,
    sourceEpisodeId: string,
  ): Promise<{ factId: string; action: 'inserted' | 'merged' | 'superseded_previous' | 'coexisted' }> {
    const timestamp = nowIso();

    const subjectEntityId = candidate.subjectEntity
      ? this.getOrCreateEntity(candidate.projectId, candidate.subjectEntity)
      : null;
    const objectEntityId = candidate.objectEntity
      ? this.getOrCreateEntity(candidate.projectId, candidate.objectEntity)
      : null;

    this.db.exec('BEGIN IMMEDIATE');

    try {
      const existingRows = this.db
        .prepare(
          `
          SELECT *
          FROM facts
          WHERE fact_key = ?
            AND status = 'active'
          ORDER BY updated_at DESC
        `,
        )
        .all(candidate.factKey) as RawFactRow[];

      for (const row of existingRows) {
        if (row.normalized_fact === candidate.normalizedFact) {
          this.db
            .prepare(
              `
              UPDATE facts
              SET confidence = CASE WHEN confidence < ? THEN ? ELSE confidence END,
                  last_seen_episode_id = ?,
                  updated_at = ?
              WHERE id = ?
            `,
            )
            .run(candidate.confidence, candidate.confidence, sourceEpisodeId, timestamp, row.id);

          this.db
            .prepare(
              `
              INSERT OR IGNORE INTO fact_provenance (fact_id, episode_id, role, created_at)
              VALUES (?, ?, 'observed_again', ?)
            `,
            )
            .run(row.id, sourceEpisodeId, timestamp);

          this.db.exec('COMMIT');
          return { factId: row.id, action: 'merged' };
        }
      }

      const shouldSupersede =
        candidate.conflictPolicy === 'supersede' ||
        (candidate.conflictPolicy !== 'coexist' &&
          isSingleWinnerPredicate(candidate.predicate) &&
          !canCoexistPredicate(candidate.predicate));

      const newFactId = genId('fact');

      if (shouldSupersede) {
        for (const row of existingRows) {
          this.db
            .prepare(
              `
              UPDATE facts
              SET status = 'superseded',
                  valid_to = COALESCE(valid_to, ?),
                  invalidated_at = ?,
                  updated_at = ?
              WHERE id = ?
            `,
            )
            .run(candidate.validFrom ?? timestamp, timestamp, timestamp, row.id);
        }
      }

      this.db
        .prepare(
          `
          INSERT INTO facts (
            id, project_id, fact_type, scope_type, scope_id,
            path_scope, role_scope, task_id,
            subject_entity_id, predicate, object_entity_id, object_value,
            fact_text, normalized_fact, fact_key,
            confidence, trust_level, priority, status,
            valid_from, valid_to, invalidated_at, superseded_by_fact_id,
            source_episode_id, last_seen_episode_id,
            source_type, source_ref, last_verified_at,
            tags_json, metadata_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          newFactId,
          candidate.projectId ?? null,
          candidate.factType,
          candidate.scopeType,
          candidate.scopeId,
          candidate.pathScope ?? null,
          candidate.roleScope ?? null,
          candidate.taskId ?? null,
          subjectEntityId,
          candidate.predicate,
          objectEntityId,
          candidate.objectValue ?? null,
          candidate.factText,
          candidate.normalizedFact,
          candidate.factKey,
          candidate.confidence,
          candidate.trustLevel,
          candidate.priority ?? 50,
          'active',
          candidate.validFrom ?? timestamp,
          null,
          null,
          null,
          sourceEpisodeId,
          sourceEpisodeId,
          candidate.sourceType ?? null,
          candidate.sourceRef ?? null,
          candidate.trustLevel === 'high' || candidate.trustLevel === 'human' ? timestamp : null,
          JSON.stringify(candidate.tags ?? []),
          JSON.stringify(candidate.metadata ?? {}),
          timestamp,
          timestamp,
        );

      this.db
        .prepare(
          `
          INSERT OR IGNORE INTO fact_provenance (fact_id, episode_id, role, created_at)
          VALUES (?, ?, 'asserted', ?)
        `,
        )
        .run(newFactId, sourceEpisodeId, timestamp);

      if (shouldSupersede) {
        for (const row of existingRows) {
          this.db.prepare(`UPDATE facts SET superseded_by_fact_id = ? WHERE id = ?`).run(newFactId, row.id);
          this.db
            .prepare(
              `
              INSERT OR IGNORE INTO fact_provenance (fact_id, episode_id, role, created_at)
              VALUES (?, ?, 'superseded_by', ?)
            `,
            )
            .run(row.id, sourceEpisodeId, timestamp);
        }
      }

      this.db.exec('COMMIT');

      return {
        factId: newFactId,
        action:
          shouldSupersede && existingRows.length > 0
            ? 'superseded_previous'
            : existingRows.length > 0
              ? 'coexisted'
              : 'inserted',
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  saveCheckpoint(input: CheckpointInput): { checkpointId: string } {
    const timestamp = nowIso();
    const existing = this.db
      .prepare(
        `
        SELECT id
        FROM checkpoints
        WHERE task_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      )
      .get(input.taskId) as { id: string } | undefined;

    const checkpointId = existing?.id ?? genId('ckpt');

    this.db
      .prepare(
        `
        INSERT INTO checkpoints (
          id, project_id, task_id, scope_type, scope_id,
          status, title, summary, next_step, blockers,
          files_touched_json, commands_run_json, open_questions_json, related_fact_ids_json,
          source_episode_id, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          task_id = excluded.task_id,
          scope_type = excluded.scope_type,
          scope_id = excluded.scope_id,
          status = excluded.status,
          title = excluded.title,
          summary = excluded.summary,
          next_step = excluded.next_step,
          blockers = excluded.blockers,
          files_touched_json = excluded.files_touched_json,
          commands_run_json = excluded.commands_run_json,
          open_questions_json = excluded.open_questions_json,
          related_fact_ids_json = excluded.related_fact_ids_json,
          source_episode_id = excluded.source_episode_id,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
      `,
      )
      .run(
        checkpointId,
        input.projectId ?? null,
        input.taskId,
        input.scopeType,
        input.scopeId,
        input.status,
        input.title ?? null,
        input.summary,
        input.nextStep ?? null,
        input.blockers ?? null,
        JSON.stringify(input.filesTouched ?? []),
        JSON.stringify(input.commandsRun ?? []),
        JSON.stringify(input.openQuestions ?? []),
        JSON.stringify(input.relatedFactIds ?? []),
        input.sourceEpisodeId ?? null,
        timestamp,
        input.expiresAt ?? null,
      );

    return { checkpointId };
  }

  loadCheckpoint(taskId: string): CheckpointRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM checkpoints
        WHERE task_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      )
      .get(taskId) as RawCheckpointRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      taskId: row.task_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      status: row.status,
      title: row.title ?? undefined,
      summary: row.summary,
      nextStep: row.next_step ?? undefined,
      blockers: row.blockers ?? undefined,
      filesTouched: safeJsonParse<string[]>(row.files_touched_json, []),
      commandsRun: safeJsonParse<string[]>(row.commands_run_json, []),
      openQuestions: safeJsonParse<string[]>(row.open_questions_json, []),
      relatedFactIds: safeJsonParse<string[]>(row.related_fact_ids_json, []),
      sourceEpisodeId: row.source_episode_id ?? undefined,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  getActiveFacts(params: {
    scopeType: SearchMemoryInput['scopeType'];
    scopeId: string;
    predicates?: string[];
    tags?: string[];
  }): FactRecord[] {
    const conditions = ['scope_type = ?', 'scope_id = ?', "status = 'active'"];
    const values: Array<string> = [params.scopeType ?? 'project', params.scopeId];

    if (params.predicates && params.predicates.length > 0) {
      conditions.push(`predicate IN (${params.predicates.map(() => '?').join(', ')})`);
      values.push(...params.predicates);
    }

    const rows = this.db
      .prepare(`SELECT * FROM facts WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`)
      .all(...values) as RawFactRow[];

    const facts = rows.map((row) => this.mapFactRow(row));

    if (!params.tags || params.tags.length === 0) {
      return facts;
    }

    return facts.filter((fact) => params.tags?.some((tag) => fact.tags.includes(tag)));
  }

  invalidateFact(factId: string, reason: string, sourceEpisodeId?: string): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `
        UPDATE facts
        SET status = 'invalid',
            invalidated_at = ?,
            valid_to = COALESCE(valid_to, ?),
            updated_at = ?,
            metadata_json = json_patch(COALESCE(metadata_json, '{}'), ?)
        WHERE id = ?
      `,
      )
      .run(timestamp, timestamp, timestamp, JSON.stringify({ invalidation_reason: reason }), factId);

    if (sourceEpisodeId) {
      this.db
        .prepare(
          `
          INSERT OR IGNORE INTO fact_provenance (fact_id, episode_id, role, created_at)
          VALUES (?, ?, 'corrected', ?)
        `,
        )
        .run(factId, sourceEpisodeId, timestamp);
    }
  }

  getFactById(factId: string): FactRecord | null {
    const row = this.db.prepare('SELECT * FROM facts WHERE id = ? LIMIT 1').get(factId) as RawFactRow | undefined;
    return row ? this.mapFactRow(row) : null;
  }

  forgetFact(factId: string, reason = 'Forgotten by user'): FactRecord | null {
    const timestamp = nowIso();
    this.db
      .prepare(
        `
        UPDATE facts
        SET status = 'archived',
            invalidated_at = COALESCE(invalidated_at, ?),
            valid_to = COALESCE(valid_to, ?),
            updated_at = ?,
            metadata_json = json_patch(COALESCE(metadata_json, '{}'), ?)
        WHERE id = ?
      `,
      )
      .run(timestamp, timestamp, timestamp, JSON.stringify({ archived_reason: reason }), factId);

    return this.getFactById(factId);
  }

  async searchMemory(input: SearchMemoryInput): Promise<MemoryHit[]> {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM facts f
        WHERE 1 = 1 ${this.buildFactFilterClause(input).clause}
        ORDER BY f.updated_at DESC
        LIMIT ?
      `,
      )
      .all(...this.buildFactFilterClause(input).values, Math.max((input.limit ?? 10) * 20, 50)) as RawFactRow[];

    const candidates = rows
      .map((row) => this.mapFactRow(row))
      .filter((fact) => this.matchesTemporalFilter(fact, input))
      .map((fact) => this.scoreFact(fact, input))
      .filter((hit): hit is MemoryHit => hit !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 10);

    this.logRetrieval(input, candidates);
    return candidates;
  }

  listFacts(): FactRecord[] {
    const rows = this.db.prepare('SELECT * FROM facts ORDER BY updated_at DESC').all() as RawFactRow[];
    return rows.map((row) => this.mapFactRow(row));
  }

  private scoreFact(fact: FactRecord, input: SearchMemoryInput): MemoryHit | null {
    const queryTokens = tokenize(input.query);
    const factTokens = new Set([
      ...tokenize(fact.factText),
      ...tokenize(fact.predicate),
      ...tokenize(fact.objectValue ?? ''),
      ...fact.tags.flatMap((tag) => tokenize(tag)),
      ...tokenize(fact.pathScope ?? ''),
      ...tokenize(fact.roleScope ?? ''),
      ...tokenize(fact.sourceRef ?? ''),
    ]);

    let exactMatches = 0;
    const why: string[] = [];

    for (const token of queryTokens) {
      if (factTokens.has(token)) {
        exactMatches += 1;
      }
    }

    const normalizedQuery = normalizeText(input.query);
    if (normalizedQuery.length > 2 && fact.normalizedFact.includes(normalizedQuery)) {
      exactMatches += 2;
      why.push('substring-match');
    }

    if (queryTokens.length > 0 && exactMatches === 0) {
      return null;
    }

    let score = exactMatches * 2;
    if (exactMatches > 0) {
      why.push(`exact-token-matches:${exactMatches}`);
    }

    if (input.taskId && fact.taskId === input.taskId) {
      score += 5;
      why.push(`task:${input.taskId}`);
    }

    if (input.pathScope && fact.pathScope === input.pathScope) {
      score += 4;
      why.push(`path:${input.pathScope}`);
    }

    if (input.roleScope && fact.roleScope === input.roleScope) {
      score += 2;
      why.push(`role:${input.roleScope}`);
    }

    if (input.scopeType && input.scopeId && fact.scopeType === input.scopeType && fact.scopeId === input.scopeId) {
      score += 2;
      why.push(`scope:${input.scopeType}:${input.scopeId}`);
    }

    if (fact.status === 'active') {
      score += 1;
      why.push('status:active');
    }

    score += Math.min(fact.confidence * 2, 2);
    why.push(`confidence:${fact.confidence.toFixed(2)}`);

    const ageDays = Math.max(0, (Date.now() - Date.parse(fact.updatedAt)) / 86_400_000);
    const recencyBonus = Math.max(0, 1 - Math.min(ageDays, 30) / 30);
    score += recencyBonus;
    if (recencyBonus > 0) {
      why.push(`recency:${recencyBonus.toFixed(2)}`);
    }

    return {
      factId: fact.id,
      factText: fact.factText,
      factType: fact.factType,
      status: fact.status,
      confidence: fact.confidence,
      score,
      why,
      sourceEpisodeId: fact.sourceEpisodeId,
    };
  }

  private logRetrieval(input: SearchMemoryInput, hits: MemoryHit[]): void {
    this.db
      .prepare(
        `
        INSERT INTO retrieval_logs (
          id, project_id, query_text, scope_filter_json,
          retrieved_fact_ids_json, reasoning_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        genId('retrieval'),
        input.scopeType === 'project' ? (input.scopeId ?? null) : null,
        input.query,
        JSON.stringify({
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          pathScope: input.pathScope,
          roleScope: input.roleScope,
          taskId: input.taskId,
          factTypes: input.factTypes,
          activeOnly: input.activeOnly,
          asOf: input.asOf,
        }),
        JSON.stringify(hits.map((hit) => hit.factId)),
        JSON.stringify(hits.map((hit) => ({ factId: hit.factId, why: hit.why, score: hit.score }))),
        nowIso(),
      );
  }

  private buildFactFilterClause(input: SearchMemoryInput): { clause: string; values: Array<string> } {
    const conditions: string[] = [];
    const values: string[] = [];

    if (input.activeOnly !== false && !input.asOf) {
      conditions.push(`f.status = 'active'`);
    }

    if (input.scopeType && input.scopeId) {
      conditions.push('f.scope_type = ?');
      values.push(input.scopeType);
      conditions.push('f.scope_id = ?');
      values.push(input.scopeId);
    }

    if (input.pathScope) {
      conditions.push('(f.path_scope = ? OR f.path_scope IS NULL)');
      values.push(input.pathScope);
    }

    if (input.roleScope) {
      conditions.push('(f.role_scope = ? OR f.role_scope IS NULL)');
      values.push(input.roleScope);
    }

    if (input.taskId) {
      conditions.push('(f.task_id = ? OR f.task_id IS NULL)');
      values.push(input.taskId);
    }

    if (input.factTypes && input.factTypes.length > 0) {
      conditions.push(`f.fact_type IN (${input.factTypes.map(() => '?').join(', ')})`);
      values.push(...input.factTypes);
    }

    return {
      clause: conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`,
      values,
    };
  }

  private matchesTemporalFilter(fact: FactRecord, input: SearchMemoryInput): boolean {
    if (input.asOf) {
      return isFactValidAt(fact, input.asOf);
    }

    if (input.activeOnly === false) {
      return true;
    }

    return fact.status === 'active';
  }

  private getOrCreateEntity(projectId: string | undefined, entity: EntityRef): string {
    const existing = this.db
      .prepare('SELECT id FROM entities WHERE normalized_key = ? LIMIT 1')
      .get(entity.normalizedKey) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `
          UPDATE entities
          SET canonical_name = ?,
              summary = COALESCE(?, summary),
              attributes_json = COALESCE(?, attributes_json),
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          entity.canonicalName,
          entity.summary ?? null,
          entity.attributes ? JSON.stringify(entity.attributes) : null,
          nowIso(),
          existing.id,
        );
      return existing.id;
    }

    const entityId = genId('ent');
    this.db
      .prepare(
        `
        INSERT INTO entities (
          id, project_id, kind, canonical_name, normalized_key,
          summary, attributes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        entityId,
        projectId ?? null,
        entity.kind,
        entity.canonicalName,
        normalizeText(entity.normalizedKey),
        entity.summary ?? null,
        entity.attributes ? JSON.stringify(entity.attributes) : null,
        nowIso(),
        nowIso(),
      );

    return entityId;
  }

  private mapFactRow(row: RawFactRow): FactRecord {
    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      factType: row.fact_type,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      pathScope: row.path_scope ?? undefined,
      roleScope: row.role_scope ?? undefined,
      taskId: row.task_id ?? undefined,
      subjectEntityId: row.subject_entity_id ?? undefined,
      predicate: row.predicate,
      objectEntityId: row.object_entity_id ?? undefined,
      objectValue: row.object_value ?? undefined,
      factText: row.fact_text,
      normalizedFact: row.normalized_fact,
      factKey: row.fact_key,
      confidence: row.confidence,
      trustLevel: row.trust_level,
      priority: row.priority,
      status: row.status,
      validFrom: row.valid_from ?? undefined,
      validTo: row.valid_to ?? undefined,
      invalidatedAt: row.invalidated_at ?? undefined,
      supersededByFactId: row.superseded_by_fact_id ?? undefined,
      sourceEpisodeId: row.source_episode_id,
      lastSeenEpisodeId: row.last_seen_episode_id ?? undefined,
      sourceType: row.source_type ?? undefined,
      sourceRef: row.source_ref ?? undefined,
      lastVerifiedAt: row.last_verified_at ?? undefined,
      tags: safeJsonParse<string[]>(row.tags_json, []),
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
