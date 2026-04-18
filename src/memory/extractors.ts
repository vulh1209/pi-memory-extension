import type { CandidateFact, EpisodeRecord, FactType, ScopeType, TrustLevel } from './types.ts';
import { normalizeText } from './utils.ts';

function makeFactKey(scopeType: ScopeType, scopeId: string, predicate: string, suffix?: string): string {
  return [scopeType, scopeId, predicate, suffix].filter(Boolean).join('::');
}

function candidate(params: {
  episode: EpisodeRecord;
  factType: FactType;
  predicate: string;
  factText: string;
  objectValue?: string;
  factKey: string;
  confidence: number;
  trustLevel: TrustLevel;
  tags?: string[];
  sourceType?: string;
  sourceRef?: string;
}): CandidateFact {
  return {
    projectId: params.episode.projectId,
    factType: params.factType,
    scopeType: params.episode.scopeType,
    scopeId: params.episode.scopeId,
    taskId: params.episode.taskId,
    factText: params.factText,
    normalizedFact: normalizeText(params.factText),
    predicate: params.predicate,
    objectValue: params.objectValue,
    factKey: params.factKey,
    confidence: params.confidence,
    trustLevel: params.trustLevel,
    sourceType: params.sourceType,
    sourceRef: params.sourceRef,
    tags: params.tags,
    validFrom: params.episode.observedAt ?? params.episode.recordedAt,
  };
}

export function extractCandidateFacts(episode: EpisodeRecord): CandidateFact[] {
  const results: CandidateFact[] = [];
  const metadata = episode.metadata ?? {};
  const content = episode.content;

  if (episode.sourceType === 'user_message') {
    const alwaysMatch = content.match(/always use\s+(.+)/i);
    if (alwaysMatch) {
      const workflow = alwaysMatch[1].trim().replace(/[.]+$/, '');
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'preferred_workflow',
          factText: `Always use ${workflow}.`,
          objectValue: workflow,
          factKey: makeFactKey(episode.scopeType, episode.scopeId, 'preferred_workflow'),
          confidence: 0.95,
          trustLevel: 'human',
          tags: ['user-correction', 'workflow'],
          sourceType: 'user_instruction',
        }),
      );
    }

    const neverMatch = content.match(/never use\s+(.+)/i);
    if (neverMatch) {
      const workflow = neverMatch[1].trim().replace(/[.]+$/, '');
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'forbidden_workflow',
          factText: `Never use ${workflow}.`,
          objectValue: workflow,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'forbidden_workflow',
            normalizeText(workflow),
          ),
          confidence: 0.97,
          trustLevel: 'human',
          tags: ['user-correction', 'forbidden'],
          sourceType: 'user_instruction',
        }),
      );
    }
  }

  if (episode.sourceType === 'tool_run') {
    const command = typeof metadata.command === 'string' ? metadata.command : undefined;
    const success = metadata.success === true;
    const error = typeof metadata.error === 'string' ? metadata.error : undefined;

    if (success && command) {
      results.push(
        candidate({
          episode,
          factType: 'knowledge',
          predicate: 'working_command_variant',
          factText: `Command works: ${command}`,
          objectValue: command,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'working_command_variant',
            normalizeText(command),
          ),
          confidence: 0.82,
          trustLevel: 'high',
          tags: ['tool-success', 'command'],
          sourceType: 'tool_result',
          sourceRef: command,
        }),
      );
    }

    if (!success && command && error) {
      results.push(
        candidate({
          episode,
          factType: 'lesson',
          predicate: 'known_failure_mode',
          factText: `Command failed: ${command}. Error: ${error}`,
          objectValue: error,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'known_failure_mode',
            normalizeText(command),
          ),
          confidence: 0.78,
          trustLevel: 'medium',
          tags: ['tool-failure', 'command', 'error'],
          sourceType: 'tool_result',
          sourceRef: command,
        }),
      );
    }
  }

  if (episode.sourceType === 'repo_scan') {
    const scanKind = typeof metadata.kind === 'string' ? metadata.kind : undefined;
    const scanPath = typeof metadata.path === 'string' ? metadata.path : undefined;
    const packageManager =
      typeof metadata.packageManager === 'string' ? metadata.packageManager : undefined;

    if (scanKind === 'package_json' && packageManager) {
      results.push(
        candidate({
          episode,
          factType: 'knowledge',
          predicate: 'package_manager',
          factText: `Project package manager is ${packageManager}.`,
          objectValue: packageManager,
          factKey: makeFactKey('project', episode.scopeId, 'package_manager'),
          confidence: 0.94,
          trustLevel: 'high',
          tags: ['repo-scan', 'package-manager'],
          sourceType: 'repo_doc',
          sourceRef: scanPath,
        }),
      );
    }
  }

  return results;
}
