import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HashingEmbedder } from '../../src/memory/hashing-embedder.ts';
import {
  buildPromptMemory,
  clearActiveTask,
  clearMemoryBackendCache,
  createTaskId,
  readActiveTask,
  rememberMemoryNote,
  saveTaskCheckpoint,
  searchProjectMemory,
  setActiveTask,
  toProjectId,
} from '../../src/memory/pi-extension.ts';
import { GraphitiLiteMemoryStore } from '../../src/memory/store.ts';

test('graphiti-lite store initializes and retrieves exact matches without FTS5', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-store-'));
  const dbPath = join(repoRoot, '.memory', 'memory.sqlite');
  mkdirSync(join(repoRoot, '.memory'), { recursive: true });

  const store = new GraphitiLiteMemoryStore({
    dbPath,
    embedder: new HashingEmbedder({ dimensions: 32, modelName: 'test-hash' }),
  });
  store.init();
  store.createProject({ id: toProjectId(repoRoot), repoRoot, repoName: 'memory-store-test' });

  await store.ingestEpisode({
    projectId: toProjectId(repoRoot),
    scopeType: 'project',
    scopeId: toProjectId(repoRoot),
    sourceType: 'user_message',
    actor: 'user',
    content: 'Always use pnpm test',
  });

  const hits = await store.searchMemory({
    query: 'pnpm test',
    scopeType: 'project',
    scopeId: toProjectId(repoRoot),
    limit: 5,
  });

  assert.ok(hits.length > 0);
  assert.match(hits[0]!.factText, /pnpm test/i);
  store.close();
});

test('active task helpers and prompt memory include checkpoints', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-task-'));
  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'pi-memory-task', packageManager: 'pnpm@10.0.0' }, null, 2),
  );

  const taskId = createTaskId('Fix auth redirect');
  const activeTask = setActiveTask({ repoRoot, taskId, title: 'Fix auth redirect', cwd: repoRoot });
  assert.equal(readActiveTask({ repoRoot })?.taskId, taskId);
  assert.equal(activeTask.status, 'active');

  await rememberMemoryNote({
    repoRoot,
    input: {
      projectId: toProjectId(repoRoot),
      taskId,
      scopeType: 'project',
      scopeId: toProjectId(repoRoot),
      sourceType: 'user_message',
      actor: 'user',
      repoRoot,
      cwd: repoRoot,
      content: 'Always use pnpm test',
    },
  });

  await saveTaskCheckpoint({
    repoRoot,
    taskId,
    title: 'Fix auth redirect',
    summary: 'Identified redirect normalization bug in auth middleware.',
    nextStep: 'Patch middleware and rerun auth tests.',
    cwd: repoRoot,
    filesTouched: ['src/auth/middleware.ts'],
    commandsRun: ['pnpm test auth'],
  });

  const promptMemory = await buildPromptMemory({
    repoRoot,
    query: 'auth redirect pnpm',
    cwd: repoRoot,
    taskId,
  });

  assert.match(promptMemory.promptBlock, /pnpm/i);
  assert.match(promptMemory.promptBlock, /redirect normalization bug|Patch middleware/i);

  const search = await searchProjectMemory({
    repoRoot,
    query: 'pnpm auth',
    cwd: repoRoot,
    taskId,
    limit: 5,
  });

  assert.ok(search.hits.length > 0);
  clearActiveTask({ repoRoot });
  await clearMemoryBackendCache();
});
