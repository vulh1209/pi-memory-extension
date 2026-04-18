import type { MemoryEmbedder } from './types.ts';
import { tokenize } from './utils.ts';

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class HashingEmbedder implements MemoryEmbedder {
  readonly modelName: string;
  readonly dimensions: number;

  constructor(options?: { dimensions?: number; modelName?: string }) {
    this.dimensions = options?.dimensions ?? 128;
    this.modelName = options?.modelName ?? 'local-hashing-embedder-v1';
  }

  async embedText(input: string): Promise<number[]> {
    const vector = Array.from({ length: this.dimensions }, () => 0);
    const tokens = tokenize(input);

    if (tokens.length === 0) {
      return vector;
    }

    for (const token of tokens) {
      const hash = fnv1a(token);
      const index = hash % this.dimensions;
      vector[index] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) {
      return vector;
    }

    return vector.map((value) => value / norm);
  }
}
