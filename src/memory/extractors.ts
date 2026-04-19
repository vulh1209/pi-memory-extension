import type { CandidateFact, EpisodeRecord, FactType, ScopeType, TrustLevel } from './types.ts';
import { normalizeText } from './utils.ts';

const PREFERENCE_SOURCE_TYPES = new Set(['user_message', 'memory_note', 'agent_memory_proposal']);
const LESSON_SOURCE_TYPES = new Set(['memory_note', 'agent_memory_proposal', 'issue_resolution']);

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

  if (PREFERENCE_SOURCE_TYPES.has(episode.sourceType)) {
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

    const generalAlwaysMatch = content.match(/^always\s+(.+)/i);
    if (generalAlwaysMatch && !alwaysMatch) {
      const ruleText = `Always ${generalAlwaysMatch[1].trim().replace(/[.]+$/, '')}`;
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'project_rule',
          factText: `${ruleText}.`,
          objectValue: ruleText,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'project_rule',
            normalizeText(ruleText),
          ),
          confidence: 0.95,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: ['project-rule', 'always'],
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

    const generalNeverMatch = content.match(/^never\s+(.+)/i);
    if (generalNeverMatch && !neverMatch) {
      const ruleText = `Never ${generalNeverMatch[1].trim().replace(/[.]+$/, '')}`;
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'project_rule',
          factText: `${ruleText}.`,
          objectValue: ruleText,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'project_rule',
            normalizeText(ruleText),
          ),
          confidence: 0.97,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: ['project-rule', 'forbidden'],
          sourceType: 'user_instruction',
        }),
      );
    }

    const preferMatch = content.match(/^prefer\s+(.+)/i);
    if (preferMatch) {
      const preferenceText = `Prefer ${preferMatch[1].trim().replace(/[.]+$/, '')}`;
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'project_rule',
          factText: `${preferenceText}.`,
          objectValue: preferenceText,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'project_rule',
            normalizeText(preferenceText),
          ),
          confidence: 0.92,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: ['project-rule', 'preference'],
          sourceType: 'user_instruction',
        }),
      );
    }

    const doNotMatch = content.match(/^(?:do not|don't)\s+(.+)/i);
    if (doNotMatch) {
      const ruleText = `Do not ${doNotMatch[1].trim().replace(/[.]+$/, '')}`;
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'project_rule',
          factText: `${ruleText}.`,
          objectValue: ruleText,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'project_rule',
            normalizeText(ruleText),
          ),
          confidence: 0.95,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: ['project-rule', 'forbidden'],
          sourceType: 'user_instruction',
        }),
      );
    }

    const projectRuleMatch = content.match(/project rule[:\-]\s*(.+)/i);
    if (projectRuleMatch) {
      const ruleText = projectRuleMatch[1].trim().replace(/[.]+$/, '');
      results.push(
        candidate({
          episode,
          factType: 'rule',
          predicate: 'project_rule',
          factText: `Project rule: ${ruleText}.`,
          objectValue: ruleText,
          factKey: makeFactKey(
            episode.scopeType,
            episode.scopeId,
            'project_rule',
            normalizeText(ruleText),
          ),
          confidence: 0.94,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: ['project-rule'],
          sourceType: 'user_instruction',
        }),
      );
    }
  }

  if (LESSON_SOURCE_TYPES.has(episode.sourceType)) {
    const lessonMatch = content.match(/lesson learned[:\-]\s*(.+)/i);
    const rootCause = typeof metadata.rootCause === 'string'
      ? metadata.rootCause.trim()
      : content.match(/root cause[:\-]\s*(.+)/i)?.[1]?.trim();
    const fix = typeof metadata.fix === 'string'
      ? metadata.fix.trim()
      : content.match(/fix[:\-]\s*(.+)/i)?.[1]?.trim();
    const trapIssue = metadata.trapIssue === true
      || /trap issue|gotcha|pitfall|root cause/i.test(content);
    const resolved = metadata.resolved === true
      || /resolved|fixed|fix verified|working now/i.test(content);

    const lessonText = lessonMatch?.[1]?.trim()
      || (trapIssue && resolved && (rootCause || fix)
        ? [
            'Lesson learned:',
            rootCause ? `Root cause: ${rootCause}.` : null,
            fix ? `Fix: ${fix}.` : null,
          ].filter(Boolean).join(' ')
        : undefined);

    if (lessonText) {
      const issueKeySeed = typeof metadata.issueKey === 'string' && metadata.issueKey.trim()
        ? metadata.issueKey.trim()
        : normalizeText(rootCause || lessonText);
      results.push(
        candidate({
          episode,
          factType: 'lesson',
          predicate: 'lesson_learned',
          factText: lessonText.endsWith('.') ? lessonText : `${lessonText}.`,
          objectValue: fix,
          factKey: makeFactKey(episode.scopeType, episode.scopeId, 'lesson_learned', issueKeySeed),
          confidence: episode.actor === 'user' ? 0.95 : 0.88,
          trustLevel: episode.actor === 'user' ? 'human' : 'high',
          tags: [
            'lesson-learned',
            ...(trapIssue ? ['trap-issue'] : []),
            ...(resolved ? ['resolved'] : []),
          ],
          sourceType: episode.sourceType,
          sourceRef: typeof metadata.sourceRef === 'string' ? metadata.sourceRef : undefined,
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
