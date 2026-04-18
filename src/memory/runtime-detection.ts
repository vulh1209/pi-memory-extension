export type MemoryRuntime =
  | { kind: 'desktop'; helperPath?: string; helperArgs: string[] }
  | { kind: 'local' };

export function parseHelperArgsEnv(): string[] {
  const raw = process.env.PI_MEMORY_HELPER_ARGS;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function detectMemoryRuntime(): MemoryRuntime {
  if (process.env.PI_MEMORY_FORCE_DESKTOP === '1' || Boolean(process.versions.electron)) {
    return {
      kind: 'desktop',
      helperPath: process.env.PI_MEMORY_HELPER_PATH || undefined,
      helperArgs: parseHelperArgsEnv(),
    };
  }

  return { kind: 'local' };
}

export function resolveHelperPath(runtime: MemoryRuntime): string | undefined {
  return runtime.kind === 'desktop' ? runtime.helperPath : undefined;
}
