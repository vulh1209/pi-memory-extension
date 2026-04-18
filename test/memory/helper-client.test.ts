import test from 'node:test';
import assert from 'node:assert/strict';

import { createHelperClient } from '../../src/memory/helper-client.ts';

test('helper client rejects with timeout when helper does not answer', async () => {
  const client = createHelperClient({
    command: process.execPath,
    args: ['--input-type=module', '--eval', 'setInterval(() => {}, 1000)'],
    startupTimeoutMs: 50,
    requestTimeoutMs: 50,
  });

  await assert.rejects(() => client.call('helper.hello', {}), /timeout/i);
  await client.dispose();
});
