import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './middleware/error';
import { accountsRouter } from './routes/accounts.routes';
import { adminRouter } from './routes/admin.routes';
import { authRouter } from './routes/auth.routes';
import { devRouter } from './routes/dev.routes';
import { franchiseRouter } from './routes/franchise.routes';
import { managerRouter } from './routes/manager.routes';
import { publicRouter } from './routes/public.routes';
import { verificationRouter } from './routes/verification.routes';
import { webhookRouter } from './routes/webhook.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/public/verification', verificationRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/franchise', franchiseRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/manager', managerRouter);
  app.use('/api/webhooks', webhookRouter);
  if (!config.isProduction) app.use('/api/dev', devRouter);

  app.use('/api', notFound);

  // Production: serve the built website from the same address (docs/GO-LIVE.md).
  if (config.CLIENT_DIST_DIR) {
    const dist = path.resolve(config.CLIENT_DIST_DIR);
    if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`CLIENT_DIST_DIR has no index.html: ${dist}. Run "npm run build" first.`);
    // Built files have a fingerprint in their name, so they can be cached for a year.
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Every other page is the single-page app; the page itself is never cached so updates show at once.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
