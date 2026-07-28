import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { upload } from '../../middlewares/upload.middleware';
import {
  getTapals,
  getTapalById,
  createTapal,
  forwardTapal,
  resolveTapal,
  returnTapal,
  viewTapalAttachment,
} from './tapal.controller';

export const tapalRouter = Router();

// Public route to view tapal attachment inline in the browser
tapalRouter.get('/:id/view', viewTapalAttachment);

tapalRouter.use(authenticate);

tapalRouter.get('/', getTapals);
tapalRouter.get('/:id', getTapalById);
tapalRouter.post('/', upload.single('pdf'), createTapal);
tapalRouter.post('/:id/forward', forwardTapal);
tapalRouter.post('/:id/resolve', resolveTapal);
tapalRouter.post('/:id/return', returnTapal);
