import { Router } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from './department.controller';
import { Role } from '../../generated/client';

export const departmentRouter = Router();

// Authenticated users can list departments (e.g. operators need to see desks to forward tapals)
departmentRouter.get('/', authenticate, getDepartments);

// Only admins can manage departments
departmentRouter.post(
  '/',
  authenticate,
  requireRole(Role.PLATFORM_ADMIN, Role.CITY_ADMIN, Role.Admin),
  createDepartment
);

departmentRouter.put(
  '/:id',
  authenticate,
  requireRole(Role.PLATFORM_ADMIN, Role.CITY_ADMIN, Role.Admin),
  updateDepartment
);

departmentRouter.delete(
  '/:id',
  authenticate,
  requireRole(Role.PLATFORM_ADMIN, Role.CITY_ADMIN, Role.Admin),
  deleteDepartment
);
