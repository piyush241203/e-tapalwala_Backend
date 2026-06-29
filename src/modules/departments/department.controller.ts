import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { Role } from '@prisma/client';
import { z } from 'zod';

const createDeptSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).toUpperCase(),
  cityId: z.string().optional(),
  officeId: z.string().optional(),
});

const updateDeptSchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().min(2).toUpperCase().optional(),
  headOfDepartmentId: z.string().nullable().optional(),
});

export const getDepartments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    let officeId = user.officeId;

    if (user.role === Role.PLATFORM_ADMIN) {
      officeId = req.query.officeId as string || null;
    }

    const where = officeId ? { officeId } : {};

    const departments = await prisma.department.findMany({
      where,
      include: {
        headOfDepartment: {
          select: { id: true, fullName: true, email: true },
        },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(departments);
  } catch (err) {
    next(err);
  }
};

export const createDepartment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    const body = createDeptSchema.parse(req.body);

    let cityId = user.cityId;
    let officeId = user.officeId;
    if (user.role === Role.PLATFORM_ADMIN) {
      if (!body.cityId || !body.officeId) {
        res.status(400).json({ error: 'cityId and officeId are required for platform admins' });
        return;
      }
      cityId = body.cityId;
      officeId = body.officeId;
    }

    if (!cityId || !officeId) {
      res.status(400).json({ error: 'City and Office assignment required' });
      return;
    }

    // Check unique code
    const existing = await prisma.department.findUnique({
      where: { code: body.code },
    });
    if (existing) {
      res.status(400).json({ error: `Department code ${body.code} is already in use` });
      return;
    }

    const department = await prisma.department.create({
      data: {
        name: body.name,
        code: body.code,
        cityId,
        officeId,
      },
    });

    res.status(201).json(department);
  } catch (err) {
    next(err);
  }
};

export const updateDepartment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const body = updateDeptSchema.parse(req.body);

    // Verify ownership if not global admin
    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    if (user.role !== Role.PLATFORM_ADMIN && (dept.cityId !== user.cityId || dept.officeId !== user.officeId)) {
      res.status(403).json({ error: 'Access denied to this department' });
      return;
    }

    // Check code unique if updated
    if (body.code && body.code !== dept.code) {
      const existing = await prisma.department.findUnique({ where: { code: body.code } });
      if (existing) {
        res.status(400).json({ error: `Department code ${body.code} is already in use` });
        return;
      }
    }

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.code !== undefined) data.code = body.code;
    if (body.headOfDepartmentId !== undefined) data.headOfDepartmentId = body.headOfDepartmentId;

    const updated = await prisma.department.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteDepartment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    if (user.role !== Role.PLATFORM_ADMIN && (dept.cityId !== user.cityId || dept.officeId !== user.officeId)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Check if department has users
    const userCount = await prisma.user.count({ where: { departmentId: id } });
    if (userCount > 0) {
      res.status(400).json({ error: 'Cannot delete department with active desk users' });
      return;
    }

    await prisma.department.delete({ where: { id } });
    res.json({ message: 'Department deleted successfully' });
  } catch (err) {
    next(err);
  }
};
