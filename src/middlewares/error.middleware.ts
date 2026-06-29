import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error(err.message, { stack: err.stack });

  if (err.name === 'ZodError') {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors,
    });
    return;
  }

  if (err.code === 'P2002') {
    res.status(409).json({
      error: 'A record with that value already exists',
      field: err.meta?.target,
    });
    return;
  }

  if (err.code === 'P2025') {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({ error: message });
};
