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

test('helper client forwards custom environment variables to the helper process', async () => {
  const client = createHelperClient({
    command: process.execPath,
    args: [
      '--input-type=module',
      '--eval',
      [
        'import readline from "node:readline";',
        'const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });',
        'rl.on("line", (line) => {',
        '  const request = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: request.id, result: { flag: process.env.PI_MEMORY_TEST_FLAG ?? null } }) + "\\n");',
        '});',
      ].join(' '),
    ],
    env: {
      PI_MEMORY_TEST_FLAG: 'present',
    },
  });

  try {
    const result = await client.call('helper.hello', {}) as { flag?: string | null };
    assert.equal(result.flag, 'present');
  } finally {
    await client.dispose();
  }
});
