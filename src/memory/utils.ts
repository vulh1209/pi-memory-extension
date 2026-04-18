import { createHash, randomUUID } from 'node:crypto';
import type { FactRecord } from './types.ts';

export function nowIso(): string {
  return new Date().toISOString();
}

export function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeText(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^\p{L}\p{N}_./:-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function buildFtsQuery(input: string): string {
  const tokens = tokenize(input).slice(0, 12);
  if (tokens.length === 0) {
    return '"memory"';
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

export function safeJsonParse<T>(input: string | null | undefined, fallback: T): T {
  if (!input) {
    return fallback;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function isSingleWinnerPredicate(predicate: string): boolean {
  return [
    'package_manager',
    'build_command',
    'test_command',
    'preferred_workflow',
    'memory_backend',
    'next_step',
    'response_verbosity',
  ].includes(predicate);
}

export function canCoexistPredicate(predicate: string): boolean {
  return [
    'lesson',
    'known_failure_mode',
    'working_command_variant',
    'owner',
    'incident',
    'forbidden_workflow',
  ].includes(predicate);
}

export function isFactValidAt(fact: FactRecord, asOf: string): boolean {
  const startsBefore = !fact.validFrom || fact.validFrom <= asOf;
  const endsAfter = !fact.validTo || fact.validTo > asOf;
  return startsBefore && endsAfter && fact.status !== 'invalid' && fact.status !== 'archived';
}
