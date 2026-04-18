import test from 'node:test';
import assert from 'node:assert/strict';

import memoryExtension from '../../extensions/memory.ts';
import { clearMemoryBackendCache } from '../../src/memory/pi-extension.ts';

const MEMORY_EXTENSION_RUNTIME_KEY = Symbol.for('@lehoangvu/pi-memory-extension/runtime');

type EventHandler = (event?: unknown, ctx?: unknown) => unknown | Promise<unknown>;

type MockPi = {
  handlers: Map<string, EventHandler[]>;
  commands: Array<{ name: string; options: unknown }>;
  tools: Array<{ name: string }>;
  on: (event: string, handler: EventHandler) => void;
  registerCommand: (name: string, options: unknown) => void;
  registerTool: (definition: { name: string }) => void;
};

function createMockPi(): MockPi {
  const handlers = new Map<string, EventHandler[]>();
  const commands: Array<{ name: string; options: unknown }> = [];
  const tools: Array<{ name: string }> = [];

  return {
    handlers,
    commands,
    tools,
    on(event: string, handler: EventHandler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerCommand(name: string, options: unknown) {
      commands.push({ name, options });
    },
    registerTool(definition: { name: string }) {
      tools.push(definition);
    },
  };
}

async function emit(pi: MockPi, eventName: string, event: unknown, ctx: unknown): Promise<void> {
  const handlers = pi.handlers.get(eventName) ?? [];
  for (const handler of handlers) {
    await handler(event, ctx);
  }
}

async function resetRuntimeState(): Promise<void> {
  const runtimeStateHost = globalThis as typeof globalThis & { [key: symbol]: unknown };
  delete runtimeStateHost[MEMORY_EXTENSION_RUNTIME_KEY];
  await clearMemoryBackendCache();
}

test('skips duplicate memory extension registration and warns once', async () => {
  await resetRuntimeState();
  const activePi = createMockPi();
  memoryExtension(activePi as never);

  assert.ok(activePi.tools.some((tool) => tool.name === 'memory_search'));
  assert.ok(activePi.commands.some((command) => command.name === 'memory-search'));

  const duplicatePi = createMockPi();
  memoryExtension(duplicatePi as never);

  assert.equal(duplicatePi.tools.some((tool) => tool.name === 'memory_search'), false);
  assert.equal(duplicatePi.commands.length, 0);

  const notifications: Array<{ message: string; level?: string }> = [];
  const ctx = {
    ui: {
      notify: async (message: string, level?: string) => {
        notifications.push({ message, level });
      },
    },
  };

  await emit(duplicatePi, 'session_start', { cwd: process.cwd() }, ctx);
  await emit(duplicatePi, 'session_start', { cwd: process.cwd() }, ctx);

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? '', /duplicate|already loaded|skipping/i);

  await emit(activePi, 'session_shutdown', { cwd: process.cwd() }, {});
});

test('clears duplicate guard on session shutdown so reload can register again', async () => {
  await resetRuntimeState();
  const activePi = createMockPi();
  memoryExtension(activePi as never);

  const sessionShutdownHandlers = activePi.handlers.get('session_shutdown') ?? [];
  assert.equal(sessionShutdownHandlers.length > 0, true);

  await emit(activePi, 'session_shutdown', { cwd: process.cwd() }, {});

  const reloadedPi = createMockPi();
  memoryExtension(reloadedPi as never);

  assert.ok(reloadedPi.tools.some((tool) => tool.name === 'memory_search'));

  await emit(reloadedPi, 'session_shutdown', { cwd: process.cwd() }, {});
});

test('duplicate warning only fires once across reloads in the same process', async () => {
  await resetRuntimeState();
  const notifications: Array<{ message: string; level?: string }> = [];
  const ctx = {
    ui: {
      notify: async (message: string, level?: string) => {
        notifications.push({ message, level });
      },
    },
  };

  const activePi = createMockPi();
  memoryExtension(activePi as never);
  const duplicatePi = createMockPi();
  memoryExtension(duplicatePi as never);

  await emit(duplicatePi, 'session_start', { cwd: process.cwd() }, ctx);
  assert.equal(notifications.length, 1);

  await emit(activePi, 'session_shutdown', { cwd: process.cwd() }, {});

  const reloadedActivePi = createMockPi();
  memoryExtension(reloadedActivePi as never);
  const reloadedDuplicatePi = createMockPi();
  memoryExtension(reloadedDuplicatePi as never);

  await emit(reloadedDuplicatePi, 'session_start', { cwd: process.cwd() }, ctx);
  assert.equal(notifications.length, 1);

  await emit(reloadedActivePi, 'session_shutdown', { cwd: process.cwd() }, {});
});

test('loads on desktop runtime without helper and still registers commands and tools', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  assert.ok(pi.commands.some((command) => command.name === 'memory-search'));
  assert.ok(pi.tools.some((tool) => tool.name === 'memory_search'));

  const notifications: Array<{ message: string; level?: string }> = [];
  await assert.doesNotReject(async () => {
    await emit(pi, 'session_start', { cwd: process.cwd() }, {
      ui: {
        notify: async (message: string, level?: string) => {
          notifications.push({ message, level });
        },
      },
    });
  });

  assert.equal(notifications.some((entry) => /memory/i.test(entry.message)), true);

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});

test('memory search command reports unavailable state when desktop helper is missing', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory-search');
  assert.ok(command);

  const notifications: Array<{ message: string; level?: string }> = [];
  await (command!.options as { handler: (args: string, ctx: unknown) => Promise<void> }).handler('pnpm', {
    cwd: process.cwd(),
    ui: {
      notify: async (message: string, level?: string) => {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications.some((entry) => /unavailable|helper|desktop/i.test(entry.message)), true);

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
});

test('memory search tool uses helper-backed desktop mode when helper path is configured', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = process.execPath;
  process.env.PI_MEMORY_HELPER_ARGS = JSON.stringify(['--experimental-strip-types', 'src/memory/helper-entry.ts']);

  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_search');
  assert.ok(tool);

  const result = await (tool as { execute: (toolCallId: string, params: { query: string; limit?: number }) => Promise<{ details?: Record<string, unknown> }> }).execute(
    'tool-1',
    { query: 'pnpm', limit: 3 },
  );

  assert.equal((result.details?.status as { available?: boolean } | undefined)?.available, true);

  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_HELPER_PATH;
  delete process.env.PI_MEMORY_HELPER_ARGS;
  await clearMemoryBackendCache();
});
