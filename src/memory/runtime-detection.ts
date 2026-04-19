import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HelperLaunchSpec = {
  command: string;
  args: string[];
  source: 'env' | 'auto';
  target?: string;
};

export type MemoryRuntime =
  | { kind: 'desktop'; helperLaunchSpecs: HelperLaunchSpec[] }
  | { kind: 'local' };

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HELPER_ENTRY = resolve(RUNTIME_DIR, 'helper-entry.ts');

function isScriptEntry(value: string): boolean {
  return /\.(?:[cm]?js|ts)$/i.test(value);
}

function ensureScriptArgs(scriptPath: string, args: string[]): string[] {
  if (args.includes(scriptPath)) {
    return args;
  }

  return [...args, scriptPath];
}

function addExistingFileCandidate(candidates: Set<string>, value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || !existsSync(trimmed)) {
    return;
  }

  candidates.add(trimmed);
}

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

function resolveBundledHelperArgs(): string[] {
  return existsSync(DEFAULT_HELPER_ENTRY) ? ['--experimental-strip-types', DEFAULT_HELPER_ENTRY] : [];
}

function collectKnownNodeCandidates(): string[] {
  const candidates = new Set<string>();

  const addCandidate = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }

    candidates.add(trimmed);
  };

  addCandidate(process.execPath);
  addCandidate(process.argv0);
  addCandidate(process.env.NODE);

  const execDir = dirname(process.execPath);
  addExistingFileCandidate(candidates, join(execDir, 'node'));
  addExistingFileCandidate(candidates, join(execDir, 'bin', 'node'));

  const resourcesDir = resolve(execDir, '..', 'Resources');
  addExistingFileCandidate(candidates, join(resourcesDir, 'bin', 'node'));
  addExistingFileCandidate(candidates, join(resourcesDir, 'app', 'bin', 'node'));
  addExistingFileCandidate(candidates, join(resourcesDir, 'app.asar.unpacked', 'bin', 'node'));

  const homeDir = process.env.HOME?.trim();
  if (homeDir) {
    const voltaNode = join(homeDir, '.volta', 'bin', 'node');
    if (existsSync(voltaNode)) {
      addCandidate(voltaNode);
    }

    const nvmVersionsDir = join(homeDir, '.nvm', 'versions', 'node');
    if (existsSync(nvmVersionsDir)) {
      const versionDirs = readdirSync(nvmVersionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();

      for (const versionDir of versionDirs) {
        const candidate = join(nvmVersionsDir, versionDir, 'bin', 'node');
        if (existsSync(candidate)) {
          addCandidate(candidate);
          break;
        }
      }
    }
  }

  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (existsSync(candidate)) {
      addCandidate(candidate);
    }
  }

  addCandidate('node');
  return [...candidates];
}

export function getHelperLaunchSpecs(runtime: MemoryRuntime): HelperLaunchSpec[] {
  if (runtime.kind !== 'desktop') {
    return [];
  }

  return runtime.helperLaunchSpecs;
}

export function detectMemoryRuntime(): MemoryRuntime {
  if (process.env.PI_MEMORY_FORCE_DESKTOP === '1' || Boolean(process.versions.electron)) {
    const helperLaunchSpecs: HelperLaunchSpec[] = [];
    const helperPath = process.env.PI_MEMORY_HELPER_PATH?.trim();
    const helperCommand = process.env.PI_MEMORY_HELPER_COMMAND?.trim();
    const explicitArgs = parseHelperArgsEnv();
    const fallbackArgs = resolveBundledHelperArgs();
    const nodeCandidates = collectKnownNodeCandidates();

    const addSpec = (spec: HelperLaunchSpec) => {
      const key = `${spec.command}\u0000${JSON.stringify(spec.args)}`;
      const seen = new Set(helperLaunchSpecs.map((entry) => `${entry.command}\u0000${JSON.stringify(entry.args)}`));
      if (seen.has(key)) {
        return;
      }
      helperLaunchSpecs.push(spec);
    };

    if (helperCommand && !helperPath) {
      addSpec({
        command: helperCommand,
        args: explicitArgs.length > 0 ? explicitArgs : fallbackArgs,
        source: 'env',
      });
    }

    if (helperPath) {
      if (isScriptEntry(helperPath)) {
        const scriptArgs = explicitArgs.length > 0
          ? ensureScriptArgs(helperPath, explicitArgs)
          : ['--experimental-strip-types', helperPath];
        const commands = helperCommand ? [helperCommand] : nodeCandidates;
        for (const command of commands) {
          addSpec({
            command,
            args: scriptArgs,
            source: 'env',
            target: helperPath,
          });
        }
      } else {
        addSpec({
          command: helperCommand || helperPath,
          args: explicitArgs.length > 0 ? explicitArgs : fallbackArgs,
          source: 'env',
          target: helperPath,
        });
      }
    }

    if (process.env.PI_MEMORY_DISABLE_AUTO_HELPER !== '1') {
      const autoArgs = explicitArgs.length > 0 ? explicitArgs : fallbackArgs;

      for (const command of nodeCandidates) {
        addSpec({
          command,
          args: autoArgs,
          source: 'auto',
          target: DEFAULT_HELPER_ENTRY,
        });
      }
    }

    return { kind: 'desktop', helperLaunchSpecs };
  }

  return { kind: 'local' };
}

export function resolveHelperPath(runtime: MemoryRuntime): string | undefined {
  return getHelperLaunchSpecs(runtime)[0]?.command;
}
