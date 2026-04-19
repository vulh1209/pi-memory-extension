import test from 'node:test';
import assert from 'node:assert/strict';

import { detectMemoryRuntime, getHelperLaunchSpecs, resolveHelperPath } from '../../src/memory/runtime-detection.ts';

test('detectMemoryRuntime prefers desktop helper path when desktop is forced', () => {
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '/tmp/pi-memory-helper';

  const runtime = detectMemoryRuntime();

  assert.equal(runtime.kind, 'desktop');
  assert.equal(resolveHelperPath(runtime), '/tmp/pi-memory-helper');

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});

test('detectMemoryRuntime auto-resolves helper launch specs for desktop mode', () => {
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  delete process.env.PI_MEMORY_HELPER_PATH;
  delete process.env.PI_MEMORY_HELPER_ARGS;

  const runtime = detectMemoryRuntime();

  assert.equal(runtime.kind, 'desktop');
  const specs = getHelperLaunchSpecs(runtime);
  assert.ok(specs.length >= 1);
  assert.ok(specs.some((spec) => spec.args.some((arg) => /helper-entry\.ts$/.test(arg))));

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
});

test('detectMemoryRuntime runs helper script paths through the configured runtime command', () => {
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_DISABLE_AUTO_HELPER = '1';
  process.env.PI_MEMORY_HELPER_COMMAND = '/tmp/custom-node';
  process.env.PI_MEMORY_HELPER_PATH = '/tmp/pi-memory-helper.ts';
  process.env.PI_MEMORY_HELPER_ARGS = JSON.stringify(['--experimental-strip-types']);

  const runtime = detectMemoryRuntime();
  const specs = getHelperLaunchSpecs(runtime);

  assert.equal(runtime.kind, 'desktop');
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.command, '/tmp/custom-node');
  assert.deepEqual(specs[0]?.args, ['--experimental-strip-types', '/tmp/pi-memory-helper.ts']);
  assert.equal(specs[0]?.target, '/tmp/pi-memory-helper.ts');

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_DISABLE_AUTO_HELPER;
  delete process.env.PI_MEMORY_HELPER_COMMAND;
  delete process.env.PI_MEMORY_HELPER_PATH;
  delete process.env.PI_MEMORY_HELPER_ARGS;
});
