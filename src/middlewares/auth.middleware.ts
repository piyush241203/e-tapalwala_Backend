import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  cityId: string | null;
  officeId: string | null;
  departmentId: string | null;
  fullName: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_ACCESS_SECRET!;

    const decoded = jwt.verify(token, secret) as { sub: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, role: true, cityId: true, officeId: true, departmentId: true, fullName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      cityId: user.cityId,
      officeId: user.officeId,
      departmentId: user.departmentId,
      fullName: user.fullName,
    };

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
};

export const enforceCity = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // PLATFORM_ADMIN has access to all cities
  if (req.user.role === Role.PLATFORM_ADMIN) {
    next();
    return;
  }

  // CITY_ADMIN and OPERATOR must have a cityId
  if (!req.user.cityId) {
    res.status(403).json({ error: 'No city assigned to this user' });
    return;
  }

  // Inject cityId so controllers can use it safely
  (req as any).enforcedCityId = req.user.cityId;
  next();
};

export const enforceOffice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // PLATFORM_ADMIN has global access
  if (req.user.role === Role.PLATFORM_ADMIN) {
    next();
    return;
  }

  // Office admins and operator staff must have an officeId
  if (!req.user.officeId) {
    res.status(403).json({ error: 'No office assigned to this user' });
    return;
  }

  // Inject officeId and cityId
  (req as any).enforcedOfficeId = req.user.officeId;
  (req as any).enforcedCityId = req.user.cityId;
  next();
};
