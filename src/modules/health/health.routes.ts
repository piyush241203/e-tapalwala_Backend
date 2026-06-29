import { Router } from 'express';
import { checkHealth } from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', checkHealth);
