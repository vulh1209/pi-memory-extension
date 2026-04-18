import { createLocalSqliteBackend } from './local-sqlite-backend.ts';
import type { MemoryBackend } from './backend-types.ts';
import type { HelperRequest } from './helper-protocol.ts';

const backendPromise = createLocalSqliteBackend();

async function getBackend(): Promise<MemoryBackend> {
  return backendPromise;
}

export async function handleHelperRequest(request: HelperRequest): Promise<unknown> {
  const backend = await getBackend();

  switch (request.method) {
    case 'helper.hello':
      return {
        protocolVersion: '1',
        helperVersion: '1',
        supportedMethods: [
          'helper.hello',
          'memory.status',
          'memory.search',
          'memory.ingestEpisode',
          'memory.saveCheckpoint',
          'memory.loadCheckpoint',
          'memory.getActiveFacts',
          'memory.getFactById',
          'memory.forgetFact',
        ],
        runtime: process.versions,
      };

    case 'memory.status': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.getStatus(repoRoot);
    }

    case 'memory.search': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.searchMemory(repoRoot, request.params.input as Parameters<MemoryBackend['searchMemory']>[1]);
    }

    case 'memory.ingestEpisode': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.ingestEpisode(repoRoot, request.params.input as Parameters<MemoryBackend['ingestEpisode']>[1]);
    }

    case 'memory.saveCheckpoint': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.saveCheckpoint(repoRoot, request.params.input as Parameters<MemoryBackend['saveCheckpoint']>[1]);
    }

    case 'memory.loadCheckpoint': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.loadCheckpoint(repoRoot, String(request.params.taskId ?? ''));
    }

    case 'memory.getActiveFacts': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.getActiveFacts(repoRoot, request.params.input as Parameters<MemoryBackend['getActiveFacts']>[1]);
    }

    case 'memory.getFactById': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.getFactById(repoRoot, String(request.params.factId ?? ''));
    }

    case 'memory.forgetFact': {
      const repoRoot = String(request.params.repoRoot ?? '');
      await backend.initRepo(repoRoot);
      return backend.forgetFact(
        repoRoot,
        String(request.params.factId ?? ''),
        typeof request.params.reason === 'string' ? request.params.reason : undefined,
      );
    }

    default:
      throw new Error(`unknown helper method: ${request.method}`);
  }
}
