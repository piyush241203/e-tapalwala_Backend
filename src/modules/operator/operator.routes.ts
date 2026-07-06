import { Router } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { upload } from '../../middlewares/upload.middleware';
import {
  getDashboard, sendSingle, sendBulk,
  getMyLogs, getBulkOperation, retryMessage,
  getFailedMessages, previewCsv, viewDocument
} from './operator.controller';

export const operatorRouter = Router();

// Public route to view documents inline in the browser
operatorRouter.get('/documents/:id/view', viewDocument);

operatorRouter.use(authenticate);

// Publicly accessible bulk operations status for authenticated users (Super Admin, City Admin, Operator)
operatorRouter.get('/bulk-operations/:id', getBulkOperation);

operatorRouter.use(requireRole('OPERATOR', 'Clerk', 'Superintendent', 'Officer'));

operatorRouter.get('/dashboard', getDashboard);

// Single send — PDF only
operatorRouter.post('/send/single', upload.single('pdf'), sendSingle);

// Bulk send — PDF + CSV
operatorRouter.post('/send/bulk', upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'csv', maxCount: 1 },
]), sendBulk);

// CSV preview (no save)
operatorRouter.post('/csv/preview', upload.single('csv'), previewCsv);

// Logs
operatorRouter.get('/messages', getMyLogs);
operatorRouter.get('/messages/failed', getFailedMessages);
operatorRouter.post('/messages/:id/retry', retryMessage);
