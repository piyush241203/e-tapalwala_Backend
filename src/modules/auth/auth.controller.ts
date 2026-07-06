import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { loginSchema, refreshSchema } from './auth.schema';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { auditLog } from '../audit/audit.service';

const signAccessToken = (userId: string) =>
  jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
  });

const signRefreshToken = (userId: string) =>
  jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
  });

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { city: { select: { name: true, code: true } } }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials or account inactive' });
      return;
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);

    await auditLog({
      actorId: user.id,
      cityId: user.cityId || undefined,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          cityId: user.cityId,
          officeId: user.officeId,
          departmentId: user.departmentId,
          deskName: user.deskName,
          // Robust slug: prefer name-based slug, fall back to city code (always present)
          citySlug: user.city
            ? (user.city.name
                ? user.city.name
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '') // remove accents
                    .replace(/[^a-z0-9]+/g, '-')     // non-alphanumeric → dash
                    .replace(/^-+|-+$/g, '')          // trim leading/trailing dashes
                : user.city.code.toLowerCase())
            : null,
        },
      });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      await auditLog({
        actorId: req.user.id,
        cityId: req.user.cityId || undefined,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: req.user.id,
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
     let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { sub: string };
    } catch (jwtErr) {
      res.status(401).json({ error: 'Refresh token expired or invalid' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const accessToken = signAccessToken(user.id);
    const newRefreshToken = signRefreshToken(user.id);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
};

export const me = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, email: true, username: true, fullName: true,
        phone: true, role: true, cityId: true, officeId: true, isActive: true,
        departmentId: true, deskName: true,
        lastLoginAt: true, createdAt: true,
        city: { select: { id: true, name: true, code: true } },
      },
    });

    const citySlug = user?.city
      ? (user.city.name
          ? user.city.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
          : user.city.code.toLowerCase())
      : null;

    res.json({ ...user, citySlug });
  } catch (err) {
    next(err);
  }
};
