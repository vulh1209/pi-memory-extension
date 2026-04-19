import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import memoryExtension from '../../extensions/memory.ts';
import { clearMemoryBackendCache, inspectMemoryFacts, readActiveTask, toProjectId } from '../../src/memory/pi-extension.ts';

const MEMORY_EXTENSION_RUNTIME_KEY = Symbol.for('@lehoangvu/pi-memory-extension/runtime');

type EventHandler = (event?: unknown, ctx?: unknown) => unknown | Promise<unknown>;

type RegisteredTool = {
  name: string;
  execute?: (...args: any[]) => Promise<any>;
};

type RegisteredCommand = {
  name: string;
  options: { handler: (args: string, ctx: unknown) => Promise<void> };
};

type MockPi = {
  handlers: Map<string, EventHandler[]>;
  commands: RegisteredCommand[];
  tools: RegisteredTool[];
  on: (event: string, handler: EventHandler) => void;
  registerCommand: (name: string, options: RegisteredCommand['options']) => void;
  registerTool: (definition: RegisteredTool) => void;
};

function createMockPi(): MockPi {
  const handlers = new Map<string, EventHandler[]>();
  const commands: RegisteredCommand[] = [];
  const tools: RegisteredTool[] = [];

  return {
    handlers,
    commands,
    tools,
    on(event: string, handler: EventHandler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerCommand(name, options) {
      commands.push({ name, options });
    },
    registerTool(definition) {
      tools.push(definition);
    },
  };
}

async function emit(pi: MockPi, eventName: string, event: unknown, ctx: unknown): Promise<any[]> {
  const handlers = pi.handlers.get(eventName) ?? [];
  const results: any[] = [];
  for (const handler of handlers) {
    results.push(await handler(event, ctx));
  }
  return results;
}

async function resetRuntimeState(): Promise<void> {
  const runtimeStateHost = globalThis as typeof globalThis & { [key: symbol]: unknown };
  delete runtimeStateHost[MEMORY_EXTENSION_RUNTIME_KEY];
  await clearMemoryBackendCache();
  delete process.env.PI_MEMORY_FORCE_DESKTOP;
  delete process.env.PI_MEMORY_DISABLE_AUTO_HELPER;
  delete process.env.PI_MEMORY_HELPER_PATH;
  delete process.env.PI_MEMORY_HELPER_ARGS;
}

async function getProjectFacts(repoRoot: string) {
  const { facts } = await inspectMemoryFacts({
    repoRoot,
    input: {
      scopeType: 'project',
      scopeId: toProjectId(repoRoot),
    },
  });
  return facts;
}

function createEditorCapture() {
  const entries: Array<{ title: string; body: string }> = [];
  return {
    entries,
    ui: {
      notify: async () => {},
      editor: async (title: string, body: string) => {
        entries.push({ title, body });
        return undefined;
      },
    },
  };
}

test('skips duplicate memory extension registration and warns once', async () => {
  await resetRuntimeState();
  const activePi = createMockPi();
  memoryExtension(activePi as never);

  assert.ok(activePi.tools.some((tool) => tool.name === 'memory_search'));
  assert.ok(activePi.commands.some((command) => command.name === 'memory-search'));
  assert.ok(activePi.commands.some((command) => command.name === 'task-start'));
  assert.ok(activePi.commands.some((command) => command.name === 'task-done'));

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

  await emit(duplicatePi, 'session_start', { reason: 'startup' }, ctx);
  await emit(duplicatePi, 'session_start', { reason: 'reload' }, ctx);

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? '', /duplicate|already loaded|skipping/i);

  await emit(activePi, 'session_shutdown', {}, {});
});

test('task-start command persists the active task pointer', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'task-start');
  assert.ok(command);

  await command!.options.handler('Fix flaky auth tests', {
    cwd: repoRoot,
    ui: {
      notify: async () => {},
      editor: async () => undefined,
    },
  });

  const activeTask = readActiveTask({ repoRoot });
  assert.ok(activeTask);
  assert.match(activeTask!.title, /Fix flaky auth tests/i);
  assert.equal(activeTask!.status, 'active');

  await emit(pi, 'session_shutdown', {}, {});
});

test('input hook rewrites #memory prompts using current Pi transform shape', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const inputResults = await emit(
    pi,
    'input',
    { text: 'Investigate auth bug #memory', source: 'interactive' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(inputResults.length, 1);
  assert.equal(inputResults[0]?.action, 'transform');
  assert.match(String(inputResults[0]?.text), /Investigate auth bug/);

  await emit(pi, 'session_shutdown', {}, {});
});

test('input hook asks to save durable rule candidates and persists them when confirmed', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const confirmations: Array<{ title: string; message: string }> = [];
  await emit(
    pi,
    'input',
    { text: 'luôn chạy test trc khi commit', source: 'interactive' },
    {
      cwd: repoRoot,
      ui: {
        confirm: async (title: string, message: string) => {
          confirmations.push({ title, message });
          return true;
        },
        notify: async () => {},
      },
    },
  );

  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0]?.message ?? '', /Project rule: Luôn chạy test trc khi commit\./i);

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Luôn chạy test trc khi commit/i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('input hook does not persist durable rule candidates when confirmation is declined', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  await emit(
    pi,
    'input',
    { text: 'always run tests before commit', source: 'interactive' },
    {
      cwd: repoRoot,
      ui: {
        confirm: async () => false,
        notify: async () => {},
      },
    },
  );

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.length, 0);

  await emit(pi, 'session_shutdown', {}, {});
});

test('assistant save offer can persist a pending durable memory note after a plain chat confirmation', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const notifications: Array<{ message: string; level?: string }> = [];
  await emit(
    pi,
    'input',
    { text: 'phải chạy test trc khi commit', source: 'interactive' },
    {
      cwd: repoRoot,
      ui: {
        notify: async (message: string, level?: string) => {
          notifications.push({ message, level });
        },
      },
    },
  );

  await emit(
    pi,
    'turn_end',
    {
      message: {
        role: 'assistant',
        content: 'Hiểu rồi: luôn chạy test trước khi commit. Bạn có muốn mình lưu quy tắc này vào project memory không?',
      },
      toolResults: [],
    },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  const confirmResults = await emit(
    pi,
    'input',
    { text: 'có', source: 'interactive' },
    {
      cwd: repoRoot,
      ui: {
        notify: async (message: string, level?: string) => {
          notifications.push({ message, level });
        },
      },
    },
  );

  assert.equal(confirmResults[0]?.action, 'transform');
  assert.match(String(confirmResults[0]?.text), /already been saved by the extension/i);

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Project rule: Phải chạy test trc khi commit\./i.test(fact.factText)), true);
  assert.equal(notifications.some((entry) => /saved to project memory/i.test(entry.message)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('assistant save offer treats Vietnamese save-intent replies like "lưu" as confirmation', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  await emit(
    pi,
    'input',
    { text: 'phải chạy test trc khi commit', source: 'interactive' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  await emit(
    pi,
    'turn_end',
    {
      message: {
        role: 'assistant',
        content: 'Bạn có muốn mình lưu quy tắc này vào project memory không?',
      },
      toolResults: [],
    },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  const confirmResults = await emit(
    pi,
    'input',
    { text: 'lưu', source: 'interactive' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(confirmResults[0]?.action, 'transform');

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Project rule: Phải chạy test trc khi commit\./i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('assistant save offer treats Vietnamese save-intent replies like "lưu đi" as confirmation', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  await emit(
    pi,
    'input',
    { text: 'phải chạy test trc khi commit', source: 'interactive' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  await emit(
    pi,
    'turn_end',
    {
      message: {
        role: 'assistant',
        content: 'Bạn có muốn mình lưu quy tắc này vào project memory không?',
      },
      toolResults: [],
    },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  const confirmResults = await emit(
    pi,
    'input',
    { text: 'lưu đi', source: 'interactive' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(confirmResults[0]?.action, 'transform');

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Project rule: Phải chạy test trc khi commit\./i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('before_agent_start injects durable memory guardrails even without memory hits', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const results = await emit(
    pi,
    'before_agent_start',
    { prompt: 'Investigate auth bug', systemPrompt: 'Base system prompt' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(results.length, 1);
  assert.match(String(results[0]?.systemPrompt), /Durable memory policy:/i);
  assert.match(String(results[0]?.systemPrompt), /Do not claim a preference or rule was remembered durably/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('before_agent_start suggests loading the memory-usage skill for memory tasks', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const results = await emit(
    pi,
    'before_agent_start',
    { prompt: 'Save this project rule to memory and check prior lessons', systemPrompt: 'Base system prompt' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(results.length, 1);
  assert.match(String(results[0]?.systemPrompt), /memory-usage skill/i);
  assert.match(String(results[0]?.systemPrompt), /load the memory-usage skill if available before acting/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('before_agent_start suggests loading the memory-usage skill for implicit prior-fix prompts', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const results = await emit(
    pi,
    'before_agent_start',
    { prompt: 'Check the prior issue and past fix before proposing a new patch', systemPrompt: 'Base system prompt' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(results.length, 1);
  assert.match(String(results[0]?.systemPrompt), /memory-usage skill/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('before_agent_start suggests loading the memory-usage skill for already-saved checks in Vietnamese', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const results = await emit(
    pi,
    'before_agent_start',
    { prompt: 'Rule này đã lưu chưa?', systemPrompt: 'Base system prompt' },
    { cwd: repoRoot, ui: { notify: async () => {} } },
  );

  assert.equal(results.length, 1);
  assert.match(String(results[0]?.systemPrompt), /memory-usage skill/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('loads on desktop runtime without explicit helper env and still registers commands and tools', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  assert.ok(pi.commands.some((command) => command.name === 'memory-search'));
  assert.ok(pi.tools.some((tool) => tool.name === 'memory_search'));

  const notifications: Array<{ message: string; level?: string }> = [];
  await assert.doesNotReject(async () => {
    await emit(pi, 'session_start', { reason: 'startup' }, {
      cwd: process.cwd(),
      ui: {
        notify: async (message: string, level?: string) => {
          notifications.push({ message, level });
        },
      },
    });
  });

  assert.equal(notifications.some((entry) => /memory/i.test(entry.message)), true);
});

test('memory search command reports unavailable state when desktop auto helper is disabled and no helper is configured', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_DISABLE_AUTO_HELPER = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory-search');
  assert.ok(command);

  const notifications: Array<{ message: string; level?: string }> = [];
  await command!.options.handler('pnpm', {
    cwd: process.cwd(),
    ui: {
      notify: async (message: string, level?: string) => {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications.some((entry) => /unavailable|helper|desktop/i.test(entry.message)), true);
});

test('memory umbrella command shows status and quick commands', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory');
  assert.ok(command);

  const capture = createEditorCapture();
  await command!.options.handler('', { cwd: repoRoot, ui: capture.ui });

  const output = capture.entries.at(-1);
  assert.equal(output?.title, 'Memory');
  assert.match(output?.body ?? '', /Memory status/i);
  assert.match(output?.body ?? '', /\/memory search <query>/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory umbrella command surfaces helper diagnostics when unavailable', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_DISABLE_AUTO_HELPER = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory');
  assert.ok(command);

  const capture = createEditorCapture();
  await command!.options.handler('', { cwd: process.cwd(), ui: capture.ui });

  const output = capture.entries.at(-1);
  assert.equal(output?.title, 'Memory');
  assert.match(output?.body ?? '', /desktop memory helper unavailable/i);
  assert.match(output?.body ?? '', /reason: no helper launch specs available/i);
});

test('memory search tool auto-detects helper-backed desktop mode without helper env', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = '';

  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_search');
  assert.ok(tool?.execute);

  try {
    const result = await tool!.execute!('tool-auto', { query: 'pnpm', limit: 3 });
    assert.equal((result.details?.status as { available?: boolean } | undefined)?.available, true);
  } finally {
    await clearMemoryBackendCache();
  }
});

test('memory remember tool asks for confirmation before saving', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_remember');
  assert.ok(tool?.execute);

  const result = await tool!.execute!('tool-remember', {
    note: 'Always use pnpm test',
    category: 'rule',
  }, undefined, undefined, {
    cwd: repoRoot,
    ui: {
      confirm: async () => true,
    },
  });

  assert.equal(result.details?.saved, true);
  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Always use pnpm test/i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory-remember command canonicalizes broad rule notes into inspectable facts', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const command = pi.commands.find((entry) => entry.name === 'memory-remember');
  assert.ok(command);

  await command!.options.handler('Never edit generated files manually', {
    cwd: repoRoot,
    ui: {
      notify: async () => {},
      editor: async () => undefined,
    },
  });

  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.some((fact) => /Never edit generated files manually/i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory-rules command shows saved rules concisely', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const remember = pi.commands.find((entry) => entry.name === 'memory-remember');
  const rules = pi.commands.find((entry) => entry.name === 'memory-rules');
  assert.ok(remember);
  assert.ok(rules);

  const capture = createEditorCapture();
  await remember!.options.handler('Always use pnpm test', { cwd: repoRoot, ui: capture.ui });
  await rules!.options.handler('', { cwd: repoRoot, ui: capture.ui });

  const output = capture.entries.at(-1);
  assert.equal(output?.title, 'Memory rules');
  assert.match(output?.body ?? '', /Always use pnpm test/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory remember tool respects user decline and does not save', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_remember');
  assert.ok(tool?.execute);

  const result = await tool!.execute!('tool-remember', {
    note: 'Always use pnpm test',
    category: 'rule',
  }, undefined, undefined, {
    cwd: repoRoot,
    ui: {
      confirm: async () => false,
    },
  });

  assert.equal(result.details?.saved, false);
  const facts = await getProjectFacts(repoRoot);
  assert.equal(facts.length, 0);

  await emit(pi, 'session_shutdown', {}, {});
});

test('turn_end auto-saves resolved trap issues as lessons after a failure then fix', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const taskStart = pi.commands.find((entry) => entry.name === 'task-start');
  assert.ok(taskStart);

  await taskStart!.options.handler('Fix auth redirect trap', {
    cwd: repoRoot,
    ui: {
      notify: async () => {},
      editor: async () => undefined,
    },
  });

  await emit(pi, 'tool_result', {
    toolName: 'bash',
    input: { command: 'pnpm test auth' },
    content: [{ type: 'text', text: 'Module not found: ./auth-redirect.js' }],
    isError: true,
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  await emit(pi, 'tool_result', {
    toolName: 'bash',
    input: { command: 'pnpm test auth' },
    content: [{ type: 'text', text: 'Tests passed' }],
    isError: false,
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  await emit(pi, 'turn_end', {
    message: {
      role: 'assistant',
      content: 'Trap issue resolved. Root cause: the auth redirect helper imported the built file path instead of the source module. Fix: point the import to the source TS module and rerun pnpm test auth. Verified and fixed.',
    },
    toolResults: [{ toolName: 'bash', details: { command: 'pnpm test auth' } }],
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  const { facts } = await inspectMemoryFacts({
    repoRoot,
    input: {
      scopeType: 'task',
      scopeId: readActiveTask({ repoRoot })!.taskId,
    },
  });
  assert.equal(facts.some((fact) => fact.factType === 'lesson' && /Root cause:/i.test(fact.factText)), true);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory-lessons command shows auto-saved lessons', async () => {
  await resetRuntimeState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'pi-memory-ext-'));
  const pi = createMockPi();
  memoryExtension(pi as never);

  const taskStart = pi.commands.find((entry) => entry.name === 'task-start');
  const lessons = pi.commands.find((entry) => entry.name === 'memory-lessons');
  assert.ok(taskStart);
  assert.ok(lessons);

  await taskStart!.options.handler('Fix auth redirect trap', {
    cwd: repoRoot,
    ui: {
      notify: async () => {},
      editor: async () => undefined,
    },
  });

  await emit(pi, 'tool_result', {
    toolName: 'bash',
    input: { command: 'pnpm test auth' },
    content: [{ type: 'text', text: 'Module not found: ./auth-redirect.js' }],
    isError: true,
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  await emit(pi, 'tool_result', {
    toolName: 'bash',
    input: { command: 'pnpm test auth' },
    content: [{ type: 'text', text: 'Tests passed' }],
    isError: false,
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  await emit(pi, 'turn_end', {
    message: {
      role: 'assistant',
      content: 'Trap issue resolved. Root cause: the auth redirect helper imported the built file path instead of the source module. Fix: point the import to the source TS module and rerun pnpm test auth. Verified and fixed.',
    },
    toolResults: [{ toolName: 'bash', details: { command: 'pnpm test auth' } }],
  }, { cwd: repoRoot, ui: { notify: async () => {} } });

  const capture = createEditorCapture();
  await lessons!.options.handler('', { cwd: repoRoot, ui: capture.ui });

  const output = capture.entries.at(-1);
  assert.equal(output?.title, 'Memory lessons');
  assert.match(output?.body ?? '', /Root cause:/i);
  assert.match(output?.body ?? '', /Fix:/i);

  await emit(pi, 'session_shutdown', {}, {});
});

test('memory search tool uses helper-backed desktop mode when helper path is configured', async () => {
  await resetRuntimeState();
  process.env.PI_MEMORY_FORCE_DESKTOP = '1';
  process.env.PI_MEMORY_HELPER_PATH = process.execPath;
  process.env.PI_MEMORY_HELPER_ARGS = JSON.stringify(['--experimental-strip-types', 'src/memory/helper-entry.ts']);

  const pi = createMockPi();
  memoryExtension(pi as never);

  const tool = pi.tools.find((entry) => entry.name === 'memory_search');
  assert.ok(tool?.execute);

  try {
    const result = await tool!.execute!('tool-1', { query: 'pnpm', limit: 3 });
    assert.equal((result.details?.status as { available?: boolean } | undefined)?.available, true);
  } finally {
    await clearMemoryBackendCache();
  }
});
