import { env } from './config/env';
import { createApp } from './http';

// The static client mount lives inside createApp, ahead of its catch-all 404.
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Taste Brain listening on ${env.PORT} [${env.NODE_ENV}] mode=${env.DEFAULT_MODE} qloo_enabled=${env.QLOO_ENABLED}`);
});
