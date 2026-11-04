import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './middleware/error';
import { adminRouter } from './routes/admin.routes';
import { authRouter } from './routes/auth.routes';
import { devRouter } from './routes/dev.routes';
import { franchiseRouter } from './routes/franchise.routes';
import { publicRouter } from './routes/public.routes';
import { verificationRouter } from './routes/verification.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
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
  if (!config.isProduction) app.use('/api/dev', devRouter);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
