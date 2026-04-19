import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

import {
  appendHookDebug,
  buildPromptMemory,
  captureToolEpisode,
  clearActiveTask,
  clearMemoryBackendCache,
  createTaskId,
  detectRepoRoot,
  DEFAULT_MEMORY_EXTENSION_CONFIG,
  forgetMemoryFact,
  formatActiveTask,
  formatCheckpoint,
  formatFactList,
  formatHookDebug,
  formatMemoryExtensionConfig,
  formatMemoryHits,
  getActiveTask,
  getMemoryFactById,
  getMemoryStatus,
  initializeMemoryRepo,
  inspectMemoryFacts,
  loadActiveTaskCheckpoint,
  loadTaskCheckpoint,
  markTaskDone,
  readHookDebug,
  readMemoryExtensionConfig,
  rememberMemoryNote,
  saveTaskCheckpoint,
  searchProjectMemory,
  setActiveTask,
  toProjectId,
  updateMemoryExtensionConfig,
  type MemoryExtensionConfig,
} from '../src/memory/pi-extension.ts';

type NotifyLevel = 'info' | 'warning' | 'error' | 'warn';

type PiUi = {
  notify?: (message: string, level?: NotifyLevel) => void | Promise<void>;
  confirm?: (title: string, message: string) => Promise<boolean>;
  editor?: (title: string, initialValue: string) => Promise<string | undefined>;
  setEditorText?: (text: string) => void;
  setStatus?: (key: string, text: string | undefined) => void;
  setWidget?: (key: string, value: string[] | undefined, options?: { placement?: 'aboveEditor' | 'belowEditor' }) => void;
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
  custom?: <T = unknown>(factory: (tui: { requestRender: () => void }, theme: Record<string, unknown>, keybindings: unknown, done: (value: T) => void) => { render: (width: number) => string[]; invalidate: () => void; handleInput?: (data: string) => void; }, options?: unknown) => Promise<T>;
};

type PiContextLike = {
  cwd?: string;
  ui?: PiUi;
};

type TextPartLike = { type?: string; text?: string };

type AgentMessageLike = {
  role?: string;
  content?: string | TextPartLike[];
};

type SessionStartEventLike = {
  reason?: 'startup' | 'reload' | 'new' | 'resume' | 'fork';
};

type BeforeAgentStartEventLike = {
  prompt: string;
  systemPrompt: string;
};

type InputEventLike = {
  text: string;
  source?: 'interactive' | 'rpc' | 'extension';
};

type ToolResultEventLike = {
  toolName?: string;
  input?: unknown;
  details?: unknown;
  content?: TextPartLike[];
  isError?: boolean;
};

type ToolResultLike = {
  toolName?: string;
  input?: unknown;
  details?: unknown;
};

type TurnEndEventLike = {
  message?: AgentMessageLike;
  toolResults?: ToolResultLike[];
};

type PiToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
};

type MemoryStatusLike = Awaited<ReturnType<typeof getMemoryStatus>>;

type MemoryFactRecord = Awaited<ReturnType<typeof inspectMemoryFacts>>['facts'][number];

type MemoryRememberToolParams = {
  note: string;
  category?: 'rule' | 'preference' | 'lesson' | 'knowledge';
  requireConfirmation?: boolean;
};

type DurableMemoryCandidate = {
  note: string;
  category: 'rule' | 'preference';
  trigger: string;
};

type PendingDurableMemoryCandidate = DurableMemoryCandidate & {
  createdAt: number;
  awaitingUserReply: boolean;
  assistantPromptAt?: number;
};

type RecentToolEvent = {
  timestamp: number;
  taskId?: string;
  toolName: string;
  command?: string;
  success: boolean;
  error?: string;
};

type MemoryExtensionRuntimeState = {
  active: boolean;
  duplicateNoticeShown: boolean;
  recentToolEventsByRepo: Record<string, RecentToolEvent[]>;
  pendingDurableMemoryByRepo: Record<string, PendingDurableMemoryCandidate | undefined>;
  savedLessonKeys: string[];
  configByRepo: Record<string, MemoryExtensionConfig | undefined>;
};

type ConfigSettingDescriptor = {
  key: keyof MemoryExtensionConfig;
  label: string;
  description: string;
};

type PiEventBusLike = {
  emit?: (eventName: string, data?: unknown) => void;
};

const STATUS_KEY = 'pi-memory';
const WIDGET_KEY = 'pi-memory-config';
const EDITOR_SET_STATUS_SEGMENT_EVENT = 'editor:set-status-segment';
const EDITOR_REMOVE_STATUS_SEGMENT_EVENT = 'editor:remove-status-segment';
const EDITOR_STATUS_SEGMENT_KEY = 'pi-memory';
const DEBUG_HOOKS = ['session_start', 'before_agent_start', 'input', 'tool_result', 'turn_end'];
const MEMORY_EXTENSION_RUNTIME_KEY = Symbol.for('@lehoangvu/pi-memory-extension/runtime');
const DUPLICATE_LOAD_WARNING = 'Pi memory extension already loaded, skipping duplicate registration.';
const PENDING_DURABLE_MEMORY_TTL_MS = 10 * 60 * 1000;
const DURABLE_MEMORY_POLICY = [
  'Durable memory policy:',
  '- Do not claim a preference or rule was remembered durably unless it was explicitly saved via the memory_remember tool or /memory-remember.',
  '- When the user shares a durable project rule or preference that has not been saved yet, ask whether it should be saved to project memory.',
  '- When the user confirms saving a previously discussed durable memory note, use the memory_remember tool if available instead of telling them to run /memory-remember manually.',
].join('\n');
const MEMORY_USAGE_SKILL_HINT = 'Memory workflow hint: If this turn involves project memory, durable rules or preferences, lessons learned, checkpoints, or deciding whether to search, save, or forget memory, load the memory-usage skill if available before acting.';
const CONFIG_SETTINGS: ConfigSettingDescriptor[] = [
  { key: 'enabled', label: 'Enable automatic memory behaviors', description: 'Master switch for all automatic hooks.' },
  { key: 'autoInjectPromptMemory', label: 'Inject relevant memory into prompts', description: 'before_agent_start appends relevant memory to the system prompt.' },
  { key: 'autoRewriteHashMemory', label: 'Rewrite #memory prompts', description: 'input hook expands #memory prompts with relevant saved memory.' },
  { key: 'autoCaptureToolEvents', label: 'Capture tool episodes', description: 'Track write/bash/edit runs as memory episodes.' },
  { key: 'autoSaveCheckpoints', label: 'Save task checkpoints', description: 'Persist a checkpoint at the end of assistant turns.' },
  { key: 'autoDetectDurableMemory', label: 'Detect durable rules/preferences', description: 'Offer to save stable project rules and preferences from chat.' },
  { key: 'autoSaveTrapLessons', label: 'Auto-save lessons from resolved failures', description: 'Save lessons after a recent failure is clearly resolved.' },
  { key: 'showStatusIndicator', label: 'Show memory status line', description: 'Display a compact memory status hint with the settings command.' },
  { key: 'captureHookDebug', label: 'Capture hook debug logs', description: 'Write runtime hook payloads to .memory/pi-hook-debug.jsonl.' },
];

const MEMORY_CONFIG_PRESETS: Record<'minimal' | 'balanced' | 'full', MemoryExtensionConfig> = {
  minimal: {
    enabled: true,
    autoInjectPromptMemory: true,
    autoRewriteHashMemory: false,
    autoCaptureToolEvents: false,
    autoSaveCheckpoints: false,
    autoDetectDurableMemory: false,
    autoSaveTrapLessons: false,
    showStatusIndicator: true,
    captureHookDebug: false,
  },
  balanced: {
    enabled: true,
    autoInjectPromptMemory: true,
    autoRewriteHashMemory: true,
    autoCaptureToolEvents: true,
    autoSaveCheckpoints: true,
    autoDetectDurableMemory: true,
    autoSaveTrapLessons: false,
    showStatusIndicator: true,
    captureHookDebug: false,
  },
  full: {
    ...DEFAULT_MEMORY_EXTENSION_CONFIG,
  },
};

export default function memoryExtension(pi: ExtensionAPI) {
  if (!claimMemoryExtensionRuntime()) {
    registerDuplicateLoadNoticeHooks(pi);
    return;
  }

  const initialize = async (hook: string, event: SessionStartEventLike | undefined, ctx: PiContextLike | undefined, announce = false) => {
    const repoRoot = getRepoRoot(ctx);
    const config = getConfigForRepo(repoRoot);
    const status = await initializeMemoryRepo(repoRoot);
    const activeTask = getActiveTask(repoRoot);

    if (config.captureHookDebug) {
      appendHookDebug({
        repoRoot,
        hook,
        payload: event,
        derived: {
          cwd: getCwd(ctx),
          reason: event?.reason,
          activeTaskId: activeTask?.taskId,
          backendSummary: status.summary,
          backendMode: status.mode,
          backendDetails: status.details,
          enabled: config.enabled,
        },
      });
    }

    syncMemoryUi(ctx, repoRoot, status, activeTask?.taskId, config, pi.events);

    if (announce) {
      await ctx?.ui?.notify?.(
        activeTask
          ? `Pi memory loaded for ${repoRoot}. ${formatMemoryStatusSummary(status)} Automatic hooks: ${config.enabled ? 'on' : 'off'}. Active task: ${activeTask.title}`
          : `Pi memory loaded for ${repoRoot}. ${formatMemoryStatusSummary(status)} Automatic hooks: ${config.enabled ? 'on' : 'off'}.`,
        status.available ? 'info' : 'warning',
      );
    }
  };

  const saveExplicitMemory = async (params: {
    ctx?: PiContextLike;
    note: string;
    sourceName: string;
    sourceType?: 'user_message' | 'memory_note' | 'agent_memory_proposal' | 'issue_resolution';
    actor?: 'user' | 'agent' | 'system' | 'tool';
    scope?: 'project' | 'task';
    metadata?: Record<string, unknown>;
  }) => {
    const repoRoot = getRepoRoot(params.ctx);
    const activeTask = getActiveTask(repoRoot);
    const useTaskScope = params.scope === 'task' && Boolean(activeTask);
    const normalizedNote = normalizeExplicitMemoryNote(params.note);
    return rememberMemoryNote({
      repoRoot,
      input: {
        projectId: toProjectId(repoRoot),
        taskId: activeTask?.taskId,
        scopeType: useTaskScope ? 'task' : 'project',
        scopeId: useTaskScope ? activeTask?.taskId ?? toProjectId(repoRoot) : toProjectId(repoRoot),
        sourceType: params.sourceType ?? 'user_message',
        sourceName: params.sourceName,
        actor: params.actor ?? 'user',
        repoRoot,
        cwd: getCwd(params.ctx),
        content: normalizedNote,
        metadata: {
          ...params.metadata,
          originalNote: normalizedNote === params.note ? undefined : params.note,
          normalizedByExtension: normalizedNote !== params.note,
        },
      },
    });
  };

  const maybeAutoSaveResolvedTrapLesson = async (params: {
    ctx?: PiContextLike;
    repoRoot: string;
    activeTask: NonNullable<ReturnType<typeof getActiveTask>>;
    assistantText: string;
  }) => {
    const resolution = extractResolvedTrapLesson(params.assistantText);
    if (!resolution) {
      return;
    }

    const recentEvents = getRecentToolEvents(params.repoRoot, params.activeTask.taskId);
    const latestFailure = [...recentEvents].reverse().find((event) => event.success === false);
    const latestSuccess = [...recentEvents].reverse().find((event) => event.success === true);
    if (!latestFailure || !latestSuccess || latestSuccess.timestamp < latestFailure.timestamp) {
      return;
    }

    if (latestSuccess.timestamp - latestFailure.timestamp > 30 * 60 * 1000) {
      return;
    }

    const issueKey = normalizeMemoryKey([
      params.activeTask.taskId,
      resolution.rootCause,
      latestFailure.command,
      latestFailure.error,
    ].filter(Boolean).join(' '));
    if (!issueKey || hasSavedLessonKey(issueKey)) {
      return;
    }

    const note = [
      'Lesson learned:',
      resolution.rootCause ? `Root cause: ${resolution.rootCause}.` : null,
      resolution.fix ? `Fix: ${resolution.fix}.` : null,
      latestFailure.command ? `Failing command: ${latestFailure.command}.` : null,
      latestSuccess.command ? `Verified by: ${latestSuccess.command}.` : null,
    ].filter(Boolean).join(' ');

    const { status, result } = await saveExplicitMemory({
      ctx: params.ctx,
      note,
      sourceName: 'auto-trap-lesson',
      sourceType: 'issue_resolution',
      actor: 'agent',
      scope: 'task',
      metadata: {
        trapIssue: true,
        resolved: true,
        issueKey,
        rootCause: resolution.rootCause,
        fix: resolution.fix,
        sourceRef: latestFailure.command,
        failingCommand: latestFailure.command,
        failingError: latestFailure.error,
        verifiedBy: latestSuccess.command,
      },
    });

    if (status.available && result) {
      rememberSavedLessonKey(issueKey);
      const config = getConfigForRepo(params.repoRoot);
      setStatus(params.ctx, config.showStatusIndicator ? `memory: lesson learned saved for ${params.activeTask.taskId}` : undefined, pi.events);
    }
  };

  const refreshMemoryUi = async (ctx: PiContextLike | undefined, repoRoot: string, config = getConfigForRepo(repoRoot)) => {
    const status = await getMemoryStatus({ repoRoot });
    syncMemoryUi(ctx, repoRoot, status, getActiveTask(repoRoot)?.taskId, config, pi.events);
    return status;
  };

  const applyMemoryPreset = async (
    ctx: PiContextLike,
    presetName: 'minimal' | 'balanced' | 'full',
    message?: string,
  ) => {
    const repoRoot = getRepoRoot(ctx);
    const config = replaceConfigForRepo(repoRoot, MEMORY_CONFIG_PRESETS[presetName]);
    await refreshMemoryUi(ctx, repoRoot, config);
    await ctx.ui?.notify?.(message ?? `Applied memory preset: ${presetName}.`, 'info');
    return config;
  };

  const resetMemoryConfig = async (ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx);
    const config = replaceConfigForRepo(repoRoot, DEFAULT_MEMORY_EXTENSION_CONFIG);
    await refreshMemoryUi(ctx, repoRoot, config);
    await ctx.ui?.notify?.('Reset memory config to defaults.', 'info');
    return config;
  };

  pi.on('session_shutdown', async () => {
    clearEditorStatusSegment(pi.events);
    await clearMemoryBackendCache();
    releaseMemoryExtensionRuntime();
  });

  pi.on('session_start', async (event: SessionStartEventLike, ctx: PiContextLike) => {
    await initialize('session_start', event, ctx, event.reason === 'startup' || event.reason === 'reload');
  });

  pi.on('before_agent_start', async (event: BeforeAgentStartEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx);
    const config = getConfigForRepo(repoRoot);
    const activeTask = getActiveTask(repoRoot);
    const query = [event.prompt?.trim(), activeTask?.title].filter(Boolean).join('\n');

    if (config.captureHookDebug) {
      appendHookDebug({
        repoRoot,
        hook: 'before_agent_start',
        payload: event,
        derived: {
          query,
          cwd: getCwd(ctx),
          activeTaskId: activeTask?.taskId,
          enabled: config.enabled,
          autoInjectPromptMemory: config.autoInjectPromptMemory,
        },
      });
    }

    const systemPromptSections = [
      event.systemPrompt,
      DURABLE_MEMORY_POLICY,
      shouldSuggestMemoryUsageSkill(event.prompt) ? MEMORY_USAGE_SKILL_HINT : null,
    ].filter(Boolean);

    if (!config.enabled || !config.autoInjectPromptMemory || !query) {
      return {
        systemPrompt: systemPromptSections.join('\n\n'),
      };
    }

    const memory = await buildPromptMemory({
      repoRoot,
      query,
      cwd: getCwd(ctx),
      taskId: activeTask?.taskId,
      limit: 6,
    });

    if (!memory.promptBlock) {
      setStatus(ctx, config.showStatusIndicator ? (activeTask ? `memory: task ${activeTask.taskId}, no relevant hits` : 'memory: no relevant hits') : undefined, pi.events);
      return {
        systemPrompt: systemPromptSections.join('\n\n'),
      };
    }

    setStatus(
      ctx,
      config.showStatusIndicator
        ? (activeTask ? `memory: ${memory.hits.length} hits for ${activeTask.taskId}` : `memory: ${memory.hits.length} hits loaded`)
        : undefined,
      pi.events,
    );

    return {
      systemPrompt: [...systemPromptSections, 'Relevant project memory:', memory.promptBlock]
        .filter(Boolean)
        .join('\n\n'),
    };
  });

  pi.on('input', async (event: InputEventLike, ctx: PiContextLike) => {
    if (event.source === 'extension') {
      return { action: 'continue' as const };
    }

    const repoRoot = getRepoRoot(ctx);
    const config = getConfigForRepo(repoRoot);
    if (config.captureHookDebug) {
      appendHookDebug({
        repoRoot,
        hook: 'input',
        payload: event,
        derived: {
          rawInput: event.text,
          cwd: getCwd(ctx),
          enabled: config.enabled,
        },
      });
    }

    const pendingDurableMemory = getPendingDurableMemory(repoRoot);
    if (pendingDurableMemory?.awaitingUserReply) {
      if (isAffirmativeReply(event.text)) {
        const { status, result } = await saveExplicitMemory({
          ctx,
          note: pendingDurableMemory.note,
          sourceName: 'chat-confirmed-memory-candidate',
          sourceType: 'user_message',
          actor: 'user',
          metadata: {
            category: pendingDurableMemory.category,
            candidateTrigger: pendingDurableMemory.trigger,
            confirmedByUser: true,
            confirmedViaAssistantOffer: true,
            autoDetected: true,
          },
        });
        clearPendingDurableMemory(repoRoot);

        if (status.available && result) {
          setStatus(ctx, config.showStatusIndicator ? `memory: saved ${pendingDurableMemory.category}` : undefined, pi.events);
          await ctx.ui?.notify?.(`Saved to project memory: ${pendingDurableMemory.note}`, 'info');
          return {
            action: 'transform' as const,
            text: `The user confirmed saving this durable project memory note, and it has already been saved by the extension: ${pendingDurableMemory.note}`,
          };
        }

        await ctx.ui?.notify?.(`Memory unavailable: ${status.summary}`, 'warning');
        return { action: 'continue' as const };
      }

      if (isNegativeReply(event.text)) {
        clearPendingDurableMemory(repoRoot);
        await ctx.ui?.notify?.('Not saved to durable memory.', 'info');
        return {
          action: 'transform' as const,
          text: 'The user declined to save the pending durable memory note.',
        };
      }
    }

    const durableMemoryCandidate = config.enabled && config.autoDetectDurableMemory
      ? detectDurableMemoryCandidate(event.text)
      : null;
    if (durableMemoryCandidate) {
      setPendingDurableMemory(repoRoot, durableMemoryCandidate);

      if (typeof ctx.ui?.confirm === 'function') {
        const confirmed = await ctx.ui.confirm(
          'Save to project memory?',
          [
            `Category: ${durableMemoryCandidate.category}`,
            `Detected from: ${durableMemoryCandidate.trigger}`,
            '',
            durableMemoryCandidate.note,
          ].join('\n'),
        );

        if (confirmed) {
          const { status, result } = await saveExplicitMemory({
            ctx,
            note: durableMemoryCandidate.note,
            sourceName: 'auto-memory-candidate',
            sourceType: 'user_message',
            actor: 'user',
            metadata: {
              category: durableMemoryCandidate.category,
              candidateTrigger: durableMemoryCandidate.trigger,
              confirmedByUser: true,
              autoDetected: true,
            },
          });
          clearPendingDurableMemory(repoRoot);

          if (status.available && result) {
            setStatus(ctx, config.showStatusIndicator ? `memory: saved ${durableMemoryCandidate.category}` : undefined, pi.events);
            await ctx.ui?.notify?.(`Saved to project memory: ${durableMemoryCandidate.note}`, 'info');
          } else {
            await ctx.ui?.notify?.(`Memory unavailable: ${status.summary}`, 'warning');
          }
        } else {
          clearPendingDurableMemory(repoRoot);
          await ctx.ui?.notify?.('Not saved to durable memory.', 'info');
        }
      } else {
        await ctx.ui?.notify?.('Potential memory note detected. I can save it after you confirm in chat, or you can use /memory-remember.', 'info');
      }
    }

    if (!config.enabled || !config.autoRewriteHashMemory || !event.text.includes('#memory')) {
      return { action: 'continue' as const };
    }

    const activeTask = getActiveTask(repoRoot);
    const cleanedInput = event.text.replace(/#memory/g, '').replace(/\s+/g, ' ').trim();
    const query = [cleanedInput || event.text, activeTask?.title].filter(Boolean).join('\n');
    const memory = await buildPromptMemory({
      repoRoot,
      query,
      cwd: getCwd(ctx),
      taskId: activeTask?.taskId,
      limit: 5,
    });

    if (!memory.promptBlock) {
      return { action: 'transform' as const, text: cleanedInput || event.text };
    }

    const rewritten = [cleanedInput || event.text, '', 'Relevant project memory:', memory.promptBlock].join('\n');
    setStatus(ctx, config.showStatusIndicator ? `memory: input rewritten with ${memory.hits.length} hits` : undefined, pi.events);
    return { action: 'transform' as const, text: rewritten };
  });

  pi.on('tool_result', async (event: ToolResultEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx);
    const config = getConfigForRepo(repoRoot);
    const activeTask = getActiveTask(repoRoot);
    const rendered = flattenTextBlocks(event.content ?? []);
    const trackedTool = Boolean(event.toolName) && (event.isError === true || ['bash', 'edit', 'write'].includes(event.toolName ?? ''));

    if (trackedTool && event.toolName) {
      recordRecentToolEvent(repoRoot, {
        timestamp: Date.now(),
        taskId: activeTask?.taskId,
        toolName: event.toolName,
        command: extractCommand(event.input),
        success: event.isError !== true,
        error: event.isError ? extractErrorText(rendered || event.details) : undefined,
      });
    }

    if (config.captureHookDebug) {
      appendHookDebug({
        repoRoot,
        hook: 'tool_result',
        payload: event,
        derived: {
          toolName: event.toolName,
          cwd: getCwd(ctx),
          activeTaskId: activeTask?.taskId,
          isError: event.isError === true,
          enabled: config.enabled,
          autoCaptureToolEvents: config.autoCaptureToolEvents,
        },
      });
    }

    if (!event.toolName) {
      return;
    }

    if (!trackedTool || !config.enabled || !config.autoCaptureToolEvents) {
      return;
    }

    await captureToolEpisode({
      repoRoot,
      cwd: getCwd(ctx),
      taskId: activeTask?.taskId,
      toolName: event.toolName,
      input: event.input,
      result: {
        content: rendered,
        details: event.details,
        isError: event.isError === true,
      },
      error: event.isError ? rendered || event.details : undefined,
    });
  });

  pi.on('turn_end', async (event: TurnEndEventLike, ctx: PiContextLike) => {
    const repoRoot = getRepoRoot(ctx);
    const config = getConfigForRepo(repoRoot);
    const activeTask = getActiveTask(repoRoot);
    const assistantText = getAssistantText(event.message);

    if (config.captureHookDebug) {
      appendHookDebug({
        repoRoot,
        hook: 'turn_end',
        payload: event,
        derived: {
          activeTaskId: activeTask?.taskId,
          assistantPreview: assistantText ? summarizeText(assistantText, 120) : undefined,
          enabled: config.enabled,
        },
      });
    }

    if (assistantText && config.enabled && config.autoDetectDurableMemory) {
      const pendingDurableMemory = getPendingDurableMemory(repoRoot);
      const extractedAssistantCandidate = extractDurableMemoryCandidateFromAssistantOffer(assistantText);
      if (extractedAssistantCandidate) {
        setPendingDurableMemory(repoRoot, extractedAssistantCandidate, true);
      } else if (pendingDurableMemory && looksLikeAssistantMemorySaveOffer(assistantText)) {
        markPendingDurableMemoryAwaitingUserReply(repoRoot);
      }
    }

    if (!activeTask || !assistantText) {
      return;
    }

    if (config.enabled && config.autoSaveTrapLessons) {
      await maybeAutoSaveResolvedTrapLesson({
        ctx,
        repoRoot,
        activeTask,
        assistantText,
      });
    }

    if (!config.enabled || !config.autoSaveCheckpoints) {
      return;
    }

    const commandsRun = collectCommandHints(event.toolResults ?? []);
    await saveTaskCheckpoint({
      repoRoot,
      taskId: activeTask.taskId,
      title: activeTask.title,
      cwd: getCwd(ctx),
      summary: summarizeText(assistantText, 220),
      nextStep: inferNextStep(assistantText),
      commandsRun,
      filesTouched: [],
    });
    setStatus(ctx, config.showStatusIndicator ? `memory: checkpoint saved for ${activeTask.taskId}` : undefined, pi.events);
  });

  pi.registerCommand('task-start', {
    description: 'Start or switch the active coding task for memory checkpoints',
    handler: async (args: string, ctx: PiContextLike) => {
      const title = args.trim() || (await ctx.ui?.input?.('Task title', 'e.g. fix auth redirect'))?.trim();
      if (!title) {
        await ctx.ui?.notify?.('No task title provided.', 'warning');
        return;
      }

      const repoRoot = getRepoRoot(ctx);
      const taskId = createTaskId(title);
      const activeTask = setActiveTask({
        repoRoot,
        taskId,
        title,
        cwd: getCwd(ctx),
        branch: getGitBranch(),
      });

      await saveTaskCheckpoint({
        repoRoot,
        taskId: activeTask.taskId,
        title: activeTask.title,
        cwd: getCwd(ctx),
        summary: `Task started: ${activeTask.title}`,
        nextStep: 'Inspect relevant files and implement the next change.',
      });

      const config = getConfigForRepo(repoRoot);
      setStatus(ctx, config.showStatusIndicator ? `memory: active task ${activeTask.taskId}` : undefined, pi.events);
      await refreshMemoryUi(ctx, repoRoot, config);
      await showText(ctx, 'Active task', formatActiveTask(activeTask));
    },
  });

  pi.registerCommand('task-done', {
    description: 'Mark the active task as done and clear the active-task pointer',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      if (!activeTask) {
        await ctx.ui?.notify?.('No active task to complete.', 'warning');
        return;
      }

      const summary = args.trim() || `Task completed: ${activeTask.title}`;
      await markTaskDone({
        repoRoot,
        taskId: activeTask.taskId,
        title: activeTask.title,
        summary,
      });

      const config = getConfigForRepo(repoRoot);
      await refreshMemoryUi(ctx, repoRoot, config);
      await showText(ctx, 'Task completed', `Completed ${activeTask.taskId}\n${summary}`);
    },
  });

  pi.registerCommand('memory-search', {
    description: 'Search project memory using the local memory store',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const { status, hits } = await searchProjectMemory({
        repoRoot,
        query: args.trim() || activeTask?.title || 'recent project memory',
        limit: 8,
        taskId: activeTask?.taskId,
        cwd: getCwd(ctx),
      });

      if (!status.available) {
        await showText(ctx, 'Memory search', formatMemoryUnavailable(status, repoRoot, activeTask?.taskId));
        return;
      }

      await showText(ctx, 'Memory search', formatMemoryHits(hits));
    },
  });

  pi.registerCommand('memory-why', {
    description: 'Explain which memories would be injected for a query',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const query = args.trim() || activeTask?.title || 'current context';
      const memory = await buildPromptMemory({
        repoRoot,
        query,
        cwd: getCwd(ctx),
        taskId: activeTask?.taskId,
        limit: 8,
      });

      if (!memory.status.available) {
        await showText(ctx, 'Memory why', formatMemoryUnavailable(memory.status, repoRoot, activeTask?.taskId));
        return;
      }

      const body = [
        `Query: ${query}`,
        '',
        activeTask ? `Active task: ${activeTask.taskId}` : 'Active task: none',
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
        await showText(ctx, 'Active memory facts', formatMemoryUnavailable(status, repoRoot));
        return;
      }

      await showText(ctx, 'Active memory facts', formatFactList(facts));
    },
  });

  pi.registerCommand('memory-lessons', {
    description: 'Show saved lesson-learned memories for the project and active task',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const { status, facts } = await inspectRelevantFacts(repoRoot, activeTask?.taskId);

      if (!status.available) {
        await showText(ctx, 'Memory lessons', formatMemoryUnavailable(status, repoRoot, activeTask?.taskId));
        return;
      }

      const filtered = filterMemoryFactsByQuery(
        facts.filter((fact) => fact.factType === 'lesson'),
        args.trim(),
      );
      await showText(ctx, 'Memory lessons', formatFocusedFacts(filtered, 'lesson'));
    },
  });

  pi.registerCommand('memory-rules', {
    description: 'Show saved project rules and preferences',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const { status, facts } = await inspectRelevantFacts(repoRoot, activeTask?.taskId);

      if (!status.available) {
        await showText(ctx, 'Memory rules', formatMemoryUnavailable(status, repoRoot, activeTask?.taskId));
        return;
      }

      const filtered = filterMemoryFactsByQuery(
        facts.filter((fact) => isRuleLikeFact(fact)),
        args.trim(),
      );
      await showText(ctx, 'Memory rules', formatFocusedFacts(filtered, 'rule'));
    },
  });

  pi.registerCommand('memory-checkpoint', {
    description: 'Show the current task checkpoint if one exists',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const taskId = args.trim() || activeTask?.taskId;
      if (!taskId) {
        await ctx.ui?.notify?.('No task id available for checkpoint lookup.', 'warning');
        return;
      }

      const { status, checkpoint } = await loadTaskCheckpoint({ repoRoot, taskId });
      if (!status.available) {
        await showText(ctx, 'Memory checkpoint', formatMemoryUnavailable(status, repoRoot, taskId));
        return;
      }

      await showText(ctx, 'Memory checkpoint', formatCheckpoint(checkpoint));
    },
  });

  pi.registerCommand('memory-active-task', {
    description: 'Show the active task pointer and latest checkpoint',
    handler: async (_args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const { activeTask, checkpoint } = await loadActiveTaskCheckpoint({ repoRoot });
      await showText(
        ctx,
        'Active task',
        [formatActiveTask(activeTask), '', formatCheckpoint(checkpoint)].filter(Boolean).join('\n'),
      );
    },
  });

  pi.registerCommand('memory-settings', {
    description: 'Open interactive memory extension settings',
    handler: async (_args: string, ctx: PiContextLike) => {
      await showMemorySettingsUI(ctx, pi.events);
    },
  });

  pi.registerCommand('memory-enable', {
    description: 'Enable automatic memory hooks for this repo',
    handler: async (_args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      saveConfigForRepo(repoRoot, { enabled: true });
      await refreshMemoryUi(ctx, repoRoot);
      await ctx.ui?.notify?.('Automatic memory hooks enabled.', 'info');
    },
  });

  pi.registerCommand('memory-disable', {
    description: 'Disable automatic memory hooks for this repo',
    handler: async (_args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      saveConfigForRepo(repoRoot, { enabled: false });
      await refreshMemoryUi(ctx, repoRoot);
      await ctx.ui?.notify?.('Automatic memory hooks disabled. Manual commands and tools still work.', 'info');
    },
  });

  pi.registerCommand('memory-preset', {
    description: 'Apply a memory preset: minimal, balanced, or full',
    handler: async (args: string, ctx: PiContextLike) => {
      const presetName = args.trim().toLowerCase() as 'minimal' | 'balanced' | 'full';
      if (!presetName || !(presetName in MEMORY_CONFIG_PRESETS)) {
        await showText(
          ctx,
          'Memory preset',
          [
            'Usage: /memory-preset <minimal|balanced|full>',
            '',
            'Presets:',
            '- minimal: keep only prompt injection enabled',
            '- balanced: practical daily-driver defaults',
            '- full: all automatic features enabled',
          ].join('\n'),
        );
        return;
      }

      await applyMemoryPreset(ctx, presetName);
    },
  });

  pi.registerCommand('memory-reset', {
    description: 'Reset memory config to default values',
    handler: async (_args: string, ctx: PiContextLike) => {
      await resetMemoryConfig(ctx);
    },
  });

  pi.registerCommand('memory', {
    description: 'Show memory status/help or run a memory subcommand',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const { command, rest } = splitMemoryCommandArgs(args);

      switch (command) {
        case '':
        case 'help':
        case 'status':
        case 'config': {
          const status = await getMemoryStatus({ repoRoot });
          await showText(ctx, 'Memory', formatMemoryOverview(status, repoRoot, activeTask?.taskId, getConfigForRepo(repoRoot)));
          return;
        }

        case 'settings': {
          await showMemorySettingsUI(ctx, pi.events);
          return;
        }

        case 'enable': {
          saveConfigForRepo(repoRoot, { enabled: true });
          await refreshMemoryUi(ctx, repoRoot);
          await ctx.ui?.notify?.('Automatic memory hooks enabled.', 'info');
          return;
        }

        case 'disable': {
          saveConfigForRepo(repoRoot, { enabled: false });
          await refreshMemoryUi(ctx, repoRoot);
          await ctx.ui?.notify?.('Automatic memory hooks disabled. Manual commands and tools still work.', 'info');
          return;
        }

        case 'preset': {
          const presetName = rest.toLowerCase() as 'minimal' | 'balanced' | 'full';
          if (!presetName || !(presetName in MEMORY_CONFIG_PRESETS)) {
            await showText(ctx, 'Memory preset', 'Usage: /memory preset <minimal|balanced|full>');
            return;
          }

          await applyMemoryPreset(ctx, presetName);
          return;
        }

        case 'reset': {
          await resetMemoryConfig(ctx);
          return;
        }

        case 'search': {
          const { status, hits } = await searchProjectMemory({
            repoRoot,
            query: rest || activeTask?.title || 'recent project memory',
            limit: 8,
            taskId: activeTask?.taskId,
            cwd: getCwd(ctx),
          });

          await showText(
            ctx,
            'Memory search',
            status.available ? formatMemoryHits(hits) : formatMemoryUnavailable(status, repoRoot, activeTask?.taskId),
          );
          return;
        }

        case 'inspect': {
          const { status, facts } = await inspectMemoryFacts({
            repoRoot,
            input: {
              scopeType: 'project',
              scopeId: toProjectId(repoRoot),
            },
          });

          await showText(
            ctx,
            'Active memory facts',
            status.available ? formatFactList(facts) : formatMemoryUnavailable(status, repoRoot, activeTask?.taskId),
          );
          return;
        }

        case 'why': {
          const query = rest || activeTask?.title || 'current context';
          const memory = await buildPromptMemory({
            repoRoot,
            query,
            cwd: getCwd(ctx),
            taskId: activeTask?.taskId,
            limit: 8,
          });

          if (!memory.status.available) {
            await showText(ctx, 'Memory why', formatMemoryUnavailable(memory.status, repoRoot, activeTask?.taskId));
            return;
          }

          await showText(
            ctx,
            'Memory why',
            [
              `Query: ${query}`,
              '',
              activeTask ? `Active task: ${activeTask.taskId}` : 'Active task: none',
              '',
              'Matches:',
              formatMemoryHits(memory.hits),
              '',
              'Prompt block:',
              memory.promptBlock || 'No prompt memory block generated.',
            ].join('\n'),
          );
          return;
        }

        default:
          await showText(
            ctx,
            'Memory',
            [
              `Unknown memory subcommand: ${command}`,
              '',
              formatMemoryOverview(await getMemoryStatus({ repoRoot }), repoRoot, activeTask?.taskId),
            ].join('\n'),
          );
      }
    },
  });

  pi.registerCommand('memory-remember', {
    description: 'Capture an explicit user memory note into the project store',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const note = args.trim() || (await ctx.ui?.input?.('Remember what?', 'e.g. Always use pnpm test'))?.trim();
      if (!note) {
        await ctx.ui?.notify?.('No memory note provided.', 'warning');
        return;
      }

      const { status, result } = await saveExplicitMemory({
        ctx,
        note,
        sourceName: 'memory-remember',
        sourceType: 'user_message',
        actor: 'user',
      });

      if (!status.available || !result) {
        await showText(ctx, 'Memory remember', formatMemoryUnavailable(status, repoRoot, getActiveTask(repoRoot)?.taskId));
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
      const factId = args.trim() || (await ctx.ui?.input?.('Forget which fact id?', 'fact_xxx'))?.trim();
      if (!factId) {
        await ctx.ui?.notify?.('No fact id provided.', 'warning');
        return;
      }

      const status = await getMemoryStatus({ repoRoot });
      if (!status.available) {
        await showText(ctx, 'Memory forget', formatMemoryUnavailable(status, repoRoot, getActiveTask(repoRoot)?.taskId));
        return;
      }

      const fact = await getMemoryFactById({ repoRoot, factId });
      if (!fact) {
        await ctx.ui?.notify?.(`Fact not found: ${factId}`, 'warning');
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

  pi.registerCommand('memory-clear-task', {
    description: 'Clear the active task pointer without modifying saved memory facts',
    handler: async (_args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      clearActiveTask({ repoRoot });
      const config = getConfigForRepo(repoRoot);
      await refreshMemoryUi(ctx, repoRoot, config);
      await ctx.ui?.notify?.('Cleared active task pointer.', 'info');
    },
  });

  pi.registerCommand('memory-hook-debug', {
    description: 'Show captured Pi hook payloads for runtime payload verification',
    handler: async (args: string, ctx: PiContextLike) => {
      const repoRoot = getRepoRoot(ctx);
      const requestedHook = args.trim() || undefined;
      const hook = requestedHook && DEBUG_HOOKS.includes(requestedHook) ? requestedHook : undefined;
      const records = readHookDebug({ repoRoot, hook, limit: 10 });
      await showText(ctx, 'Memory hook debug', formatHookDebug(records));
    },
  });

  pi.registerTool({
    name: 'memory_remember',
    label: 'Memory Remember',
    description: 'Propose a stable project memory note and ask the user for confirmation before saving it.',
    promptSnippet: 'Save stable user preferences, project rules, or confirmed lessons to memory after asking for confirmation.',
    promptGuidelines: [
      'Use this tool only for durable information worth reusing later, not for temporary context.',
      'Prefer canonical phrasing such as "Project rule: ...", "Always ...", "Do not ...", or "Lesson learned: ... Root cause: ... Fix: ...".',
      'Do not claim a note was remembered durably unless this tool actually saved it.',
      'For lessons, include both root cause and fix in a concise note so it stays actionable and searchable.',
      'Avoid vague notes that the extractor cannot turn into searchable facts.',
    ],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: 'Canonical memory note to save.' },
        category: {
          type: 'string',
          enum: ['rule', 'preference', 'lesson', 'knowledge'],
          description: 'Memory category used for metadata and prompting.',
        },
        requireConfirmation: {
          type: 'boolean',
          description: 'Whether the user must confirm before saving. Defaults to true.',
        },
      },
      required: ['note'],
    },
    execute: async (
      _toolCallId: string,
      params: MemoryRememberToolParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx?: PiContextLike,
    ): Promise<PiToolCallResult> => {
      const requireConfirmation = params.requireConfirmation !== false;
      if (requireConfirmation) {
        if (typeof ctx?.ui?.confirm !== 'function') {
          return {
            content: [{ type: 'text', text: 'Memory was not saved because confirmation UI is unavailable.' }],
            details: {
              saved: false,
              reason: 'confirmation_unavailable',
            },
          };
        }

        const confirmed = await ctx.ui.confirm(
          'Save to memory?',
          [`Category: ${params.category ?? 'preference'}`, '', params.note].join('\n'),
        );
        if (!confirmed) {
          return {
            content: [{ type: 'text', text: 'User declined to save that memory note.' }],
            details: {
              saved: false,
              reason: 'user_declined',
            },
          };
        }
      }

      const sourceType = params.category === 'lesson' ? 'memory_note' : 'agent_memory_proposal';
      const { status, result } = await saveExplicitMemory({
        ctx,
        note: params.note,
        sourceName: 'memory_remember_tool',
        sourceType,
        actor: requireConfirmation ? 'user' : 'agent',
        metadata: {
          category: params.category ?? 'preference',
          confirmedByUser: requireConfirmation,
        },
      });

      return {
        content: [{
          type: 'text',
          text: status.available && result
            ? `Saved memory note (${result.facts.length} facts updated).`
            : `Memory unavailable: ${status.summary}`,
        }],
        details: {
          saved: status.available && Boolean(result),
          status,
          result,
        },
      };
    },
  });

  pi.registerTool({
    name: 'memory_search',
    label: 'Memory Search',
    description: 'Search the local project memory store for relevant facts.',
    promptSnippet: 'Search saved project memory before re-deriving stable rules, preferences, or previously fixed issues.',
    promptGuidelines: [
      'Use this tool before assuming a project rule, prior fix, or saved lesson already exists.',
      'If no results are returned, say that no relevant saved memory was found instead of implying memory exists.',
      'Use focused queries that mention the issue, subsystem, or canonical rule wording.',
    ],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What to search in memory.' },
        limit: { type: 'number', description: 'Maximum facts to return.', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
    execute: async (
      _toolCallId: string,
      params: { query: string; limit?: number },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx?: PiContextLike,
    ): Promise<PiToolCallResult> => {
      const repoRoot = getRepoRoot(ctx);
      const activeTask = getActiveTask(repoRoot);
      const { status, hits } = await searchProjectMemory({
        repoRoot,
        query: params.query,
        limit: params.limit ?? 5,
        taskId: activeTask?.taskId,
        cwd: getCwd(ctx),
      });

      return {
        content: [{ type: 'text', text: status.available ? formatMemoryHits(hits) : `Memory unavailable: ${status.summary}` }],
        details: {
          repoRoot,
          activeTask,
          hits,
          status,
        },
      };
    },
  });
}

function getRepoRoot(ctx?: PiContextLike): string {
  return detectRepoRoot(getCwd(ctx));
}

function getConfigForRepo(repoRoot: string): MemoryExtensionConfig {
  const state = getMemoryExtensionRuntimeState();
  const cached = state.configByRepo[repoRoot];
  if (cached) {
    return cached;
  }

  const loaded = readMemoryExtensionConfig({ repoRoot });
  state.configByRepo[repoRoot] = loaded;
  return loaded;
}

function saveConfigForRepo(repoRoot: string, patch: Partial<MemoryExtensionConfig>): MemoryExtensionConfig {
  const next = updateMemoryExtensionConfig({ repoRoot, patch });
  getMemoryExtensionRuntimeState().configByRepo[repoRoot] = next;
  return next;
}

function replaceConfigForRepo(repoRoot: string, config: MemoryExtensionConfig): MemoryExtensionConfig {
  const next = updateMemoryExtensionConfig({
    repoRoot,
    patch: config,
  });
  getMemoryExtensionRuntimeState().configByRepo[repoRoot] = next;
  return next;
}

function getMemoryPresetName(config: MemoryExtensionConfig): 'minimal' | 'balanced' | 'full' | 'custom' {
  for (const [name, preset] of Object.entries(MEMORY_CONFIG_PRESETS) as Array<[
    'minimal' | 'balanced' | 'full',
    MemoryExtensionConfig,
  ]>) {
    const matches = Object.entries(preset).every(([key, value]) => config[key as keyof MemoryExtensionConfig] === value);
    if (matches) {
      return name;
    }
  }

  return 'custom';
}

function summarizeEnabledAutoFeatures(config: MemoryExtensionConfig): string[] {
  const flags: Array<[keyof MemoryExtensionConfig, string]> = [
    ['autoInjectPromptMemory', 'inject'],
    ['autoRewriteHashMemory', '#memory'],
    ['autoCaptureToolEvents', 'tools'],
    ['autoSaveCheckpoints', 'checkpoints'],
    ['autoDetectDurableMemory', 'durable'],
    ['autoSaveTrapLessons', 'lessons'],
    ['captureHookDebug', 'debug'],
  ];

  return flags
    .filter(([key]) => config[key])
    .map(([, label]) => label);
}

function formatMemoryIndicator(config: MemoryExtensionConfig, detail?: string): string {
  const base = `🧠 memory ${config.enabled ? 'auto:on' : 'auto:off'}`;
  const normalizedDetail = detail
    ?.replace(/^memory:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedDetail
    ? `${base} · ${normalizedDetail} · /memory settings`
    : `${base} · /memory settings`;
}

function formatEditorMemoryIndicator(config: MemoryExtensionConfig, detail?: string): string {
  const base = `🧠 memory ${config.enabled ? 'auto:on' : 'auto:off'}`;
  const normalizedDetail = detail
    ?.replace(/^memory:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedDetail ? `${base} · ${normalizedDetail}` : base;
}

function syncEditorStatusSegment(eventBus: PiEventBusLike | undefined, text: string | undefined): void {
  if (!eventBus?.emit) {
    return;
  }

  if (!text) {
    clearEditorStatusSegment(eventBus);
    return;
  }

  eventBus.emit(EDITOR_SET_STATUS_SEGMENT_EVENT, {
    key: EDITOR_STATUS_SEGMENT_KEY,
    text,
    align: 'left',
    priority: 20,
  });
}

function clearEditorStatusSegment(eventBus: PiEventBusLike | undefined): void {
  eventBus?.emit?.(EDITOR_REMOVE_STATUS_SEGMENT_EVENT, {
    key: EDITOR_STATUS_SEGMENT_KEY,
  });
}

function syncMemoryUi(
  ctx: PiContextLike | undefined,
  repoRoot: string,
  status: MemoryStatusLike,
  taskId: string | undefined,
  config: MemoryExtensionConfig,
  eventBus?: PiEventBusLike,
): void {
  void repoRoot;
  void status;
  void taskId;
  setStatus(ctx, undefined, eventBus);
  ctx?.ui?.setWidget?.(WIDGET_KEY, undefined, { placement: 'aboveEditor' });
}

function getCwd(ctx?: PiContextLike): string | undefined {
  return ctx?.cwd ?? process.cwd();
}

function flattenTextBlocks(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function getAssistantText(message?: AgentMessageLike): string {
  if (!message || message.role !== 'assistant') {
    return '';
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

function getMemoryExtensionRuntimeState(): MemoryExtensionRuntimeState {
  const runtimeStateHost = globalThis as typeof globalThis & { [key: symbol]: MemoryExtensionRuntimeState | undefined };
  const existing = runtimeStateHost[MEMORY_EXTENSION_RUNTIME_KEY];
  if (existing) {
    existing.recentToolEventsByRepo ??= {};
    existing.pendingDurableMemoryByRepo ??= {};
    existing.savedLessonKeys ??= [];
    existing.configByRepo ??= {};
    return existing;
  }

  const created: MemoryExtensionRuntimeState = {
    active: false,
    duplicateNoticeShown: false,
    recentToolEventsByRepo: {},
    pendingDurableMemoryByRepo: {},
    savedLessonKeys: [],
    configByRepo: {},
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
  state.recentToolEventsByRepo = {};
  state.pendingDurableMemoryByRepo = {};
  state.savedLessonKeys = [];
  state.configByRepo = {};
}

function registerDuplicateLoadNoticeHooks(pi: ExtensionAPI): void {
  const notifyDuplicateLoad = async (_event: unknown, ctx: PiContextLike) => {
    const state = getMemoryExtensionRuntimeState();
    if (state.duplicateNoticeShown) {
      return;
    }

    state.duplicateNoticeShown = true;
    await ctx?.ui?.notify?.(DUPLICATE_LOAD_WARNING, 'warning');
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

function shouldSuggestMemoryUsageSkill(prompt?: string): boolean {
  if (!prompt) {
    return false;
  }

  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return false;
  }

  return [
    /\b(memory|remember|save|saved|forget|rule|preference|lesson|checkpoint|durable)\b/i,
    /\b(what did we decide before|what was decided before|previous decision|prior decision|past decision)\b/i,
    /\b(previous|prior|past)\s+(fix|issue|lesson|rule|preference|decision)s?\b/i,
    /\b(already saved|saved already|already remembered|remembered already)\b/i,
    /(đã lưu chưa|đã save chưa|đã nhớ chưa|trước đó mình đã quyết định gì|đã fix vụ này chưa)/i,
  ].some((pattern) => pattern.test(normalizedPrompt));
}

function collectCommandHints(toolResults: ToolResultLike[]): string[] {
  const commands = toolResults
    .map((result) => {
      const details = result.details as Record<string, unknown> | undefined;
      const command = details && typeof details.command === 'string' ? details.command : undefined;
      return command ?? result.toolName;
    })
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return [...new Set(commands)];
}

function recordRecentToolEvent(repoRoot: string, event: RecentToolEvent): void {
  const state = getMemoryExtensionRuntimeState();
  const existing = state.recentToolEventsByRepo[repoRoot] ?? [];
  const next = [...existing, event]
    .filter((entry) => Date.now() - entry.timestamp <= 30 * 60 * 1000)
    .slice(-40);
  state.recentToolEventsByRepo[repoRoot] = next;
}

function getRecentToolEvents(repoRoot: string, taskId?: string): RecentToolEvent[] {
  const state = getMemoryExtensionRuntimeState();
  const cutoff = Date.now() - 30 * 60 * 1000;
  return (state.recentToolEventsByRepo[repoRoot] ?? []).filter((event) => {
    if (event.timestamp < cutoff) {
      return false;
    }
    if (!taskId) {
      return true;
    }
    return event.taskId === taskId;
  });
}

function getPendingDurableMemory(repoRoot: string): PendingDurableMemoryCandidate | undefined {
  const state = getMemoryExtensionRuntimeState();
  const pending = state.pendingDurableMemoryByRepo[repoRoot];
  if (!pending) {
    return undefined;
  }

  if (Date.now() - pending.createdAt > PENDING_DURABLE_MEMORY_TTL_MS) {
    delete state.pendingDurableMemoryByRepo[repoRoot];
    return undefined;
  }

  return pending;
}

function setPendingDurableMemory(repoRoot: string, candidate: DurableMemoryCandidate, awaitingUserReply = false): PendingDurableMemoryCandidate {
  const pending: PendingDurableMemoryCandidate = {
    ...candidate,
    createdAt: Date.now(),
    awaitingUserReply,
    assistantPromptAt: awaitingUserReply ? Date.now() : undefined,
  };
  getMemoryExtensionRuntimeState().pendingDurableMemoryByRepo[repoRoot] = pending;
  return pending;
}

function markPendingDurableMemoryAwaitingUserReply(repoRoot: string): PendingDurableMemoryCandidate | undefined {
  const pending = getPendingDurableMemory(repoRoot);
  if (!pending) {
    return undefined;
  }

  const next: PendingDurableMemoryCandidate = {
    ...pending,
    awaitingUserReply: true,
    assistantPromptAt: Date.now(),
  };
  getMemoryExtensionRuntimeState().pendingDurableMemoryByRepo[repoRoot] = next;
  return next;
}

function clearPendingDurableMemory(repoRoot: string): void {
  delete getMemoryExtensionRuntimeState().pendingDurableMemoryByRepo[repoRoot];
}

function normalizeMemoryKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function hasSavedLessonKey(issueKey: string): boolean {
  return getMemoryExtensionRuntimeState().savedLessonKeys.includes(issueKey);
}

function rememberSavedLessonKey(issueKey: string): void {
  const state = getMemoryExtensionRuntimeState();
  if (state.savedLessonKeys.includes(issueKey)) {
    return;
  }
  state.savedLessonKeys = [...state.savedLessonKeys, issueKey].slice(-100);
}

function extractResolvedTrapLesson(text: string): { rootCause?: string; fix?: string } | null {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return null;
  }

  const rootCause = firstDefined([
    captureSingleLine(text, /root cause[:\-]\s*(.+)/i),
    captureSingleLine(text, /trap issue[:\-]\s*(.+)/i),
    captureSingleLine(text, /the issue was\s+(.+?)(?:\.|$)/i),
    captureSingleLine(text, /it failed because\s+(.+?)(?:\.|$)/i),
  ]);
  const fix = firstDefined([
    captureSingleLine(text, /fix[:\-]\s*(.+)/i),
    captureSingleLine(text, /resolved by\s+(.+?)(?:\.|$)/i),
    captureSingleLine(text, /fixed by\s+(.+?)(?:\.|$)/i),
    captureSingleLine(text, /solution[:\-]\s*(.+)/i),
  ]);

  const looksLikeTrap = /trap issue|gotcha|pitfall|root cause|the issue was|failed because/i.test(compact);
  const looksResolved = /fixed|resolved|working now|passes now|verified/i.test(compact);

  if (!looksLikeTrap || !looksResolved || !rootCause || !fix) {
    return null;
  }

  return {
    rootCause: summarizeText(rootCause.replace(/[.]+$/, ''), 220),
    fix: summarizeText(fix.replace(/[.]+$/, ''), 220),
  };
}

function captureSingleLine(input: string, pattern: RegExp): string | undefined {
  const match = input.match(pattern);
  return match?.[1]?.split('\n')[0]?.trim();
}

function firstDefined(values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

async function inspectRelevantFacts(repoRoot: string, taskId?: string) {
  const projectFactsResult = await inspectMemoryFacts({
    repoRoot,
    input: {
      scopeType: 'project',
      scopeId: toProjectId(repoRoot),
    },
  });

  if (!projectFactsResult.status.available) {
    return projectFactsResult;
  }

  if (!taskId) {
    return projectFactsResult;
  }

  const taskFactsResult = await inspectMemoryFacts({
    repoRoot,
    input: {
      scopeType: 'task',
      scopeId: taskId,
    },
  });

  if (!taskFactsResult.status.available) {
    return {
      status: taskFactsResult.status,
      facts: [] as MemoryFactRecord[],
    };
  }

  return {
    status: projectFactsResult.status,
    facts: dedupeFactsById([...projectFactsResult.facts, ...taskFactsResult.facts]),
  };
}

function dedupeFactsById(facts: MemoryFactRecord[]): MemoryFactRecord[] {
  const seen = new Set<string>();
  const deduped: MemoryFactRecord[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) {
      continue;
    }
    seen.add(fact.id);
    deduped.push(fact);
  }
  return deduped;
}

function isRuleLikeFact(fact: MemoryFactRecord): boolean {
  if (fact.factType === 'rule' || fact.factType === 'preference') {
    return true;
  }

  return ['preferred_workflow', 'forbidden_workflow', 'project_rule'].includes(fact.predicate);
}

function filterMemoryFactsByQuery(facts: MemoryFactRecord[], query: string): MemoryFactRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return facts;
  }

  return facts.filter((fact) => {
    const haystack = [
      fact.factText,
      fact.predicate,
      fact.objectValue,
      fact.tags.join(' '),
      fact.scopeType,
      fact.scopeId,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(needle);
  });
}

function formatFocusedFacts(facts: MemoryFactRecord[], label: 'lesson' | 'rule'): string {
  if (facts.length === 0) {
    return label === 'lesson' ? 'No saved lessons found.' : 'No saved rules found.';
  }

  return facts
    .map((fact, index) => {
      const tags = fact.tags.length > 0 ? ` tags=${fact.tags.join(',')}` : '';
      const task = fact.taskId ? ` task=${fact.taskId}` : '';
      return `${index + 1}. [${fact.factType}] ${fact.factText}\n   scope=${fact.scopeType}:${fact.scopeId}${task}${tags}`;
    })
    .join('\n');
}

function splitMemoryCommandArgs(args: string): { command: string; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { command: '', rest: '' };
  }

  const [command, ...restParts] = trimmed.split(/\s+/);
  return {
    command: command.toLowerCase(),
    rest: restParts.join(' ').trim(),
  };
}

function isAffirmativeReply(input: string): boolean {
  const cleaned = stripTrailingPunctuation(input).replace(/[,]+$/g, '').trim().toLowerCase();
  if (!cleaned) {
    return false;
  }

  if (/^(?:lưu|luu)(?:\s+(?:đi|di|giúp|giup|hộ|ho|nhé|nhe|luôn|luon))?$/.test(cleaned)) {
    return true;
  }

  if (/^(?:save|remember)(?:\s+it)?$/.test(cleaned)) {
    return true;
  }

  if (/^(?:ok|okay|sure|yes|y|có|co|ừ|uh|uk|được|duoc)\b.*\b(?:lưu|luu|save|remember)\b/.test(cleaned)) {
    return true;
  }

  return [
    'yes',
    'y',
    'ok',
    'okay',
    'sure',
    'please do',
    'do it',
    'save',
    'save it',
    'remember',
    'có',
    'co',
    'ừ',
    'uh',
    'uk',
    'được',
    'duoc',
    'ok lưu',
    'lưu đi',
    'luu di',
  ].includes(cleaned);
}

function isNegativeReply(input: string): boolean {
  const cleaned = stripTrailingPunctuation(input).replace(/[,]+$/g, '').trim().toLowerCase();
  if (!cleaned) {
    return false;
  }

  return ['no', 'n', 'nope', 'not now', 'không', 'khong', 'thôi', 'thoi', 'khỏi', 'khoi'].includes(cleaned);
}

function looksLikeAssistantMemorySaveOffer(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return false;
  }

  const mentionsMemorySave = /(?:save|remember).{0,80}(?:project memory|durable memory)|(?:lưu|nhớ).{0,80}(?:project memory|durable memory|memory|bộ nhớ)/i.test(compact);
  const asksPermission = /\?$/.test(compact) || /do you want|would you like|should i|shall i|có muốn|muốn mình|muon minh|để áp dụng|de ap dung/i.test(compact);
  return mentionsMemorySave && asksPermission;
}

function extractDurableMemoryCandidateFromAssistantOffer(text: string): DurableMemoryCandidate | null {
  if (!looksLikeAssistantMemorySaveOffer(text)) {
    return null;
  }

  const quotedNote = firstDefined([
    captureSingleLine(text, /["“](.+?)["”]/),
    captureSingleLine(text, /'([^']+)'/),
    captureSingleLine(text, /`([^`]+)`/),
  ]);
  if (!quotedNote) {
    return null;
  }

  return detectDurableMemoryCandidate(quotedNote) ?? {
    note: normalizeExplicitMemoryNote(quotedNote),
    category: 'rule',
    trigger: 'assistant-offer',
  };
}

function detectDurableMemoryCandidate(input: string): DurableMemoryCandidate | null {
  const cleaned = input.replace(/#memory/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.startsWith('/')) {
    return null;
  }

  const lower = cleaned.toLowerCase();
  const isExplicitRemember = /^(?:please\s+)?remember(?:\s+that)?\b|^(?:hãy\s+)?nhớ(?:\s+rằng|\s+là)?\b/i.test(cleaned);
  if (!isExplicitRemember && /\?\s*$/.test(cleaned)) {
    return null;
  }

  const rememberMatch = firstDefined([
    captureSingleLine(cleaned, /^(?:please\s+)?remember(?:\s+that)?\s+(.+)/i),
    captureSingleLine(cleaned, /^(?:hãy\s+)?nhớ(?:\s+rằng|\s+là)?\s+(.+)/i),
  ]);
  if (rememberMatch) {
    return detectDurableMemoryCandidate(rememberMatch) ?? {
      note: toProjectRuleNote(rememberMatch),
      category: 'rule',
      trigger: 'remember',
    };
  }

  if (/^(always use|never use)\b/i.test(cleaned)) {
    return {
      note: ensureSentence(capitalizeFirst(cleaned)),
      category: 'rule',
      trigger: lower.startsWith('always use') ? 'always-use' : 'never-use',
    };
  }

  if (/^(always|never|prefer|do not|don't)\b/i.test(cleaned)) {
    const category = /^(prefer)\b/i.test(cleaned) ? 'preference' : 'rule';
    return {
      note: ensureSentence(capitalizeFirst(cleaned)),
      category,
      trigger: cleaned.split(/\s+/)[0]!.toLowerCase(),
    };
  }

  if (/^(must|need to|have to)\b/i.test(cleaned)) {
    return {
      note: toProjectRuleNote(cleaned),
      category: 'rule',
      trigger: cleaned.split(/\s+/)[0]!.toLowerCase(),
    };
  }

  if (/^(luôn|đừng|không được|ưu tiên)\b/i.test(cleaned)) {
    return {
      note: toProjectRuleNote(cleaned),
      category: /^ưu tiên\b/i.test(cleaned) ? 'preference' : 'rule',
      trigger: cleaned.split(/\s+/)[0]!.toLowerCase(),
    };
  }

  if (/^(phải|cần|bắt buộc|nên)\b/i.test(cleaned)) {
    return {
      note: toProjectRuleNote(cleaned),
      category: /^nên\b/i.test(cleaned) ? 'preference' : 'rule',
      trigger: cleaned.split(/\s+/)[0]!.toLowerCase(),
    };
  }

  return null;
}

function normalizeExplicitMemoryNote(note: string): string {
  const candidate = detectDurableMemoryCandidate(note);
  if (!candidate) {
    return note.trim();
  }

  return candidate.note;
}

function toProjectRuleNote(input: string): string {
  return ensureSentence(`Project rule: ${capitalizeFirst(stripTrailingPunctuation(input))}`);
}

function stripTrailingPunctuation(input: string): string {
  return input.trim().replace(/[.。,，!！?？]+$/g, '').trim();
}

function ensureSentence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  return /[.。!！?？]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function capitalizeFirst(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
}

function formatMemoryStatusLine(status: MemoryStatusLike, repoRoot: string, taskId?: string, enabled = true): string {
  const base = status.available ? status.summary : `memory unavailable: ${status.summary}`;
  const auto = enabled ? 'auto:on' : 'auto:off';
  return taskId ? `${base} · ${auto} · task ${taskId}` : `${base} · ${auto}: ${repoRoot}`;
}

function formatMemorySettingsStatus(status: MemoryStatusLike, repoRoot: string, taskId: string | undefined, config: MemoryExtensionConfig): string {
  return formatMemoryStatusLine(status, repoRoot, taskId, config.enabled);
}

function formatMemoryStatusSummary(status: MemoryStatusLike): string {
  const suffix = status.available ? '' : ` ${summarizeDiagnosticDetails(status.details)}`;
  return `${status.summary}.${suffix}`.replace(/\.\s*$/, '.').replace(/\s+/g, ' ').trim();
}

function formatMemoryUnavailable(status: MemoryStatusLike, repoRoot: string, taskId?: string): string {
  return formatMemoryOverview(status, repoRoot, taskId, getConfigForRepo(repoRoot));
}

function formatMemoryOverview(status: MemoryStatusLike, repoRoot: string, taskId?: string, config: MemoryExtensionConfig = getConfigForRepo(repoRoot)): string {
  const lines = [
    'Memory status',
    `- Repo: ${repoRoot}`,
    taskId ? `- Active task: ${taskId}` : '- Active task: none',
    `- Available: ${status.available ? 'yes' : 'no'}`,
    `- Backend: ${status.backendKind}`,
    `- Mode: ${status.mode}`,
    `- Summary: ${status.summary}`,
    `- Automatic hooks: ${config.enabled ? 'on' : 'off'}`,
  ];

  const details = formatDiagnosticDetails(status.details);
  if (details) {
    lines.push('', 'Diagnostics:', details);
  }

  lines.push('', 'Config:', formatMemoryExtensionConfig(config));

  lines.push(
    '',
    'Commands:',
    '/memory',
    '/memory config',
    '/memory settings',
    '/memory enable',
    '/memory disable',
    '/memory search <query>',
    '/memory why <query>',
    '/memory inspect',
    '/memory-rules [query]',
    '/memory-lessons [query]',
    '/memory-remember <note>',
    '/memory-checkpoint [taskId]',
    '/memory-hook-debug [hook]',
  );

  return lines.join('\n');
}

function formatDiagnosticDetails(details: Record<string, unknown> | undefined): string {
  if (!details) {
    return '';
  }

  const lines: string[] = [];
  const reason = typeof details.reason === 'string' ? details.reason : undefined;
  if (reason) {
    lines.push(`- reason: ${reason}`);
  }

  const helperSpecs = Array.isArray(details.helperLaunchSpecs)
    ? details.helperLaunchSpecs as Array<Record<string, unknown>>
    : [];
  if (helperSpecs.length > 0) {
    lines.push('- helper launch specs:');
    for (const spec of helperSpecs.slice(0, 6)) {
      const command = typeof spec.command === 'string' ? spec.command : '(unknown command)';
      const args = Array.isArray(spec.args) ? spec.args.map((value) => String(value)).join(' ') : '';
      const source = typeof spec.source === 'string' ? ` source=${spec.source}` : '';
      const target = typeof spec.target === 'string' ? ` target=${spec.target}` : '';
      lines.push(`  - ${command}${args ? ` ${args}` : ''}${source}${target}`);
    }
  }

  const attempts = Array.isArray(details.attempts)
    ? details.attempts as Array<Record<string, unknown>>
    : [];
  if (attempts.length > 0) {
    lines.push('- launch attempts:');
    for (const attempt of attempts.slice(0, 6)) {
      const command = typeof attempt.command === 'string' ? attempt.command : '(unknown command)';
      const args = Array.isArray(attempt.args) ? attempt.args.map((value) => String(value)).join(' ') : '';
      const error = typeof attempt.error === 'string' ? attempt.error : JSON.stringify(attempt.error ?? 'unknown error');
      lines.push(`  - ${command}${args ? ` ${args}` : ''}`);
      lines.push(`    error: ${error}`);
    }
  }

  if (lines.length === 0) {
    lines.push(`- raw: ${JSON.stringify(details, null, 2)}`);
  }

  return lines.join('\n');
}

function summarizeDiagnosticDetails(details: Record<string, unknown> | undefined): string {
  if (!details) {
    return '';
  }

  if (typeof details.reason === 'string') {
    return `Reason: ${details.reason}.`;
  }

  if (Array.isArray(details.attempts) && details.attempts.length > 0) {
    const firstAttempt = details.attempts[0] as Record<string, unknown>;
    const error = typeof firstAttempt.error === 'string' ? firstAttempt.error : 'helper launch failed';
    return `First launch error: ${error}.`;
  }

  return '';
}

function extractCommand(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const command = candidate.command ?? candidate.cmd ?? candidate.args;
  return typeof command === 'string' ? command : undefined;
}

function extractErrorText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.error === 'string') {
      return candidate.error;
    }
    if (typeof candidate.message === 'string') {
      return candidate.message;
    }
    try {
      return JSON.stringify(candidate).slice(0, 500);
    } catch {
      return String(candidate);
    }
  }

  return String(value);
}

function getGitBranch(): string | undefined {
  const envBranch = process.env.GIT_BRANCH || process.env.BRANCH_NAME;
  return typeof envBranch === 'string' && envBranch.trim() ? envBranch.trim() : undefined;
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

function setStatus(ctx: PiContextLike | undefined, text: string | undefined, eventBus?: PiEventBusLike): void {
  const repoRoot = getRepoRoot(ctx);
  const config = getConfigForRepo(repoRoot);
  const footerText = config.showStatusIndicator ? formatMemoryIndicator(config, text) : undefined;
  const editorText = config.showStatusIndicator ? formatEditorMemoryIndicator(config, text) : undefined;
  ctx?.ui?.setStatus?.(STATUS_KEY, footerText);
  syncEditorStatusSegment(eventBus, editorText);
}

async function showMemorySettingsUI(ctx: PiContextLike, eventBus?: PiEventBusLike): Promise<void> {
  const repoRoot = getRepoRoot(ctx);
  const status = await getMemoryStatus({ repoRoot });
  const activeTask = getActiveTask(repoRoot);
  const config = getConfigForRepo(repoRoot);

  if (typeof ctx.ui?.custom !== 'function') {
    await showText(
      ctx,
      'Memory settings',
      [
        formatMemoryOverview(status, repoRoot, activeTask?.taskId, config),
        '',
        'Interactive TUI is unavailable in this client.',
        'Use /memory enable, /memory disable, /memory preset <minimal|balanced|full>, or /memory reset.',
      ].join('\n'),
    );
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let selected = 0;
    let current = { ...config };

    const save = async (message?: string) => {
      current = replaceConfigForRepo(repoRoot, current);
      const latestStatus = await getMemoryStatus({ repoRoot });
      syncMemoryUi(ctx, repoRoot, latestStatus, getActiveTask(repoRoot)?.taskId, current, eventBus);
      await ctx.ui?.notify?.(message ?? `Saved memory settings (${CONFIG_SETTINGS[selected]?.label ?? 'updated'}).`, 'info');
    };

    const isThemeFn = (value: unknown): value is (text: string) => string => typeof value === 'function';
    const fg = (name: string, value: string) => {
      const themeRecord = theme as Record<string, unknown>;
      return isThemeFn(themeRecord.fg) ? (themeRecord.fg as (color: string, text: string) => string)(name, value) : value;
    };
    const bold = (value: string) => {
      const themeRecord = theme as Record<string, unknown>;
      return isThemeFn(themeRecord.bold) ? (themeRecord.bold as (text: string) => string)(value) : value;
    };
    const border = (width: number) => fg('accent', '═'.repeat(Math.max(8, width)));
    const selectedSetting = () => CONFIG_SETTINGS[selected] ?? CONFIG_SETTINGS[0]!;
    const selectedValue = () => (current[selectedSetting().key] ? 'ON' : 'OFF');
    const presetName = () => getMemoryPresetName(current);
    const featureSummary = () => summarizeEnabledAutoFeatures(current).join(', ') || 'none';
    const applyPresetFromUi = async (presetName: 'minimal' | 'balanced' | 'full') => {
      current = { ...MEMORY_CONFIG_PRESETS[presetName] };
      await save(`Applied memory preset: ${presetName}.`);
    };
    const resetFromUi = async () => {
      current = { ...DEFAULT_MEMORY_EXTENSION_CONFIG };
      await save('Reset memory config to defaults.');
    };

    const component = {
      render(width: number): string[] {
        const lines: string[] = [];
        lines.push(truncateUiLine(border(width), width));
        lines.push(truncateUiLine(fg('accent', bold(' Memory extension settings ')), width));
        lines.push(truncateUiLine(`Repo: ${repoRoot}`, width));
        lines.push(truncateUiLine(`Backend: ${status.summary}`, width));
        lines.push(truncateUiLine(`Mode: ${presetName()} · auto:${current.enabled ? 'on' : 'off'} · task:${activeTask?.taskId ?? 'none'}`, width));
        lines.push(truncateUiLine(`Features: ${featureSummary()}`, width));
        lines.push(truncateUiLine(fg('dim', '[m] minimal   [b] balanced   [f] full   [r] reset'), width));
        lines.push('');

        for (const [index, item] of CONFIG_SETTINGS.entries()) {
          const value = current[item.key] ? 'ON' : 'OFF';
          const prefix = index === selected ? '▶' : '•';
          const line = `${prefix} ${item.label}`;
          const valueLabel = value === 'ON' ? fg('success', value) : fg('warning', value);
          lines.push(truncateUiLine(index === selected ? fg('accent', `${line}  [${value}]`) : `${line}  [${value}]`, width));
          lines.push(truncateUiLine(`    ${item.description}`, width));
          if (index === selected) {
            lines.push(truncateUiLine(`    Selected value: ${valueLabel}`, width));
          }
        }

        lines.push('');
        lines.push(truncateUiLine(fg('dim', '↑↓ move • space/enter toggle • e enable auto • d disable auto • esc/q close'), width));
        lines.push(truncateUiLine(fg('dim', 'Tip: use presets first, then fine-tune individual toggles.'), width));
        lines.push(truncateUiLine(border(width), width));
        return lines;
      },
      invalidate(): void {},
      handleInput(data: string): void {
        if (matchesSimpleKey(data, 'up')) {
          selected = selected > 0 ? selected - 1 : CONFIG_SETTINGS.length - 1;
          tui.requestRender();
          return;
        }
        if (matchesSimpleKey(data, 'down')) {
          selected = selected < CONFIG_SETTINGS.length - 1 ? selected + 1 : 0;
          tui.requestRender();
          return;
        }
        if (matchesSimpleKey(data, 'escape') || data === 'q') {
          done(undefined);
          return;
        }
        if (data === 'm') {
          void applyPresetFromUi('minimal');
          tui.requestRender();
          return;
        }
        if (data === 'b') {
          void applyPresetFromUi('balanced');
          tui.requestRender();
          return;
        }
        if (data === 'f') {
          void applyPresetFromUi('full');
          tui.requestRender();
          return;
        }
        if (data === 'r') {
          void resetFromUi();
          tui.requestRender();
          return;
        }
        if (data === 'e') {
          current = { ...current, enabled: true };
          void save('Enabled automatic memory hooks.');
          tui.requestRender();
          return;
        }
        if (data === 'd') {
          current = { ...current, enabled: false };
          void save('Disabled automatic memory hooks. Manual commands still work.');
          tui.requestRender();
          return;
        }
        if (matchesSimpleKey(data, 'enter') || data === ' ') {
          const item = CONFIG_SETTINGS[selected];
          current = {
            ...current,
            [item.key]: !current[item.key],
          };
          void save();
          tui.requestRender();
        }
      },
    };

    return component;
  });
}

function matchesSimpleKey(data: string, key: 'up' | 'down' | 'enter' | 'escape'): boolean {
  switch (key) {
    case 'up':
      return data === '\u001b[A' || data === '\u001bOA';
    case 'down':
      return data === '\u001b[B' || data === '\u001bOB';
    case 'enter':
      return data === '\r' || data === '\n';
    case 'escape':
      return data === '\u001b';
  }
}

function truncateUiLine(input: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  return input.length <= width ? input : `${input.slice(0, Math.max(0, width - 1))}…`;
}
