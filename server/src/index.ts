import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { env } from './config/env';
import { createApp } from './http';

const app = createApp();

// In production, serve the built Vite client from ../public if present.
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/healthz')) return next();
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index); else next();
  });
}

app.listen(env.PORT, () => {
  console.log(`Taste Brain listening on ${env.PORT} [${env.NODE_ENV}] mode=${env.DEFAULT_MODE} qloo_enabled=${env.QLOO_ENABLED}`);
});
