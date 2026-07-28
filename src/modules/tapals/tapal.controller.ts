import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { uploadFileToR2, r2Client } from '../../config/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Role, TapalType, TapalStatus } from '@prisma/client';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { logger } from '../../config/logger';

const transformTapal = (tapal: any) => {
  if (tapal && tapal.fileAttachment && tapal.fileAttachment.storageKey) {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    tapal.fileAttachment.storageKey = `${apiUrl}/tapals/${tapal.id}/view`;
  }
  return tapal;
};

const createTapalSchema = z.object({
  type: z.enum(['Inward', 'Outward', 'Internal']),
  subject: z.string().min(2),
  organization: z.string().optional(),
  senderName: z.string().optional(),
  referenceLetterNo: z.string().optional(),
  receivedDate: z.string().optional(),
});

const forwardTapalSchema = z.object({
  toUserId: z.string().min(1, 'Target user is required'),
  actionTaken: z.string().min(1, 'Action taken is required'),
  remarks: z.string().optional(),
});

const resolveTapalSchema = z.object({
  remarks: z.string().optional(),
});

export const getTapals = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    const { type, status, search, mine } = req.query;

    let officeId = user.officeId;
    if (user.role === Role.PLATFORM_ADMIN) {
      officeId = req.query.officeId as string || null;
    }

    const where: any = {};
    if (officeId) where.officeId = officeId;

    if (mine === 'true') {
      where.currentHolderId = user.id;
    }

    if (type) {
      where.type = type as TapalType;
    }

    if (status) {
      where.status = status as TapalStatus;
    }

    if (search) {
      where.OR = [
        { trackingNumber: { contains: search as string, mode: 'insensitive' } },
        { subject: { contains: search as string, mode: 'insensitive' } },
        { 'senderDetails.senderName': { contains: search as string, mode: 'insensitive' } },
        { 'senderDetails.organization': { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const tapals = await prisma.tapal.findMany({
      where,
      include: {
        currentHolder: {
          select: { id: true, fullName: true, email: true, role: true, deskName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(tapals.map(transformTapal));
  } catch (err) {
    next(err);
  }
};

export const getTapalById = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const tapal = await prisma.tapal.findUnique({
      where: { id },
      include: {
        currentHolder: {
          select: { id: true, fullName: true, email: true, role: true, deskName: true },
        },
        movements: {
          include: {
            fromUser: { select: { id: true, fullName: true, role: true, deskName: true } },
            toUser: { select: { id: true, fullName: true, role: true, deskName: true } },
          },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!tapal) {
      res.status(404).json({ error: 'Tapal not found' });
      return;
    }

    if (user.role !== Role.PLATFORM_ADMIN && (tapal.cityId !== user.cityId || tapal.officeId !== user.officeId)) {
      res.status(403).json({ error: 'Access denied to this tapal' });
      return;
    }

    res.json(transformTapal(tapal));
  } catch (err) {
    next(err);
  }
};

export const createTapal = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'PDF attachment is required' });
      return;
    }

    if (file.size === 0) {
      res.status(400).json({ error: 'Uploaded PDF file is empty (0 bytes). Please upload a valid PDF.' });
      return;
    }

    const body = createTapalSchema.parse(req.body);

    let cityId = user.cityId;
    let officeId = user.officeId;
    if (user.role === Role.PLATFORM_ADMIN) {
      cityId = req.body.cityId || null;
      officeId = req.body.officeId || null;
      if (!cityId || !officeId) {
        res.status(400).json({ error: 'cityId and officeId are required for Platform Admins' });
        return;
      }
    }

    if (!cityId || !officeId) {
      res.status(400).json({ error: 'City and Office assignments required' });
      return;
    }

    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    const office = await prisma.office.findUnique({ where: { id: officeId } });

    const cityName = city.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const officeName = office ? office.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'general';
    const folderPath = `etapalwala_files/${cityName}/${officeName}/pdfs`;

    // Upload to Cloudflare R2
    const cleanOfficeName = office ? office.name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'general';
    const datetimeStr = new Date().toISOString().replace(/[^0-9]/g, '');
    const customPublicId = `${cleanOfficeName}tapal${datetimeStr}`;
    const r2Url = await uploadFileToR2(file.path, file.originalname, folderPath, customPublicId);

    // Generate unique tracking number
    const count = await prisma.tapal.count({ where: { cityId, officeId } });
    const year = new Date().getFullYear();
    const trackingNumber = `COL-${city.code}-${year}-${String(count + 1).padStart(5, '0')}`;

    const tapal = await prisma.tapal.create({
      data: {
        trackingNumber,
        type: body.type as TapalType,
        subject: body.subject,
        cityId,
        officeId,
        departmentId: user.departmentId || undefined,
        currentHolderId: user.id,
        status: TapalStatus.New,
        senderDetails: {
          organization: body.organization || null,
          senderName: body.senderName || null,
          referenceLetterNo: body.referenceLetterNo || null,
          receivedDate: body.receivedDate ? new Date(body.receivedDate) : null,
        },
        fileAttachment: {
          storageKey: r2Url,
          originalFilename: file.originalname,
          fileSizeBytes: file.size,
        },
      },
    });

    res.status(201).json(transformTapal(tapal));
  } catch (err) {
    next(err);
  }
};

export const forwardTapal = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const body = forwardTapalSchema.parse(req.body);

    const tapal = await prisma.tapal.findUnique({ where: { id } });
    if (!tapal) {
      res.status(404).json({ error: 'Tapal not found' });
      return;
    }

    const isAdminOfOffice = (user.role === Role.CITY_ADMIN || user.role === Role.Admin) && tapal.officeId === user.officeId;
    const isPlatformAdmin = user.role === Role.PLATFORM_ADMIN;
    const isCurrentHolder = tapal.currentHolderId === user.id;

    if (!isPlatformAdmin && !isAdminOfOffice && !isCurrentHolder) {
      res.status(403).json({ error: 'Only the current holder or Office Admin can forward this Tapal' });
      return;
    }

    // Verify recipient user exists and belongs to the same city
    const recipient = await prisma.user.findUnique({ where: { id: body.toUserId } });
    if (!recipient) {
      res.status(400).json({ error: 'Recipient user not found' });
      return;
    }

    if (recipient.officeId !== tapal.officeId) {
      res.status(400).json({ error: 'Recipient user must belong to the same office' });
      return;
    }

    // Update current holder and status
    const updatedTapal = await prisma.tapal.update({
      where: { id },
      data: {
        currentHolderId: body.toUserId,
        status: TapalStatus.InProgress,
      },
    });

    // Record movement
    await prisma.movement.create({
      data: {
        tapalId: id,
        fromUserId: user.id,
        toUserId: body.toUserId,
        actionTaken: body.actionTaken,
        remarks: body.remarks || null,
      },
    });

    res.json(updatedTapal);
  } catch (err) {
    next(err);
  }
};

export const resolveTapal = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const body = resolveTapalSchema.parse(req.body);

    const tapal = await prisma.tapal.findUnique({ where: { id } });
    if (!tapal) {
      res.status(404).json({ error: 'Tapal not found' });
      return;
    }

    if (tapal.currentHolderId !== user.id) {
      res.status(403).json({ error: 'Only the current holder can resolve this Tapal' });
      return;
    }

    const updatedTapal = await prisma.tapal.update({
      where: { id },
      data: {
        status: TapalStatus.Resolved,
      },
    });

    await prisma.movement.create({
      data: {
        tapalId: id,
        fromUserId: user.id,
        toUserId: user.id, // self-ref for final resolution
        actionTaken: 'Resolved',
        remarks: body.remarks || 'Tapal resolved and closed',
      },
    });

    res.json(updatedTapal);
  } catch (err) {
    next(err);
  }
};

export const returnTapal = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const body = resolveTapalSchema.parse(req.body); // reuse for simple remarks

    const tapal = await prisma.tapal.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (!tapal) {
      res.status(404).json({ error: 'Tapal not found' });
      return;
    }

    if (tapal.currentHolderId !== user.id) {
      res.status(403).json({ error: 'Only the current holder can return this Tapal' });
      return;
    }

    // Determine target user to return to (previous holder)
    let targetUserId = tapal.movements[0]?.fromUserId;

    // If no previous movement, return to creator (the one who uploaded it)
    if (!targetUserId) {
      // Find audit trail or use department head or reject
      res.status(400).json({ error: 'Cannot return a Tapal that has not been forwarded yet' });
      return;
    }

    const updatedTapal = await prisma.tapal.update({
      where: { id },
      data: {
        currentHolderId: targetUserId,
        status: TapalStatus.Returned,
      },
    });

    await prisma.movement.create({
      data: {
        tapalId: id,
        fromUserId: user.id,
        toUserId: targetUserId,
        actionTaken: 'Returned',
        remarks: body.remarks || 'Returned to previous desk',
      },
    });

    res.json(updatedTapal);
  } catch (err) {
    next(err);
  }
};

export const viewTapalAttachment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const tapal = await prisma.tapal.findUnique({
      where: { id },
    });

    if (!tapal || !tapal.fileAttachment || !tapal.fileAttachment.storageKey) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const { storageKey, originalFilename } = tapal.fileAttachment;
    const filename = originalFilename || 'document.pdf';

    logger.info(`viewTapalAttachment: id=${id}, storageKey=${storageKey}`);

    // If local file path
    const isLocalUrl = !storageKey.startsWith('http') || storageKey.includes('localhost') || storageKey.includes('127.0.0.1');
    if (isLocalUrl) {
      const filenamePart = storageKey.split(/[\\/]/).pop() || '';
      const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
      const localFilePath = path.join(uploadDir, filenamePart);
      if (fs.existsSync(localFilePath)) {
        const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
        fs.createReadStream(localFilePath).pipe(res);
        return;
      }
    }

    // Remote file path (R2 or generic S3 URL)
    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
    try {
      if (storageKey.includes('.r2.cloudflarestorage.com')) {
        const urlObj = new URL(storageKey);
        const bucketName = process.env.R2_BUCKET_NAME || urlObj.hostname.split('.')[0];
        const key = decodeURIComponent(urlObj.pathname.substring(1));

        logger.info(`viewTapalAttachment: Streaming from Cloudflare R2. Bucket: ${bucketName}, Key: ${key}`);

        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        });
        const r2Response = await r2Client.send(command);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);

        (r2Response.Body as any).pipe(res);
        return;
      }

      // Generic URL fallback (e.g. old Cloudinary URLs)
      logger.info(`viewTapalAttachment: Streaming generic remote URL: ${storageKey}`);
      const axios = require('axios');
      const response = await axios({
        method: 'get',
        url: encodeURI(storageKey),
        responseType: 'stream',
        timeout: 15000
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
      response.data.pipe(res);
      return;
    } catch (streamErr: any) {
      logger.error(`Failed to proxy stream tapal attachment. URL attempted: ${storageKey}. Error: ${streamErr.message}`, streamErr);
    }

    res.status(404).json({ error: 'File not found on disk and remote proxy streaming failed.' });
  } catch (err) {
    next(err);
  }
};
