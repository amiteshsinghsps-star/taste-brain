import { env } from './config/env';
import { createApp } from './http';

// The static client mount lives inside createApp, ahead of its catch-all 404.
const app = createApp();

export default app;

// Vercel runs the app as a serverless function and must not open a port.
if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`Taste Brain listening on ${env.PORT} [${env.NODE_ENV}] mode=${env.DEFAULT_MODE} qloo_enabled=${env.QLOO_ENABLED}`);
    console.log(`ledger ${env.GRAPH_DB}${env.GRAPH_DB.startsWith(':memory:') ? ' (in memory: the ledger and the quota counters end with this process)' : ''}`);
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
      console.warn('warning: TRUST_PROXY_HOPS=0 behind a proxy means one rate bucket for the whole site');
    }
    if (env.NODE_ENV === 'production' && !env.LEDGER_HMAC_SECRET) {
      console.warn('warning: no LEDGER_HMAC_SECRET. The ledger is tamper-evident but unkeyed');
    }
  });
}
