import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middlewares/auth.middleware';
import {
  createCitySchema, updateCitySchema,
  createCityAdminSchema, updateCityAdminSchema,
  updateMessagingSettingsSchema, logsFilterSchema,
  createOfficeSchema, updateOfficeSchema,
  updateWhatsAppCitySettingsSchema,
} from './super-admin.schema';
import { Role, Channel, MessageStatus, BulkOperationStatus } from '@prisma/client';
import { auditLog } from '../audit/audit.service';
import PDFDocument from 'pdfkit';

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const getDashboard = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [
      totalCities, totalCityAdmins, totalOperators,
      totalMessages, pendingMessages, failedMessages,
      deliveredMessages, readMessages,
    ] = await Promise.all([
      prisma.city.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: { in: ['CITY_ADMIN', 'Admin'] } } }),
      prisma.user.count({ where: { role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer'] } } }),
      prisma.messageLog.count(),
      prisma.messageLog.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }),
      prisma.messageLog.count({ where: { status: 'FAILED' } }),
      prisma.messageLog.count({ where: { status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
      prisma.messageLog.count({ where: { status: 'READ' } }),
    ]);

    const deliveryRate = totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 100) : 0;
    const readRate = deliveredMessages > 0 ? Math.round((readMessages / deliveredMessages) * 100) : 0;

    // Last 7 days activity
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentLogs = await prisma.messageLog.groupBy({
      by: ['status'],
      _count: { status: true },
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    // Top 5 cities by messages
    const topCities = await prisma.messageLog.groupBy({
      by: ['cityId'],
      _count: { cityId: true },
      orderBy: { _count: { cityId: 'desc' } },
      take: 5,
    });

    const cityNames = await prisma.city.findMany({
      where: { id: { in: topCities.map(c => c.cityId) } },
      select: { id: true, name: true },
    });

    const topCitiesWithNames = topCities.map(c => ({
      cityId: c.cityId,
      cityName: cityNames.find(n => n.id === c.cityId)?.name || c.cityId,
      count: c._count.cityId,
    }));

    res.json({
      stats: {
        totalCities, totalCityAdmins, totalOperators,
        totalMessages, pendingMessages, failedMessages,
        deliveredMessages, readMessages, deliveryRate, readRate,
      },
      recentActivity: recentLogs,
      topCities: topCitiesWithNames,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Cities ──────────────────────────────────────────────────────────────────
export const getCities = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const search = req.query.search as string;

    const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};

    const [cities, total] = await Promise.all([
      prisma.city.findMany({
        where,
        include: {
          _count: { select: { users: true, messageLogs: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.city.count({ where }),
    ]);

    res.json({ data: cities, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const createCity = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = createCitySchema.parse(req.body);

    const city = await prisma.city.create({
      data: { ...body, createdById: req.user!.id },
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'CREATE_CITY',
      entityType: 'City',
      entityId: city.id,
      metadata: { cityName: city.name },
    });

    res.status(201).json(city);
  } catch (err) {
    next(err);
  }
};

export const updateCity = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = updateCitySchema.parse(req.body);

    const city = await prisma.city.update({
      where: { id },
      data: body,
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'UPDATE_CITY',
      entityType: 'City',
      entityId: city.id,
    });

    res.json(city);
  } catch (err) {
    next(err);
  }
};

export const toggleCityStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const city = await prisma.city.findUniqueOrThrow({ where: { id } });

    const updated = await prisma.city.update({
      where: { id },
      data: { isActive: !city.isActive },
    });

    await auditLog({
      actorId: req.user!.id,
      action: updated.isActive ? 'ACTIVATE_CITY' : 'DEACTIVATE_CITY',
      entityType: 'City',
      entityId: city.id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteCity = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    // Cascade delete everything connected to the city to ensure success
    await Promise.all([
      prisma.movement.deleteMany({ where: { tapal: { cityId: id } } }),
      prisma.tapal.deleteMany({ where: { cityId: id } }),
      prisma.department.deleteMany({ where: { cityId: id } }),
      prisma.operator.deleteMany({ where: { cityId: id } }),
      prisma.recipient.deleteMany({ where: { cityId: id } }),
      prisma.messageLog.deleteMany({ where: { cityId: id } }),
      prisma.bulkOperation.deleteMany({ where: { cityId: id } }),
      prisma.document.deleteMany({ where: { cityId: id } }),
      prisma.auditLog.deleteMany({ where: { cityId: id } }),
      prisma.office.deleteMany({ where: { cityId: id } }),
      prisma.user.deleteMany({ where: { cityId: id } }),
    ]);

    await prisma.city.delete({ where: { id } });

    await auditLog({
      actorId: req.user!.id,
      action: 'DELETE_CITY',
      entityType: 'City',
      entityId: id,
    });

    res.json({ message: 'City deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── City Admins ─────────────────────────────────────────────────────────────
export const getCityAdmins = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const cityId = req.query.cityId as string;
    const officeId = req.query.officeId as string;

    const where: any = { role: { in: ['CITY_ADMIN', 'Admin'] } };
    if (cityId) where.cityId = cityId;
    if (officeId) where.officeId = officeId;

    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, username: true, fullName: true,
          phone: true, isActive: true, lastLoginAt: true, createdAt: true,
          role: true,
          city: { select: { id: true, name: true, code: true } },
          office: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: admins, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const createCityAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = createCityAdminSchema.parse(req.body);

    const passwordHash = await bcrypt.hash(body.password, 12);

    const admin = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        passwordHash,
        fullName: body.fullName,
        phone: body.phone,
        role: 'Admin',
        cityId: body.cityId,
        officeId: body.officeId,
      },
      select: {
        id: true, email: true, username: true, fullName: true,
        phone: true, role: true, cityId: true, officeId: true, isActive: true, createdAt: true,
      },
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'CREATE_CITY_ADMIN',
      entityType: 'User',
      entityId: admin.id,
      metadata: { email: admin.email, cityId: body.cityId },
    });

    res.status(201).json(admin);
  } catch (err) {
    next(err);
  }
};

export const updateCityAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = updateCityAdminSchema.parse(req.body);

    const admin = await prisma.user.update({
      where: { id, role: { in: ['CITY_ADMIN', 'Admin'] } as any },
      data: {
        fullName: body.fullName,
        phone: body.phone,
        cityId: body.cityId,
        officeId: body.officeId,
        isActive: body.isActive,
      },
      select: {
        id: true, email: true, username: true, fullName: true,
        phone: true, role: true, cityId: true, officeId: true, isActive: true,
      },
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'UPDATE_CITY_ADMIN',
      entityType: 'User',
      entityId: id,
    });

    res.json(admin);
  } catch (err) {
    next(err);
  }
};

export const resetCityAdminPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    await auditLog({
      actorId: req.user!.id,
      action: 'RESET_PASSWORD',
      entityType: 'User',
      entityId: id,
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Global Logs ─────────────────────────────────────────────────────────────
export const getGlobalLogs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = logsFilterSchema.parse(req.query);
    const { cityId, operatorId, status, channel, startDate, endDate, page, limit } = query;

    const singleWhere: any = { 
      OR: [
        { bulkOperationId: null },
        { bulkOperationId: { isSet: false } }
      ],
      ...(cityId ? { cityId: cityId as string } : {}),
      ...(operatorId ? { operatorId: operatorId as string } : {}),
      ...(status ? { status: status as MessageStatus } : {}),
      ...(channel ? { channel: channel as Channel } : {}),
    };

    const bulkWhere: any = { 
      ...(cityId ? { cityId: cityId as string } : {}),
      ...(operatorId ? { operatorId: operatorId as string } : {}),
      ...(channel ? { channel: channel as Channel } : {}),
    };

    if (status) {
      const bulkOpStatusMap: Record<string, string> = {
        'QUEUED': 'QUEUED',
        'PROCESSING': 'PROCESSING',
        'SENT': 'COMPLETED',
        'FAILED': 'FAILED'
      };
      const mapped = bulkOpStatusMap[status as string];
      if (mapped) {
        bulkWhere.status = mapped as BulkOperationStatus;
      } else {
        bulkWhere.id = 'non-existent';
      }
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      singleWhere.createdAt = dateFilter;
      bulkWhere.createdAt = dateFilter;
    }

    const [singleCount, bulkCount] = await Promise.all([
      prisma.messageLog.count({ where: singleWhere }),
      prisma.bulkOperation.count({ where: bulkWhere }),
    ]);

    const total = singleCount + bulkCount;

    const [singleLogs, bulkOps] = await Promise.all([
      prisma.messageLog.findMany({
        where: singleWhere,
        include: {
          operator: { select: { fullName: true, username: true } },
          document: { select: { id: true, originalName: true, fileUrl: true } },
          city: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: page * limit,
      }),
      prisma.bulkOperation.findMany({
        where: bulkWhere,
        include: {
          operator: { include: { user: { select: { fullName: true, username: true } } } },
          document: { select: { id: true, originalName: true, fileUrl: true } },
          city: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: page * limit,
      })
    ]);

    const mappedBulk = bulkOps.map(op => ({
      id: op.id,
      isBulk: true,
      bulkOperationId: op.id,
      recipientMobile: `Bulk (${op.totalRecipients} recipients)`,
      operationName: op.name,
      document: op.document,
      channel: op.channel,
      provider: op.provider,
      status: op.status === 'COMPLETED' ? 'SENT' : op.status === 'FAILED' ? 'FAILED' : op.status,
      error: op.status === 'FAILED' ? 'Bulk operation failed' : null,
      sentAt: op.startedAt || op.createdAt,
      createdAt: op.createdAt,
      totalRecipients: op.totalRecipients,
      sentCount: op.sentCount,
      failedCount: op.failedCount,
      operator: op.operator?.user ? { fullName: op.operator.user.fullName, username: op.operator.user.username } : null,
      city: op.city,
    }));

    const combined = [...singleLogs, ...mappedBulk].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const paginated = combined.slice((page - 1) * limit, page * limit);

    res.json({ data: paginated, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// ─── Audit Logs ──────────────────────────────────────────────────────────────
export const getAuditLogs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const cityId = req.query.cityId as string;
    const action = req.query.action as string;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (action) where.action = { contains: action };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ data: logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// ─── Messaging Settings ──────────────────────────────────────────────────────
export const getMessagingSettings = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = await prisma.messagingSettings.findFirst({ where: { scope: 'GLOBAL' } });
    // Mask sensitive fields
    if (settings) {
      const masked = {
        ...settings,
        metaAccessToken: settings.metaAccessToken ? '***' + settings.metaAccessToken.slice(-4) : null,
      };
      res.json(masked);
    } else {
      res.json(null);
    }
  } catch (err) {
    next(err);
  }
};

export const updateMessagingSettings = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = updateMessagingSettingsSchema.parse(req.body);

    const existing = await prisma.messagingSettings.findFirst({ where: { scope: 'GLOBAL' } });

    let settings;
    if (existing) {
      settings = await prisma.messagingSettings.update({ where: { id: existing.id }, data: body });
    } else {
      settings = await prisma.messagingSettings.create({ data: { scope: 'GLOBAL', ...body } });
    }

    await auditLog({
      actorId: req.user!.id,
      action: 'UPDATE_MESSAGING_SETTINGS',
      entityType: 'MessagingSettings',
      entityId: settings.id,
    });

    res.json({ message: 'Settings updated', id: settings.id });
  } catch (err) {
    next(err);
  }
};

// ─── Reports ─────────────────────────────────────────────────────────────────
export const getReports = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) dateFilter.lte = new Date(endDate as string);

    const where = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

    const [byStatus, byChannel, byProvider, byCity] = await Promise.all([
      prisma.messageLog.groupBy({ by: ['status'], _count: { status: true }, where }),
      prisma.messageLog.groupBy({ by: ['channel'], _count: { channel: true }, where }),
      prisma.messageLog.groupBy({ by: ['provider'], _count: { provider: true }, where }),
      prisma.messageLog.groupBy({
        by: ['cityId'],
        _count: { cityId: true },
        orderBy: { _count: { cityId: 'desc' } },
        take: 10,
        where,
      }),
    ]);

    const cityNames = await prisma.city.findMany({
      where: { id: { in: byCity.map(c => c.cityId) } },
      select: { id: true, name: true },
    });

    res.json({
      byStatus,
      byChannel,
      byProvider,
      byCity: byCity.map(c => ({
        ...c,
        cityName: cityNames.find(n => n.id === c.cityId)?.name || c.cityId,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Offices ─────────────────────────────────────────────────────────────────
export const getOffices = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const cityId = req.query.cityId as string;
    const search = req.query.search as string;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [offices, total] = await Promise.all([
      prisma.office.findMany({
        where,
        include: {
          city: { select: { name: true, code: true } },
          _count: { select: { users: true, departments: true, tapals: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.office.count({ where }),
    ]);

    res.json({ data: offices, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const createOffice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = createOfficeSchema.parse(req.body);

    const existing = await prisma.office.findUnique({
      where: { code: body.code },
    });
    if (existing) {
      res.status(400).json({ error: `Office code ${body.code} is already in use` });
      return;
    }

    const office = await prisma.office.create({
      data: body,
      include: { city: { select: { name: true } } },
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'CREATE_OFFICE',
      entityType: 'Office',
      entityId: office.id,
      metadata: { officeName: office.name, cityId: body.cityId },
    });

    res.status(201).json(office);
  } catch (err) {
    next(err);
  }
};

export const updateOffice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = updateOfficeSchema.parse(req.body);

    const office = await prisma.office.update({
      where: { id },
      data: body,
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'UPDATE_OFFICE',
      entityType: 'Office',
      entityId: id,
    });

    res.json(office);
  } catch (err) {
    next(err);
  }
};

export const deleteOffice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    // Cascade delete everything connected to the office
    await Promise.all([
      prisma.movement.deleteMany({ where: { tapal: { officeId: id } } }),
      prisma.tapal.deleteMany({ where: { officeId: id } }),
      prisma.department.deleteMany({ where: { officeId: id } }),
      prisma.user.deleteMany({ where: { officeId: id } }),
    ]);

    await prisma.office.delete({ where: { id } });

    await auditLog({
      actorId: req.user!.id,
      action: 'DELETE_OFFICE',
      entityType: 'Office',
      entityId: id,
    });

    res.json({ message: 'Office deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── WhatsApp Credit & Office Management Settings ───────────────────────────────
export const getWhatsAppCities = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cities = await prisma.city.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        state: true,
        district: true,
        whatsappMonthlyLimit: true,
      },
    });

    const enrichedCities = await Promise.all(
      cities.map(async (city) => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        // Fetch message log statistics
        const [monthlySent, totalSent, failed] = await Promise.all([
          prisma.messageLog.count({ where: { cityId: city.id, createdAt: { gte: startOfMonth }, status: { not: 'FAILED' } } }),
          prisma.messageLog.count({ where: { cityId: city.id, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
          prisma.messageLog.count({ where: { cityId: city.id, status: 'FAILED' } }),
        ]);

        // Monthly trends (grouped by month for the last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const monthlyLogs = await prisma.messageLog.findMany({
          where: { cityId: city.id, createdAt: { gte: sixMonthsAgo } },
          select: { createdAt: true },
        });

        // Group by month string (YYYY-MM)
        const trendsMap: Record<string, number> = {};
        monthlyLogs.forEach((log) => {
          const key = log.createdAt.toISOString().slice(0, 7); // e.g. "2026-06"
          trendsMap[key] = (trendsMap[key] || 0) + 1;
        });

        const trends = Object.entries(trendsMap).map(([month, count]) => ({
          month,
          count,
        })).sort((a, b) => a.month.localeCompare(b.month));

        return {
          ...city,
          monthlySent,
          totalSent,
          failed,
          trends,
        };
      })
    );

    res.json(enrichedCities);
  } catch (err) {
    next(err);
  }
};

export const updateWhatsAppCitySettings = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = updateWhatsAppCitySettingsSchema.parse(req.body);

    const city = await prisma.city.update({
      where: { id },
      data: {
        whatsappMonthlyLimit: body.whatsappMonthlyLimit,
      },
    });

    await auditLog({
      actorId: req.user!.id,
      action: 'UPDATE_CITY_WHATSAPP_LIMITS',
      entityType: 'City',
      entityId: id,
      metadata: { ...body },
    });

    res.json(city);
  } catch (err) {
    next(err);
  }
};

export const getWhatsAppOffices = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const offices = await prisma.office.findMany({
      include: {
        city: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enrichedOffices = await Promise.all(
      offices.map(async (office) => {
        // Fetch message logs stats via nested operator filter
        const [totalSent, failed] = await Promise.all([
          prisma.messageLog.count({ where: { operator: { officeId: office.id }, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
          prisma.messageLog.count({ where: { operator: { officeId: office.id }, status: 'FAILED' } }),
        ]);

        return {
          id: office.id,
          name: office.name,
          code: office.code,
          cityId: office.cityId,
          cityName: office.city.name,
          whatsappDisabled: office.whatsappDisabled,
          totalSent,
          failed,
        };
      })
    );

    res.json(enrichedOffices);
  } catch (err) {
    next(err);
  }
};

export const toggleWhatsAppOfficeStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const office = await prisma.office.findUniqueOrThrow({ where: { id } });

    const updated = await prisma.office.update({
      where: { id },
      data: { whatsappDisabled: !office.whatsappDisabled },
    });

    await auditLog({
      actorId: req.user!.id,
      action: updated.whatsappDisabled ? 'DISABLE_OFFICE_WHATSAPP' : 'ENABLE_OFFICE_WHATSAPP',
      entityType: 'Office',
      entityId: id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const downloadOfficePdfReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const office = await prisma.office.findUniqueOrThrow({
      where: { id },
      include: { city: { select: { name: true } } },
    });

    // Fetch stats
    const [totalSent, delivered, read, failed] = await Promise.all([
      prisma.messageLog.count({ where: { operator: { officeId: id } } }),
      prisma.messageLog.count({ where: { operator: { officeId: id }, status: 'DELIVERED' } }),
      prisma.messageLog.count({ where: { operator: { officeId: id }, status: 'READ' } }),
      prisma.messageLog.count({ where: { operator: { officeId: id }, status: 'FAILED' } }),
    ]);

    // Fetch logs
    const logs = await prisma.messageLog.findMany({
      where: { operator: { officeId: id } },
      include: {
        operator: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit table to last 100 logs for PDF size constraints
    });

    // Compute rates
    const deliveryRate = totalSent > 0 ? Math.round(((delivered + read) / totalSent) * 100) : 0;
    const readRate = (delivered + read) > 0 ? Math.round((read / (delivered + read)) * 100) : 0;
    const failureRate = totalSent > 0 ? Math.round((failed / totalSent) * 100) : 0;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="WhatsApp_Report_${office.code}.pdf"`);

    doc.pipe(res);

    // Title / Header
    doc.fontSize(20).fillColor('#1e293b').text('E-Tapalwala', { align: 'center', bold: true } as any);
    doc.fontSize(14).fillColor('#475569').text('Office WhatsApp Messaging Report', { align: 'center' });
    doc.moveDown();
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown();

    // Office Metadata
    doc.fontSize(12).fillColor('#0f172a').text('Office Details', { bold: true } as any);
    doc.fontSize(10).fillColor('#334155').text(`Office Name: ${office.name}`);
    doc.text(`Office Code: ${office.code}`);
    doc.text(`City: ${office.city.name}`);
    doc.text(`Messaging Status: ${office.whatsappDisabled ? 'Disabled' : 'Enabled'}`);
    doc.moveDown();

    // Summary Stats
    doc.fontSize(12).fillColor('#0f172a').text('WhatsApp Messaging Summary (All-Time)', { bold: true } as any);
    doc.fontSize(10).fillColor('#334155').text(`Total Messages Transmitted: ${totalSent}`);
    doc.text(`Successful Delivery Rate: ${deliveryRate}%`);
    doc.text(`Read Receipt Rate: ${readRate}%`);
    doc.text(`Failure Rate: ${failureRate}%`);
    doc.moveDown();
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown();

    // Table of Logs
    doc.fontSize(12).fillColor('#0f172a').text('Recent Message Logs (Last 100)', { bold: true } as any);
    doc.moveDown(0.5);

    // Draw header row
    const startY = doc.y;
    doc.fontSize(9).fillColor('#1e293b');
    doc.text('Date & Time', 50, startY, { bold: true } as any);
    doc.text('Recipient', 160, startY, { bold: true } as any);
    doc.text('Status', 260, startY, { bold: true } as any);
    doc.text('Message Preview', 340, startY, { bold: true } as any);
    
    doc.moveDown(0.5);
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);

    // Draw rows
    logs.forEach((log) => {
      // Check if page needs break
      if (doc.y > 700) {
        doc.addPage();
        // Redraw table headers on new page
        const newY = doc.y;
        doc.fontSize(9).fillColor('#1e293b');
        doc.text('Date & Time', 50, newY, { bold: true } as any);
        doc.text('Recipient', 160, newY, { bold: true } as any);
        doc.text('Status', 260, newY, { bold: true } as any);
        doc.text('Message Preview', 340, newY, { bold: true } as any);
        doc.moveDown(0.5);
        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(0.3);
      }

      const rowY = doc.y;
      doc.fontSize(8).fillColor('#475569');
      doc.text(log.createdAt.toLocaleString(), 50, rowY);
      doc.text(log.recipientMobile, 160, rowY);
      doc.text(log.status, 260, rowY);
      doc.text(log.body?.substring(0, 45) || 'N/A', 340, rowY);
      doc.moveDown(0.8);
    });

    doc.end();
  } catch (err) {
    next(err);
  }
};

