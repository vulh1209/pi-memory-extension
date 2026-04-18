import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { HashingEmbedder } from './hashing-embedder.ts';
import { GraphitiLiteMemoryStore } from './store.ts';
import type { EpisodeInput } from './types.ts';

async function main() {
  const dbPath = resolve(process.cwd(), '.memory/graphiti-lite-demo.sqlite');
  rmSync(dbPath, { force: true });

  const store = new GraphitiLiteMemoryStore({
    dbPath,
    embedder: new HashingEmbedder({ dimensions: 128 }),
  });

  store.init();
  store.createProject({
    id: 'repo:pi-memory-extension',
    repoRoot: process.cwd(),
    repoName: 'pi-memory-extension',
    defaultBranch: 'main',
  });

  const episodes: EpisodeInput[] = [
    {
      projectId: 'repo:pi-memory-extension',
      scopeType: 'project',
      scopeId: 'repo:pi-memory-extension',
      sourceType: 'repo_scan',
      sourceName: 'package-json-scanner',
      actor: 'system',
      content: 'Detected package manager from package.json',
      metadata: {
        kind: 'package_json',
        path: 'package.json',
        packageManager: 'npm',
      },
    },
    {
      projectId: 'repo:pi-memory-extension',
      scopeType: 'project',
      scopeId: 'repo:pi-memory-extension',
      sourceType: 'tool_run',
      sourceName: 'shell',
      actor: 'tool',
      content: 'Spreadsheet grounding worked through vesper_execute wrapper.',
      metadata: {
        success: true,
        command: 'vesper_execute -> vesper.spreadsheet_read(...)',
      },
    },
    {
      projectId: 'repo:pi-memory-extension',
      scopeType: 'project',
      scopeId: 'repo:pi-memory-extension',
      sourceType: 'user_message',
      sourceName: 'chat',
      actor: 'user',
      content:
        'Always use spreadsheet_read via vesper_execute before falling back to shell parsing for spreadsheet-grounded facts.',
    },
    {
      projectId: 'repo:pi-memory-extension',
      scopeType: 'project',
      scopeId: 'repo:pi-memory-extension',
      sourceType: 'repo_scan',
      sourceName: 'architecture-scan',
      actor: 'system',
      content: 'Memory backend recommendation updated.',
      metadata: {
        kind: 'package_json',
        path: 'package.json',
        packageManager: 'pnpm',
      },
    },
  ];

  for (const episode of episodes) {
    const result = await store.ingestEpisode(episode);
    console.log('Ingested episode:', result);
  }

  store.saveCheckpoint({
    projectId: 'repo:pi-memory-extension',
    taskId: 'research-graphiti-like-memory',
    scopeType: 'task',
    scopeId: 'research-graphiti-like-memory',
    status: 'active',
    summary: 'Research complete; next step is implementing SQLite schemas and retrieval APIs.',
    nextStep: 'Create storage layer and hybrid retrieval service.',
    openQuestions: ['Whether to add sqlite-vec in phase 2'],
  });

  const memories = await store.searchMemory({
    query: 'what should we use for spreadsheet grounding in Pi runtime',
    scopeType: 'project',
    scopeId: 'repo:pi-memory-extension',
    activeOnly: true,
    limit: 5,
  });

  console.log('\nTop memory hits:');
  for (const hit of memories) {
    console.log(`- [${hit.factType}] ${hit.factText}`);
    console.log(`  score=${hit.score.toFixed(3)} why=${hit.why.join(', ')}`);
  }

  const activeFacts = store.getActiveFacts({
    scopeType: 'project',
    scopeId: 'repo:pi-memory-extension',
    predicates: ['package_manager', 'preferred_workflow'],
  });

  console.log('\nActive facts:');
  for (const fact of activeFacts) {
    console.log(`- ${fact.id} ${fact.predicate} => ${fact.factText} [${fact.status}]`);
  }

  console.log('\nCurrent checkpoint:');
  console.log(store.loadCheckpoint('research-graphiti-like-memory'));

  store.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
