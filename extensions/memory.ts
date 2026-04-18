import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

import {
  appendHookDebug,
  buildPromptMemory,
  captureToolEpisode,
  clearMemoryBackendCache,
  detectRepoRoot,
  forgetMemoryFact,
  formatCheckpoint,
  formatFactList,
  formatHookDebug,
  formatMemoryHits,
  getMemoryFactById,
  getMemoryStatus,
  initializeMemoryRepo,
  inspectMemoryFacts,
  loadTaskCheckpoint,
  readHookDebug,
  rememberMemoryNote,
  saveTaskCheckpoint,
  searchProjectMemory,
  toProjectId,
} from '../src/memory/pi-extension.ts';

interface PiUi {
  notify?: (message: string, level?: string) => void | Promise<void>;
  editor?: (title: string, initialValue: string) => Promise<string | undefined>;
  setEditorText?: (text: string) => void;
  setStatus?: (key: string, text: string) => void;
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
}

interface PiSessionLike {
  cwd?: string;
  taskId?: string;
}

interface PiContextLike {
  cwd?: string;
  taskId?: string;
  session?: PiSessionLike;
  ui?: PiUi;
}

interface PiMessageLike {
  content?: string;
}

interface PiEventLike {
  systemPrompt?: string;
  inputText?: string;
  userInput?: string;
  prompt?: string;
  message?: string;
  text?: string;
  assistantText?: string;
  outputText?: string;
  taskId?: string;
  cwd?: string;
  role?: string;
  agentRole?: string;
  session?: PiSessionLike;
  task?: { id?: string };
  agent?: { role?: string };
  toolName?: string;
  name?: string;
  input?: unknown;
  args?: unknown;
  result?: unknown;
  output?: unknown;
  error?: unknown;
  messages?: PiMessageLike[];
}

interface PiToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
}

type MemoryExtensionRuntimeState = {
  active: boolean;
  duplicateNoticeShown: boolean;
};

const STATUS_KEY = 'pi-memory';
const DEBUG_HOOKS = ['session_start', 'session_switch', 'session_fork', 'session_tree', 'before_agent_start', 'input', 'tool_result', 'turn_end'];
const MEMORY_EXTENSION_RUNTIME_KEY = Symbol.for('@lehoangvu/pi-memory-extension/runtime');
const DUPLICATE_LOAD_WARNING = 'Pi memory extension already loaded, skipping duplicate registration.';

export default function memoryExtension(pi: ExtensionAPI) {
  if (!claimMemoryExtensionRuntime()) {
    registerDuplicateLoadNoticeHooks(pi);
    return;
  }
  const initialize = async (hook: string, event?: PiEventLike, ctx?: PiContextLike, announce = false) => {
    const repoRoot = getRepoRoot(ctx, event);
    const status = await initializeMemoryRepo(repoRoot);
    appendHookDebug({
      repoRoot,
      hook,
      payload: event,
      derived: {
        cwd: getCwd(ctx, event),
        taskId: getTaskId(ctx, event),
        roleScope: getRoleScope(event),
        backendSummary: status.summary,
        backendMode: status.mode,
      },
    });
    setStatus(ctx, `${status.summary}: ${repoRoot}`);
    if (announce) {
      await ctx?.ui?.notify?.(`Pi memory loaded for ${repoRoot} (${status.summary})`, 'info');
    }
  };

  pi.on('session_shutdown', async () => {
    await clearMemoryBackendCache();
    releaseMemoryExtensionRuntime();
  });

  pi.on('session_start', async (event: PiEventLike, ctx: PiContextLike) => {
    await initialize('session_start', event, ctx, true);
  });

  pi.on('session_switch', async (event: PiEventLike, ctx: PiContextLike) => {
    await initialize('session_switch', event, ctx);
  });

  pi.on('session_fork', async (event: PiEventLike, ctx: PiContextLike) => {
    await initialize('session_fork', event, ctx);
  });

  pi.on('session_tree', async (event: PiEventLike, ctx: PiContextLike) => {
    await initialize('session_tree', event, ctx);
  });

  pi.on('before_agent_start', async (event: PiEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx, event);
    const query = getQueryText(event);
    const derived = {
      cwd: getCwd(ctx, event),
      taskId: getTaskId(ctx, event),
      roleScope: getRoleScope(event),
      query,
    };
    appendHookDebug({ repoRoot, hook: 'before_agent_start', payload: event, derived });

    if (!query) {
      return;
    }

    const taskId = getTaskId(ctx, event);
    const roleScope = getRoleScope(event);
    const memory = await buildPromptMemory({
      repoRoot,
      query,
      cwd: getCwd(ctx, event),
      taskId,
      roleScope,
      limit: 6,
    });

    if (!memory.promptBlock) {
      setStatus(ctx, 'memory: no relevant hits');
      return;
    }

    setStatus(ctx, `memory: ${memory.hits.length} hits loaded`);

    return {
      systemPrompt: [event.systemPrompt ?? '', 'Relevant project memory:', memory.promptBlock]
        .filter(Boolean)
        .join('\n\n'),
    };
  });

  pi.on('input', async (event: PiEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx, event);
    const rawInput = getQueryText(event);
    appendHookDebug({
      repoRoot,
      hook: 'input',
      payload: event,
      derived: {
        rawInput,
        cwd: getCwd(ctx, event),
        taskId: getTaskId(ctx, event),
      },
    });

    if (!rawInput || !rawInput.includes('#memory')) {
      return;
    }

    const cleanedInput = rawInput.replace(/#memory/g, '').trim();
    const memory = await buildPromptMemory({
      repoRoot,
      query: cleanedInput || rawInput,
      cwd: getCwd(ctx, event),
      taskId: getTaskId(ctx, event),
      roleScope: getRoleScope(event),
      limit: 5,
    });

    if (!memory.promptBlock) {
      return { input: cleanedInput || rawInput };
    }

    const rewritten = [
      cleanedInput || rawInput,
      '',
      'Relevant project memory:',
      memory.promptBlock,
    ].join('\n');

    setStatus(ctx, `memory: input rewritten with ${memory.hits.length} hits`);
    return { input: rewritten };
  });

  pi.on('tool_result', async (event: PiEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx, event);
    appendHookDebug({
      repoRoot,
      hook: 'tool_result',
      payload: event,
      derived: {
        toolName: event.toolName ?? event.name,
        cwd: getCwd(ctx, event),
        taskId: getTaskId(ctx, event),
      },
    });

    await captureToolEpisode({
      repoRoot,
      cwd: getCwd(ctx, event),
      taskId: getTaskId(ctx, event),
      toolName: event.toolName ?? event.name ?? 'unknown-tool',
      input: event.input ?? event.args,
      result: event.result ?? event.output,
      error: event.error,
    });
  });

  pi.on('turn_end', async (event: PiEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx, event);
    const taskId = getTaskId(ctx, event);
    const assistantText = getAssistantText(event);
    appendHookDebug({
      repoRoot,
      hook: 'turn_end',
      payload: event,
      derived: {
        taskId,
        assistantPreview: assistantText ? summarizeText(assistantText, 120) : undefined,
      },
    });

    if (!taskId || !assistantText) {
      return;
    }

    await saveTaskCheckpoint({
      repoRoot,
      taskId,
      cwd: getCwd(ctx, event),
      summary: summarizeText(assistantText, 220),
      nextStep: inferNextStep(assistantText),
    });
  });

  pi.registerCommand('memory-search', {
    description: 'Search project memory using the local Graphiti-lite store',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const { status, hits } = await searchProjectMemory({
        repoRoot,
        query: args?.trim() || 'recent project memory',
        limit: 8,
      });

      if (!status.available) {
        await showText(ctx, 'Memory search', `Memory unavailable: ${status.summary}`);
        return;
      }

      await showText(ctx, 'Memory search', formatMemoryHits(hits));
    },
  });

  pi.registerCommand('memory-why', {
    description: 'Explain which memories would be injected for a query',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const query = args?.trim() || 'current context';
      const memory = await buildPromptMemory({
        repoRoot,
        query,
        cwd: getCwd(ctx),
        taskId: getTaskId(ctx),
        limit: 8,
      });

      const body = [
        `Query: ${query}`,
        '',
        'Matches:',
        formatMemoryHits(memory.hits),
        '',
        'Prompt block:',
        memory.promptBlock || 'No prompt memory block generated.',
      ].join('\n');

      await showText(ctx, 'Memory why', body);
    },
  });

  pi.registerCommand('memory-inspect', {
    description: 'Show active memory facts for this project',
    handler: async (_args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const { status, facts } = await inspectMemoryFacts({
        repoRoot,
        input: {
          scopeType: 'project',
          scopeId: toProjectId(repoRoot),
        },
      });

      if (!status.available) {
        await showText(ctx, 'Active memory facts', `Memory unavailable: ${status.summary}`);
        return;
      }

      await showText(ctx, 'Active memory facts', formatFactList(facts));
    },
  });

  pi.registerCommand('memory-checkpoint', {
    description: 'Show the current task checkpoint if one exists',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const taskId = args?.trim() || getTaskId(ctx);
      if (!taskId) {
        await ctx.ui?.notify?.('No task id available for checkpoint lookup.', 'warn');
        return;
      }

      const { status, checkpoint } = await loadTaskCheckpoint({ repoRoot, taskId });
      if (!status.available) {
        await showText(ctx, 'Memory checkpoint', `Memory unavailable: ${status.summary}`);
        return;
      }

      await showText(ctx, 'Memory checkpoint', formatCheckpoint(checkpoint));
    },
  });

  pi.registerCommand('memory-remember', {
    description: 'Capture an explicit user memory note into the project store',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const note = args?.trim() || (await ctx.ui?.input?.('Remember what?', 'e.g. Always use pnpm test'))?.trim();
      if (!note) {
        await ctx.ui?.notify?.('No memory note provided.', 'warn');
        return;
      }

      const { status, result } = await rememberMemoryNote({
        repoRoot,
        input: {
          projectId: toProjectId(repoRoot),
          taskId: getTaskId(ctx),
          scopeType: 'project',
          scopeId: toProjectId(repoRoot),
          sourceType: 'user_message',
          sourceName: 'memory-remember',
          actor: 'user',
          repoRoot,
          cwd: getCwd(ctx),
          content: note,
        },
      });

      if (!status.available || !result) {
        await showText(ctx, 'Memory remember', `Memory unavailable: ${status.summary}`);
        return;
      }

      await showText(
        ctx,
        'Memory remember',
        [`Saved episode: ${result.episodeId}`, `Facts created/updated: ${result.facts.length}`].join('\n'),
      );
    },
  });

  pi.registerCommand('memory-forget', {
    description: 'Archive a memory fact so it stops being loaded',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const factId = args?.trim() || (await ctx.ui?.input?.('Forget which fact id?', 'fact_xxx'))?.trim();
      if (!factId) {
        await ctx.ui?.notify?.('No fact id provided.', 'warn');
        return;
      }

      const status = await getMemoryStatus({ repoRoot });
      if (!status.available) {
        await showText(ctx, 'Memory forget', `Memory unavailable: ${status.summary}`);
        return;
      }

      const fact = await getMemoryFactById({ repoRoot, factId });
      if (!fact) {
        await ctx.ui?.notify?.(`Fact not found: ${factId}`, 'warn');
        return;
      }

      const archived = await forgetMemoryFact({ repoRoot, factId, reason: 'Forgotten via /memory-forget' });
      await showText(
        ctx,
        'Memory forget',
        archived ? `Archived fact ${archived.id}\n${archived.factText}` : `Archived fact ${factId}`,
      );
    },
  });

  pi.registerCommand('memory-hook-debug', {
    description: 'Show captured Pi hook payloads for runtime payload verification',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const requestedHook = args?.trim() || undefined;
      const hook = requestedHook && DEBUG_HOOKS.includes(requestedHook) ? requestedHook : undefined;
      const records = readHookDebug({ repoRoot, hook, limit: 10 });
      await showText(ctx, 'Memory hook debug', formatHookDebug(records));
    },
  });

  pi.registerTool({
    name: 'memory_search',
    label: 'Memory Search',
    description: 'Search the local project memory store for relevant facts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What to search in memory.' },
        limit: { type: 'number', description: 'Maximum facts to return.', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
    execute: async (_toolCallId: string, params: { query: string; limit?: number }): Promise<PiToolCallResult> => {
      const repoRoot = getRepoRoot();
      const { status, hits } = await searchProjectMemory({
        repoRoot,
        query: params.query,
        limit: params.limit ?? 5,
      });

      return {
        content: [{ type: 'text', text: status.available ? formatMemoryHits(hits) : `Memory unavailable: ${status.summary}` }],
        details: {
          repoRoot,
          hits,
          status,
        },
      };
    },
  });
}

function getRepoRoot(ctx?: PiContextLike, event?: PiEventLike): string {
  return detectRepoRoot(getCwd(ctx, event));
}

function getCwd(ctx?: PiContextLike, event?: PiEventLike): string | undefined {
  return ctx?.session?.cwd ?? ctx?.cwd ?? event?.cwd ?? event?.session?.cwd ?? process.cwd();
}

function getTaskId(ctx?: PiContextLike, event?: PiEventLike): string | undefined {
  return event?.taskId ?? event?.task?.id ?? ctx?.taskId ?? ctx?.session?.taskId ?? undefined;
}

function getRoleScope(event?: PiEventLike): string | undefined {
  return event?.agentRole ?? event?.role ?? event?.agent?.role ?? undefined;
}

function getQueryText(event?: PiEventLike): string {
  return event?.inputText ?? event?.userInput ?? event?.prompt ?? event?.message ?? event?.text ?? '';
}

function getAssistantText(event?: PiEventLike): string {
  if (typeof event?.assistantText === 'string') {
    return event.assistantText;
  }
  if (typeof event?.outputText === 'string') {
    return event.outputText;
  }
  if (typeof event?.message === 'string') {
    return event.message;
  }
  const lastMessage = event?.messages?.at?.(-1);
  return typeof lastMessage?.content === 'string' ? lastMessage.content : '';
}

function getMemoryExtensionRuntimeState(): MemoryExtensionRuntimeState {
  const runtimeStateHost = globalThis as typeof globalThis & { [key: symbol]: MemoryExtensionRuntimeState | undefined };
  const existing = runtimeStateHost[MEMORY_EXTENSION_RUNTIME_KEY];
  if (existing) {
    return existing;
  }

  const created: MemoryExtensionRuntimeState = {
    active: false,
    duplicateNoticeShown: false,
  };
  runtimeStateHost[MEMORY_EXTENSION_RUNTIME_KEY] = created;
  return created;
}

function claimMemoryExtensionRuntime(): boolean {
  const state = getMemoryExtensionRuntimeState();
  if (state.active) {
    return false;
  }

  state.active = true;
  return true;
}

function releaseMemoryExtensionRuntime(): void {
  const state = getMemoryExtensionRuntimeState();
  state.active = false;
}

function registerDuplicateLoadNoticeHooks(pi: ExtensionAPI): void {
  const notifyDuplicateLoad = async (_event: PiEventLike, ctx: PiContextLike) => {
    const state = getMemoryExtensionRuntimeState();
    if (state.duplicateNoticeShown) {
      return;
    }

    state.duplicateNoticeShown = true;
    await ctx?.ui?.notify?.(DUPLICATE_LOAD_WARNING, 'warn');
  };

  pi.on('session_start', notifyDuplicateLoad);
  pi.on('before_agent_start', notifyDuplicateLoad);
}

function summarizeText(input: string, maxChars: number): string {
  const compact = input.replace(/\s+/g, ' ').trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1)}…`;
}

function inferNextStep(text: string): string | undefined {
  const match = text.match(/next step[:\-]\s*(.+)/i);
  return match ? summarizeText(match[1], 160) : undefined;
}

async function showText(ctx: PiContextLike, title: string, body: string): Promise<void> {
  if (typeof ctx.ui?.editor === 'function') {
    await ctx.ui.editor(title, body);
    return;
  }
  if (typeof ctx.ui?.setEditorText === 'function') {
    ctx.ui.setEditorText(body);
    ctx.ui.notify?.(title, 'info');
    return;
  }
  await ctx.ui?.notify?.(`${title}\n${body}`, 'info');
}

function setStatus(ctx: PiContextLike | undefined, text: string): void {
  ctx?.ui?.setStatus?.(STATUS_KEY, text);
}
