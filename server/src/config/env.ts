import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const DEFAULT_ACCESS_SECRET = 'Neutronz_access_secret_key_default_32bytes';
const DEFAULT_REFRESH_SECRET = 'Neutronz_refresh_secret_key_default_32bytes';

// G6 fix: fail fast in production when default/insecure secrets are configured.
function assertSecureSecrets(nodeEnv: string) {
  const insecure =
    (process.env.JWT_ACCESS_SECRET || '') === DEFAULT_ACCESS_SECRET ||
    (process.env.JWT_REFRESH_SECRET || '') === DEFAULT_REFRESH_SECRET ||
    !(process.env.JWT_ACCESS_SECRET || '').length ||
    !(process.env.JWT_REFRESH_SECRET || '').length;
  if (nodeEnv === 'production' && insecure) {
    throw new Error(
      'Refusing to start in production with default/missing JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to long random values.'
    );
  }
}

const rawNodeEnv = process.env.NODE_ENV || 'development';
assertSecureSecrets(rawNodeEnv);

function trueFlag(value?: string): boolean {
  return value === '1' || value === 'true';
}

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: rawNodeEnv,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/Neutronz_auth?schema=public',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || DEFAULT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || DEFAULT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '1d',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  // FalkorDB — the Company Brain graph store (one graph per tenant)
  FALKORDB_HOST: process.env.FALKORDB_HOST || 'localhost',
  FALKORDB_PORT: parseInt(process.env.FALKORDB_PORT || '6379', 10),
  FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD || '',
  FALKORDB_USERNAME: process.env.FALKORDB_USERNAME || '',

  // Embeddings (FR-7): must match EMBEDDINGS_DIM to the vector index dimension.
  EMBEDDINGS_MODEL: process.env.EMBEDDINGS_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  EMBEDDINGS_DIM: parseInt(process.env.EMBEDDINGS_DIM || '256', 10),

  // Flags + build provenance
  FF_LIVE_CONNECTORS: trueFlag(process.env.FF_LIVE_CONNECTORS),
  FALKORDB_REQUIRED: trueFlag(process.env.FALKORDB_REQUIRED),
  GIT_COMMIT: process.env.GIT_COMMIT || '',
};
