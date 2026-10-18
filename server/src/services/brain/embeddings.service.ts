import crypto from 'crypto';
import axios from 'axios';
import { env } from '../../config/env';

/**
 * Embeddings service (FR-7).
 *
 * Two providers:
 *  1. OpenAI-compatible endpoint when OPENAI_API_KEY is configured.
 *  2. A deterministic local hashing embedder (dim = env.EMBEDDINGS_DIM, default
 *     256) when no API key is available — so the FalkorDB vector index always
 *     has a usable, reproducible vector space with zero remote dependency.
 *
 * Honest labeling: demo/UI copy states which mode is active.
 */

function deterministicEmbedding(text: string, dim: number): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const h = crypto.createHash('md5').update(token).digest();
    for (let d = 0; d < dim; d++) {
      vec[d] += h[d % h.length] - 128;
    }
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; provider: 'openai' | 'local-hash' }> {
  const dim = env.EMBEDDINGS_DIM;
  if (env.OPENAI_API_KEY) {
    try {
      const endpoint = `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/embeddings`;
      const res = await axios.post(
        endpoint,
        { model: env.EMBEDDINGS_MODEL, input: texts },
        { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      const vectors: number[][] = res.data?.data
        ?.sort((a: any, b: any) => a.index - b.index)
        ?.map((d: any) => d.embedding);
      if (vectors?.length === texts.length) {
        return { vectors, provider: 'openai' };
      }
    } catch (err: any) {
      console.warn('Embedding API notice (falling back to local hashing):', err?.message || err);
    }
  }
  return { vectors: texts.map((t) => deterministicEmbedding(t, dim)), provider: 'local-hash' };
}

export async function embedText(text: string): Promise<number[]> {
  const { vectors } = await embedTexts([text]);
  return vectors[0];
}
