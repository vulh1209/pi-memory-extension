import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHelperClient } from '../../src/memory/helper-client.ts';

test('helper entry supports hello and memory status round-trip', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-helper-'));
  const client = createHelperClient({
    command: process.execPath,
    args: ['--experimental-strip-types', 'src/memory/helper-entry.ts'],
    startupTimeoutMs: 500,
    requestTimeoutMs: 1000,
  });

  const hello = await client.call('helper.hello', {});
  assert.equal((hello as { protocolVersion: string }).protocolVersion, '1');

  const status = await client.call('memory.status', { repoRoot });
  assert.match(String((status as { summary: string }).summary), /shared|fallback|ready/i);

  await client.dispose();
});
