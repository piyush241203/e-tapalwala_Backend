import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';

import { authRouter } from './modules/auth/auth.routes';
import { superAdminRouter } from './modules/super-admin/super-admin.routes';
import { platformAdminAuthRouter } from './modules/platform-admin/platform-admin.auth.routes';
import { cityAdminRouter } from './modules/city-admin/city-admin.routes';
import { operatorRouter } from './modules/operator/operator.routes';
import { webhookRouter } from './modules/webhooks/webhook.routes';
import { departmentRouter } from './modules/departments/department.routes';
import { tapalRouter } from './modules/tapals/tapal.routes';
import { errorHandler } from './middlewares/error.middleware';
import { logger } from './config/logger';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Security Middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
}));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression({ level: 6 })); // ~70% smaller JSON payloads

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200, // raised to support dashboard polling without 429 errors
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// Tighter limiter for the hidden platform admin portal
const platformAdminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Please try again later.' },
});

app.use(generalLimiter);

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// ─── Static Files ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'E-Tapalwala API' });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRouter);
app.use('/admin/auth', platformAdminLimiter, platformAdminAuthRouter); // Hidden platform admin portal
app.use('/super-admin', superAdminRouter);
app.use('/city-admin', cityAdminRouter);
app.use('/operator', operatorRouter);
app.use('/webhooks', webhookRouter);
app.use('/departments', departmentRouter);
app.use('/tapals', tapalRouter);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 E-Tapalwala API running on http://localhost:${PORT}`);
});

// Trigger reload
export default app;
