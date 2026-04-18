export type MemoryBackendKind = 'local' | 'rpc' | 'unavailable';
export type MemoryBackendMode = 'shared' | 'fallback-isolated' | 'unavailable';

export interface MemoryBackendStatus {
  available: boolean;
  backendKind: MemoryBackendKind;
  mode: MemoryBackendMode;
  summary: string;
  details?: Record<string, unknown>;
}

export function availableStatus(
  summary: string,
  backendKind: Exclude<MemoryBackendKind, 'unavailable'>,
  mode: Exclude<MemoryBackendMode, 'unavailable'> = 'shared',
  details?: Record<string, unknown>,
): MemoryBackendStatus {
  return {
    available: true,
    backendKind,
    mode,
    summary,
    details,
  };
}

export function unavailableStatus(summary: string, details?: Record<string, unknown>): MemoryBackendStatus {
  return {
    available: false,
    backendKind: 'unavailable',
    mode: 'unavailable',
    summary,
    details,
  };
}
