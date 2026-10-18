import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import authRoutes from './routes/auth.routes';
import ingestionRoutes from './routes/ingestion.routes';
import brainRoutes from './routes/brain.routes';
import agentRoutes from './routes/agent.routes';
import controlRoutes from './routes/control.routes';
import statusRoutes from './routes/status.routes';
import { startKeepAlive } from './graph/graph.client';

const app = express();

// Enterprise Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  })
);

// Healthcheck Route — reports both backing stores (§12.3)
app.get('/health', async (req, res) => {
  const [{ isFalkorReachable }, prisma] = await Promise.all([
    import('./graph/graph.client'),
    import('./db/client'),
  ]);
  const falkordb = await isFalkorReachable();
  let postgres = false;
  try {
    await prisma.prisma.$queryRaw`SELECT 1`;
    postgres = true;
  } catch {
    postgres = false;
  }
  res.status(falkordb ? 200 : 503).json({
    status: falkordb ? 'ok' : 'degraded',
    falkordb,
    postgres,
    timestamp: new Date().toISOString(),
  });
});

import path from 'path';
import fs from 'fs';

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api', statusRoutes);
app.use('/api', brainRoutes);
app.use('/api', agentRoutes);
app.use('/api', controlRoutes);

// Serve Static Vite Client Build in Production
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// SPA Client-Side Routing Fallback
app.get('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// 404 Route Handler for API endpoints
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start Server
app.listen(env.PORT, () => {
  startKeepAlive();
  console.log(`Neutronz Company Brain listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

export default app;
