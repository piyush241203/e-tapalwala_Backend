import { Router } from 'express';
import { login, logout, refreshToken, me } from './auth.controller';
import { authenticate } from '../../middlewares/auth.middleware';

export const authRouter = Router();

authRouter.post('/login', login);
authRouter.post('/logout', authenticate, logout);
authRouter.post('/refresh', refreshToken);
authRouter.get('/me', authenticate, me);
