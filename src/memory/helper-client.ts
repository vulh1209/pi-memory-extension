import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { HelperRequest, HelperResponse } from './helper-protocol.ts';
import { isHelperErrorResponse } from './helper-protocol.ts';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type HelperClientOptions = {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function createTimeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'HelperTimeoutError';
  return error;
}

export function createHelperClient(options: HelperClientOptions) {
  const startupTimeoutMs = options.startupTimeoutMs ?? 3_500;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const args = options.args ?? [];
  let child: ChildProcessWithoutNullStreams | null = null;
  let startPromise: Promise<ChildProcessWithoutNullStreams> | null = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const recentStderr: string[] = [];
  const pending = new Map<string, PendingRequest>();

  const rememberStderr = (chunk: string) => {
    stderrBuffer += chunk;
    const lines = stderrBuffer
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    stderrBuffer = chunk.endsWith('\n') ? '' : (lines.pop() ?? '');
    if (lines.length === 0) {
      return;
    }

    recentStderr.push(...lines);
    if (recentStderr.length > 12) {
      recentStderr.splice(0, recentStderr.length - 12);
    }
  };

  const formatRecentStderr = () => {
    if (recentStderr.length === 0) {
      return '';
    }

    return ` | stderr: ${recentStderr.slice(-3).join(' | ')}`;
  };

  const createHelperError = (message: string) => new Error(`${message}${formatRecentStderr()}`);

  const rejectAll = (error: Error) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      request.reject(error);
      pending.delete(id);
    }
  };

  const handleLine = (line: string) => {
    if (!line.trim()) {
      return;
    }

    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch {
      rejectAll(createHelperError(`helper emitted invalid JSON: ${line.slice(0, 200)}`));
      return;
    }

    const request = pending.get(response.id);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    pending.delete(response.id);

    if (isHelperErrorResponse(response)) {
      request.reject(createHelperError(response.error.message));
      return;
    }

    request.resolve(response.result);
  };

  const ensureStarted = async (): Promise<ChildProcessWithoutNullStreams> => {
    if (child && !child.killed) {
      return child;
    }

    if (startPromise) {
      return startPromise;
    }

    startPromise = new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      const spawned = spawn(options.command, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          ...options.env,
        },
        cwd: process.cwd(),
      });

      const startupTimer = setTimeout(() => {
        spawned.kill();
        reject(createHelperError(`helper startup timeout after ${startupTimeoutMs}ms for ${options.command}`));
      }, startupTimeoutMs);

      const cleanupStartup = () => {
        clearTimeout(startupTimer);
        startPromise = null;
      };

      spawned.stdout.setEncoding('utf8');
      spawned.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let newlineIndex = stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          handleLine(line);
          newlineIndex = stdoutBuffer.indexOf('\n');
        }
      });

      spawned.stderr.setEncoding('utf8');
      spawned.stderr.on('data', (chunk: string) => {
        rememberStderr(chunk);
        // keep stderr attached for diagnostics while reserving stdout for protocol.
      });

      spawned.once('spawn', () => {
        child = spawned;
        cleanupStartup();
        resolve(spawned);
      });

      spawned.once('error', (error) => {
        cleanupStartup();
        reject(createHelperError(error instanceof Error ? error.message : String(error)));
      });

      spawned.once('exit', (code, signal) => {
        child = null;
        cleanupStartup();
        rejectAll(createHelperError(`helper exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      });
    });

    return startPromise;
  };

  const call = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const processRef = await ensureStarted();
    const id = randomUUID();
    const request: HelperRequest = { id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(createHelperError(`helper request timeout for ${method} after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);

      pending.set(id, { resolve, reject, timer });
      processRef.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
    });
  };

  const dispose = async (): Promise<void> => {
    rejectAll(new Error('helper client disposed'));
    if (!child || child.killed) {
      child = null;
      startPromise = null;
      return;
    }

    const processRef = child;
    child = null;
    startPromise = null;
    processRef.kill();
  };

  return {
    call,
    dispose,
  };
}
