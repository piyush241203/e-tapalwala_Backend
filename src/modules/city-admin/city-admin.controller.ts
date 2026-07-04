import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { auditLog } from '../audit/audit.service';
import { z } from 'zod';
import { Role, Channel, MessageStatus, BulkOperationStatus } from '@prisma/client';

const createOperatorSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  role: z.enum(['Clerk', 'Superintendent', 'Officer', 'Admin', 'OPERATOR']).default('Clerk'),
  departmentId: z.string().optional(),
  deskName: z.string().optional(),
});

const updateOperatorSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  role: z.enum(['Clerk', 'Superintendent', 'Officer', 'Admin', 'OPERATOR']).optional(),
  departmentId: z.string().optional(),
  deskName: z.string().optional(),
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const getDashboard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Run all top-level counts in parallel — O(6) queries, not O(3n+6)
    const [
      operatorsCount, messagesToday, pendingMessages, failedMessages,
      deliveredMessages, readMessages,
      operators,
      // Single groupBy replaces N×3 individual count queries per operator
      operatorGrouped,
    ] = await Promise.all([
      prisma.user.count({ where: { role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] }, cityId, officeId } }),
      prisma.messageLog.count({ where: { cityId, operator: { officeId }, createdAt: { gte: today } } }),
      prisma.messageLog.count({ where: { cityId, operator: { officeId }, status: { in: ['QUEUED', 'PROCESSING'] } } }),
      prisma.messageLog.count({ where: { cityId, operator: { officeId }, status: 'FAILED' } }),
      prisma.messageLog.count({ where: { cityId, operator: { officeId }, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
      prisma.messageLog.count({ where: { cityId, operator: { officeId }, status: 'READ' } }),
      prisma.user.findMany({
        where: { role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] }, cityId, officeId },
        select: { id: true, fullName: true, username: true },
      }),
      // One query instead of (operators.length × 3) queries
      prisma.messageLog.groupBy({
        by: ['operatorId', 'status'],
        _count: { id: true },
        where: {
          cityId,
          operator: { officeId },
          status: { in: ['SENT', 'FAILED', 'DELIVERED', 'READ'] },
        },
      }),
    ]);

    // Build a fast lookup map from the groupBy result
    const statsMap: Record<string, { sent: number; failed: number; delivered: number }> = {};
    for (const row of operatorGrouped) {
      const opId = row.operatorId!;
      if (!statsMap[opId]) statsMap[opId] = { sent: 0, failed: 0, delivered: 0 };
      const cnt = row._count.id;
      if (row.status === 'FAILED') {
        statsMap[opId].failed += cnt;
      } else if (row.status === 'SENT' || row.status === 'DELIVERED' || row.status === 'READ') {
        statsMap[opId].delivered += cnt;
      }
    }

    const operatorStats = operators.map((op) => ({
      ...op,
      ...(statsMap[op.id] ?? { sent: 0, failed: 0, delivered: 0 }),
    }));

    // Cache for 2 minutes — dashboard stats don't need to be real-time to the second
    res.set('Cache-Control', 'private, max-age=120');
    res.json({
      stats: { operatorsCount, messagesToday, pendingMessages, failedMessages, deliveredMessages, readMessages },
      operatorStats,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Operators ───────────────────────────────────────────────────────────────
export const getOperators = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const search = req.query.search as string;

    const where: any = { role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] }, cityId, officeId };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [operators, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, username: true, fullName: true,
          phone: true, isActive: true, lastLoginAt: true, createdAt: true,
          role: true, departmentId: true, deskName: true,
          department: { select: { name: true, code: true } },
          _count: { select: { messageLogs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: operators, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const createOperator = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const body = createOperatorSchema.parse(req.body);

    // ── Duplicate checks ─────────────────────────────────────────────────────
    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }),
      prisma.user.findUnique({ where: { username: body.username }, select: { id: true } }),
    ]);

    if (existingEmail) {
      res.status(409).json({ error: 'This email is already registered. Please use a different email address.' });
      return;
    }

    if (existingUsername) {
      res.status(409).json({ error: `The username "${body.username}" is already taken. Please choose a different username.` });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const operator = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        passwordHash,
        fullName: body.fullName,
        phone: body.phone,
        role: body.role as Role,
        cityId,
        officeId,
        departmentId: body.departmentId || null,
        deskName: body.deskName || null,
        operatorProfile: {
          create: {
            cityId,
            createdById: req.user!.id,
          },
        },
      },
      select: {
        id: true, email: true, username: true, fullName: true,
        phone: true, role: true, cityId: true, isActive: true, createdAt: true,
        departmentId: true, deskName: true,
      },
    });

    await auditLog({
      actorId: req.user!.id,
      cityId,
      action: 'CREATE_OPERATOR',
      entityType: 'User',
      entityId: operator.id,
    });

    res.status(201).json(operator);
  } catch (err) {
    next(err);
  }
};

export const updateOperator = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const { id } = req.params;
    const body = updateOperatorSchema.parse(req.body);

    const operator = await prisma.user.update({
      where: { id, cityId, officeId, role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] } as any },
      data: {
        fullName: body.fullName,
        phone: body.phone,
        isActive: body.isActive,
        role: body.role as Role,
        departmentId: body.departmentId !== undefined ? body.departmentId : undefined,
        deskName: body.deskName !== undefined ? body.deskName : undefined,
      },
      select: { id: true, email: true, fullName: true, isActive: true, role: true, departmentId: true, deskName: true },
    });

    await auditLog({ actorId: req.user!.id, cityId, action: 'UPDATE_OPERATOR', entityType: 'User', entityId: id });
    res.json(operator);
  } catch (err) {
    next(err);
  }
};

export const resetOperatorPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id, cityId, officeId, role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] } as any },
      data: { passwordHash },
    });

    await auditLog({ actorId: req.user!.id, cityId, action: 'RESET_OPERATOR_PASSWORD', entityType: 'User', entityId: id });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Messages ────────────────────────────────────────────────────────────────
export const getMessages = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const { operatorId, status, channel, startDate, endDate } = req.query;

    const singleWhere: any = { 
      cityId, 
      operator: { officeId },
      OR: [
        { bulkOperationId: null },
        { bulkOperationId: { isSet: false } }
      ],
      ...(operatorId ? { operatorId: operatorId as string } : {}),
      ...(status ? { status: status as MessageStatus } : {}),
      ...(channel ? { channel: channel as Channel } : {}),
    };

    const bulkWhere: any = { 
      cityId,
      operator: { user: { officeId } },
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
      if (startDate) dateFilter.gte = new Date(startDate as string);
      if (endDate) dateFilter.lte = new Date(endDate as string);
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
        },
        orderBy: { createdAt: 'desc' },
        take: page * limit,
      }),
      prisma.bulkOperation.findMany({
        where: bulkWhere,
        include: {
          operator: { include: { user: { select: { fullName: true, username: true } } } },
          document: { select: { id: true, originalName: true, fileUrl: true } },
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
      operator: op.operator?.user ? { fullName: op.operator.user.fullName, username: op.operator.user.username } : null
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

// ─── Operator Activity ───────────────────────────────────────────────────────
export const getOperatorActivity = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const { id: operatorId } = req.params;

    const operator = await prisma.user.findFirst({
      where: { id: operatorId, cityId, officeId, role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] } as any },
      select: { id: true, fullName: true, username: true, email: true, lastLoginAt: true },
    });

    if (!operator) {
      res.status(404).json({ error: 'Operator not found' });
      return;
    }

    const [recentLogs, byStatus, bulkOps] = await Promise.all([
      prisma.messageLog.findMany({
        where: { operatorId, cityId, operator: { officeId } },
        include: { document: { select: { originalName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.messageLog.groupBy({ by: ['status'], _count: { status: true }, where: { operatorId, cityId, operator: { officeId } } }),
      prisma.bulkOperation.findMany({
        where: { operatorId, cityId, operator: { user: { officeId } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    res.json({ operator, recentLogs, byStatus, bulkOps });
  } catch (err) {
    next(err);
  }
};

// ─── Reports ─────────────────────────────────────────────────────────────────
export const getReports = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const singleWhere: any = { cityId, operator: { officeId } };
    const bulkWhere: any = { cityId, operator: { user: { officeId } } };
    if (hasDateFilter) {
      singleWhere.createdAt = dateFilter;
      bulkWhere.createdAt = dateFilter;
    }

    const [
      byStatus,
      byChannel,
      singleTotal,
      bulkAgg,
      byStatusBulk,
      operatorsRaw,
      singlePerOperator,
      bulkPerOperator,
    ] = await Promise.all([
      // Single message stats
      prisma.messageLog.groupBy({ by: ['status'], _count: { status: true }, where: singleWhere }),
      prisma.messageLog.groupBy({ by: ['channel'], _count: { channel: true }, where: singleWhere }),
      prisma.messageLog.count({ where: singleWhere }),

      // Bulk aggregate totals
      prisma.bulkOperation.aggregate({
        _sum: { totalRecipients: true, sentCount: true, failedCount: true, deliveredCount: true },
        _count: { id: true },
        where: bulkWhere,
      }),

      // Bulk by status
      prisma.bulkOperation.groupBy({ by: ['status'], _count: { id: true }, where: bulkWhere }),

      // Operator list for this office
      prisma.user.findMany({
        where: { officeId, cityId, role: { in: ['OPERATOR', 'Clerk', 'Superintendent', 'Officer', 'Admin'] } },
        select: { id: true, fullName: true, username: true, role: true },
      }),

      // Single messages per operator
      prisma.messageLog.groupBy({
        by: ['operatorId', 'status'],
        _count: { id: true },
        where: singleWhere,
      }),

      // Bulk per operator
      prisma.bulkOperation.groupBy({
        by: ['operatorId', 'status'],
        _sum: { totalRecipients: true, sentCount: true, failedCount: true },
        _count: { id: true },
        where: bulkWhere,
      }),
    ]);

    // Build per-operator stats map
    const operatorMap: Record<string, any> = {};
    for (const op of operatorsRaw) {
      operatorMap[op.id] = {
        id: op.id,
        fullName: op.fullName,
        username: op.username,
        role: op.role,
        singleTotal: 0,
        singleSent: 0,
        singleFailed: 0,
        bulkOperations: 0,
        bulkRecipients: 0,
        bulkSent: 0,
        bulkFailed: 0,
      };
    }

    for (const row of singlePerOperator) {
      const op = operatorMap[row.operatorId];
      if (!op) continue;
      op.singleTotal += row._count.id;
      if (row.status === 'SENT' || row.status === 'DELIVERED' || row.status === 'READ') op.singleSent += row._count.id;
      if (row.status === 'FAILED') op.singleFailed += row._count.id;
    }

    for (const row of bulkPerOperator) {
      const op = operatorMap[row.operatorId];
      if (!op) continue;
      op.bulkOperations += row._count.id;
      op.bulkRecipients += row._sum.totalRecipients ?? 0;
      op.bulkSent += row._sum.sentCount ?? 0;
      op.bulkFailed += row._sum.failedCount ?? 0;
    }

    const operatorStats = Object.values(operatorMap);

    // Combined totals
    const bulkTotalRecipients = bulkAgg._sum.totalRecipients ?? 0;
    const bulkTotalSent = bulkAgg._sum.sentCount ?? 0;
    const bulkTotalFailed = bulkAgg._sum.failedCount ?? 0;
    const bulkCount = bulkAgg._count.id ?? 0;

    res.json({
      cityId,
      // Single message stats
      single: {
        total: singleTotal,
        byStatus: byStatus.map(s => ({ status: s.status, count: s._count.status })),
        byChannel: byChannel.map(c => ({ channel: c.channel, count: c._count.channel })),
      },
      // Bulk operation stats
      bulk: {
        totalOperations: bulkCount,
        totalRecipients: bulkTotalRecipients,
        totalSent: bulkTotalSent,
        totalFailed: bulkTotalFailed,
        byStatus: byStatusBulk.map(s => ({ status: s.status, count: s._count.id })),
      },
      // Combined
      combined: {
        totalMessages: singleTotal + bulkTotalRecipients,
        totalSent: byStatus.filter(s => ['SENT','DELIVERED','READ'].includes(s.status)).reduce((a, s) => a + s._count.status, 0) + bulkTotalSent,
        totalFailed: byStatus.filter(s => s.status === 'FAILED').reduce((a, s) => a + s._count.status, 0) + bulkTotalFailed,
      },
      // Per-operator breakdown
      operatorStats,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Reports Export (CSV) ─────────────────────────────────────────────────────
export const exportReports = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cityId = req.user!.cityId!;
    const officeId = req.user!.officeId!;
    const { startDate, endDate, type = 'all' } = req.query;

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const escape = (v: any) => {
      const str = String(v ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    let csvRows: string[] = [];

    if (type === 'single' || type === 'all') {
      const where: any = { cityId, operator: { officeId } };
      if (hasDateFilter) where.createdAt = dateFilter;

      const logs = await prisma.messageLog.findMany({
        where,
        include: {
          operator: { select: { fullName: true, username: true } },
          document: { select: { originalName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });

      if (logs.length > 0) {
        csvRows.push('TYPE,DATE,OPERATOR,RECIPIENT_MOBILE,CHANNEL,STATUS,DOCUMENT,ERROR');
        for (const log of logs) {
          csvRows.push([
            'SINGLE',
            escape(log.createdAt.toISOString()),
            escape(log.operator?.fullName ?? ''),
            escape(log.recipientMobile),
            escape(log.channel),
            escape(log.status),
            escape(log.document?.originalName ?? ''),
            escape(log.error ?? ''),
          ].join(','));
        }
        csvRows.push('');
      }
    }

    if (type === 'bulk' || type === 'all') {
      const where: any = { cityId, operator: { user: { officeId } } };
      if (hasDateFilter) where.createdAt = dateFilter;

      const ops = await prisma.bulkOperation.findMany({
        where,
        include: {
          operator: { include: { user: { select: { fullName: true, username: true } } } },
          document: { select: { originalName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });

      if (ops.length > 0) {
        csvRows.push('TYPE,DATE,OPERATOR,OPERATION_NAME,CHANNEL,STATUS,TOTAL_RECIPIENTS,SENT,DELIVERED,FAILED,DOCUMENT');
        for (const op of ops) {
          csvRows.push([
            'BULK',
            escape(op.createdAt.toISOString()),
            escape(op.operator?.user?.fullName ?? ''),
            escape(op.name),
            escape(op.channel),
            escape(op.status),
            escape(op.totalRecipients),
            escape(op.sentCount),
            escape(op.deliveredCount),
            escape(op.failedCount),
            escape(op.document?.originalName ?? ''),
          ].join(','));
        }
      }
    }

    const filename = `report_${type}_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvRows.join('\n')); // BOM for Excel UTF-8 compatibility
  } catch (err) {
    next(err);
  }
};

