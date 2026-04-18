import test from 'node:test';
import assert from 'node:assert/strict';

import { detectMemoryRuntime, resolveHelperPath } from '../../src/memory/runtime-detection.ts';

test('detectMemoryRuntime prefers desktop helper path when desktop is forced', () => {
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '/tmp/pi-memory-helper';

  const runtime = detectMemoryRuntime();

  assert.equal(runtime.kind, 'desktop');
  assert.equal(resolveHelperPath(runtime), '/tmp/pi-memory-helper');

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});
