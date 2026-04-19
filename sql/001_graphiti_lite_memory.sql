PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  repo_root TEXT NOT NULL UNIQUE,
  repo_name TEXT,
  default_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  task_id TEXT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  actor TEXT,
  repo_root TEXT,
  repo_rev TEXT,
  cwd TEXT,
  content TEXT NOT NULL,
  content_hash TEXT,
  metadata_json TEXT,
  ts_recorded TEXT NOT NULL,
  ts_observed TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task_id);
CREATE INDEX IF NOT EXISTS idx_episodes_scope ON episodes(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_episodes_source_type ON episodes(source_type);
CREATE INDEX IF NOT EXISTS idx_episodes_ts_recorded ON episodes(ts_recorded DESC);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  summary TEXT,
  attributes_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  fact_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  path_scope TEXT,
  role_scope TEXT,
  task_id TEXT,
  subject_entity_id TEXT,
  predicate TEXT NOT NULL,
  object_entity_id TEXT,
  object_value TEXT,
  fact_text TEXT NOT NULL,
  normalized_fact TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.70,
  trust_level TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  invalidated_at TEXT,
  superseded_by_fact_id TEXT,
  source_episode_id TEXT NOT NULL,
  last_seen_episode_id TEXT,
  source_type TEXT,
  source_ref TEXT,
  last_verified_at TEXT,
  tags_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(subject_entity_id) REFERENCES entities(id),
  FOREIGN KEY(object_entity_id) REFERENCES entities(id),
  FOREIGN KEY(source_episode_id) REFERENCES episodes(id),
  FOREIGN KEY(last_seen_episode_id) REFERENCES episodes(id),
  FOREIGN KEY(superseded_by_fact_id) REFERENCES facts(id)
);

CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id);
CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_facts_task ON facts(task_id);
CREATE INDEX IF NOT EXISTS idx_facts_path_scope ON facts(path_scope);
CREATE INDEX IF NOT EXISTS idx_facts_role_scope ON facts(role_scope);
CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
CREATE INDEX IF NOT EXISTS idx_facts_fact_key ON facts(fact_key);
CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
CREATE INDEX IF NOT EXISTS idx_facts_active_lookup ON facts(fact_key, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_facts_validity ON facts(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_facts_last_verified ON facts(last_verified_at DESC);

CREATE TABLE IF NOT EXISTS fact_provenance (
  fact_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (fact_id, episode_id, role),
  FOREIGN KEY(fact_id) REFERENCES facts(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fact_prov_episode ON fact_provenance(episode_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  summary TEXT NOT NULL,
  next_step TEXT,
  blockers TEXT,
  files_touched_json TEXT,
  commands_run_json TEXT,
  open_questions_json TEXT,
  related_fact_ids_json TEXT,
  source_episode_id TEXT,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(source_episode_id) REFERENCES episodes(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_scope ON checkpoints(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints(status);

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  source_entity_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  source_episode_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(source_entity_id) REFERENCES entities(id),
  FOREIGN KEY(target_entity_id) REFERENCES entities(id),
  FOREIGN KEY(source_episode_id) REFERENCES episodes(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_links_src ON entity_links(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_tgt ON entity_links(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_rel ON entity_links(relation);

CREATE TABLE IF NOT EXISTS retrieval_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  query_text TEXT NOT NULL,
  scope_filter_json TEXT,
  retrieved_fact_ids_json TEXT,
  reasoning_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS fact_embeddings (
  fact_id TEXT PRIMARY KEY,
  embedding_json TEXT,
  embedding_model TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(fact_id) REFERENCES facts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_id TEXT PRIMARY KEY,
  embedding_json TEXT,
  embedding_model TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
