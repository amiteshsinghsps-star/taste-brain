// Where the private cache lives is operator-set, and an absolute path used to be
// joined onto the source tree rather than taken as a path — which made every live
// call die on ENOENT and silently degraded real runs to the synthetic fixtures.
// fetch is mocked, so nothing leaves this process.

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MOCK_BODY = {
  success: true,
  results: {
    entities: [{ entity_id: 'ABS-1', name: 'Abs Path Brand', subtype: 'urn:entity:brand', popularity: 0.3 }],
  },
};

describe('private cache directory', () => {
  it('uses an absolute setting as the directory instead of appending it to the source tree', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-abs-cache-'));
    try {
      process.env.QLOO_ENABLED = 'true';
      process.env.QLOO_API_KEY = 'synthetic-test-key-not-a-secret';
      process.env.QLOO_BASE_URL = 'http://127.0.0.1:1';
      process.env.QLOO_PRIVATE_CACHE_DIR = dir;

      global.fetch = vi.fn(async () => ({
        ok: true, status: 200, json: async () => MOCK_BODY, text: async () => JSON.stringify(MOCK_BODY),
      })) as unknown as typeof fetch;

      vi.resetModules();
      const rest = await import('../src/qloo/rest-client');

      const rows = await rest.search('Abs Path Brand');
      expect(rows).toHaveLength(1);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.QLOO_PRIVATE_CACHE_DIR;
    }
  }, 30_000);
});
