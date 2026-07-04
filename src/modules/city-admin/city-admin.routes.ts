import { Router } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import {
  getDashboard, getOperators, createOperator, updateOperator, resetOperatorPassword,
  getMessages, getOperatorActivity, getReports, exportReports,
} from './city-admin.controller';

export const cityAdminRouter = Router();

cityAdminRouter.use(authenticate, requireRole('CITY_ADMIN', 'Admin'));

cityAdminRouter.get('/dashboard', getDashboard);

cityAdminRouter.get('/operators', getOperators);
cityAdminRouter.post('/operators', createOperator);
cityAdminRouter.put('/operators/:id', updateOperator);
cityAdminRouter.patch('/operators/:id/reset-password', resetOperatorPassword);
cityAdminRouter.get('/operators/:id/activity', getOperatorActivity);

cityAdminRouter.get('/messages', getMessages);

cityAdminRouter.get('/reports', getReports);
cityAdminRouter.get('/reports/export', exportReports);
