import { Response, NextFunction } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { sendMessage } from '../messaging/unified.service';
import { auditLog } from '../audit/audit.service';
import { singleSendSchema, bulkSendSchema } from './operator.schema';
import { logger } from '../../config/logger';
import { uploadFileToCloudinary } from '../../config/cloudinary';
import {
  Prisma,
  Channel,
  Provider,
  MessageType,
  MessageStatus,
  BulkOperationStatus,
} from '@prisma/client';

function parseAndExtractRecipients(csvContent: string): { mobile: string; name?: string }[] {
  const rawRows: string[][] = parse(csvContent, { 
    columns: false, 
    skip_empty_lines: true, 
    trim: true 
  });

  if (rawRows.length === 0) {
    return [];
  }

  const isMobilePattern = (val: string) => {
    const clean = val.replace(/[\s\-+]/g, '');
    return /^\d{8,15}$/.test(clean);
  };

  const firstRow = rawRows[0];
  let hasHeader = false;
  
  const hasAlphabet = firstRow.some(val => /[a-zA-Z]/.test(val));
  const firstRowHasMobile = firstRow.some(val => isMobilePattern(val));
  
  if (hasAlphabet && !firstRowHasMobile) {
    hasHeader = true;
  }

  let mobileColIndex = -1;
  let nameColIndex = -1;

  if (hasHeader) {
    const possibleMobileHeaders = ['mobile', 'phone', 'number', 'contact', 'whatsapp'];
    const possibleNameHeaders = ['name', 'full name', 'username', 'recipient'];

    for (let colIdx = 0; colIdx < firstRow.length; colIdx++) {
      const headerVal = firstRow[colIdx].toLowerCase();
      if (mobileColIndex === -1 && possibleMobileHeaders.some(h => headerVal.includes(h))) {
        mobileColIndex = colIdx;
      }
      if (nameColIndex === -1 && possibleNameHeaders.some(h => headerVal.includes(h))) {
        nameColIndex = colIdx;
      }
    }

    if (mobileColIndex === -1 && rawRows.length > 1) {
      for (let colIdx = 0; colIdx < rawRows[1].length; colIdx++) {
        if (isMobilePattern(rawRows[1][colIdx])) {
          mobileColIndex = colIdx;
          break;
        }
      }
    }
  } else {
    for (let colIdx = 0; colIdx < firstRow.length; colIdx++) {
      if (isMobilePattern(firstRow[colIdx])) {
        mobileColIndex = colIdx;
        break;
      }
    }
    if (mobileColIndex === -1) {
      mobileColIndex = 0;
    }
  }

  if (mobileColIndex === -1) {
    throw new Error('No mobile number column identified in the CSV file.');
  }

  const startRowIdx = hasHeader ? 1 : 0;
  const recipients: { mobile: string; name?: string }[] = [];

  for (let i = startRowIdx; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rawMobile = row[mobileColIndex];
    if (rawMobile) {
      const cleanMobile = rawMobile.replace(/[\s\-]/g, '');
      let formattedMobile = cleanMobile;
      if (formattedMobile.startsWith('+')) {
        formattedMobile = formattedMobile.slice(1);
      }
      if (/^\d{10}$/.test(formattedMobile)) {
        formattedMobile = '91' + formattedMobile;
      }

      if (/^\d{8,15}$/.test(formattedMobile)) {
        const nameVal = nameColIndex !== -1 ? row[nameColIndex] : undefined;
        recipients.push({
          mobile: `+${formattedMobile}`,
          name: nameVal?.trim() || undefined
        });
      }
    }
  }

  return recipients;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

function getFileUrl(storedName: string): string {
  return `${process.env.API_URL || 'http://localhost:4000'}/uploads/${storedName}`;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const getDashboard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const cityId = req.user!.cityId!;

    const [totalSent, pending, failed, delivered] = await Promise.all([
      prisma.messageLog.count({ where: { operatorId, status: MessageStatus.SENT } }),
      prisma.messageLog.count({ where: { operatorId, status: { in: [MessageStatus.QUEUED, MessageStatus.PROCESSING] } } }),
      prisma.messageLog.count({ where: { operatorId, status: MessageStatus.FAILED } }),
      prisma.messageLog.count({ where: { operatorId, status: { in: [MessageStatus.DELIVERED, MessageStatus.READ] } } }),
    ]);

    const recentLogs = await prisma.messageLog.findMany({
      where: { operatorId },
      include: { document: { select: { originalName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({ stats: { totalSent, pending, failed, delivered }, recentLogs });
  } catch (err) {
    next(err);
  }
};

// ─── Single Send ─────────────────────────────────────────────────────────────
export const sendSingle = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const cityId = req.user!.cityId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'PDF file is required' });
      return;
    }

    const body = singleSendSchema.parse(req.body);

    // Validate Office & Credits
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    const office = req.user!.officeId ? await prisma.office.findUnique({ where: { id: req.user!.officeId } }) : null;

    if (office?.whatsappDisabled) {
      res.status(403).json({ error: 'WhatsApp sending is disabled for your office.' });
      return;
    }

    if (city.whatsappMonthlyLimit > 0) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlySent = await prisma.messageLog.count({
        where: {
          cityId,
          createdAt: { gte: startOfMonth },
          status: { not: 'FAILED' }
        }
      });

      if (monthlySent + 1 > city.whatsappMonthlyLimit) {
        res.status(403).json({ error: 'Monthly message limit reached for this city office.' });
        return;
      }
    }

    // Upload PDF to Cloudinary
    const cityName = city.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const officeName = office ? office.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'general';
    const folderPath = `etapalwala_files/${cityName}/${officeName}/pdfs`;
    const cloudinaryUrl = await uploadFileToCloudinary(file.path, file.originalname, folderPath);

    // Create document record
    const document = await prisma.document.create({
      data: {
        originalName: file.originalname,
        storedName: file.filename,
        fileUrl: cloudinaryUrl,
        fileSize: BigInt(file.size),
        mimeType: file.mimetype,
        uploadedById: operatorId,
        cityId,
        recipientMobile: body.recipientMobile,
        messageType: MessageType.SINGLE,
        status: 'UPLOADED',
      } satisfies Prisma.DocumentUncheckedCreateInput,
    });

    // Find or create a recipient record for this mobile
    let recipient = await prisma.recipient.findFirst({
      where: { mobile: body.recipientMobile, cityId, operatorId },
    });
    if (!recipient) {
      recipient = await prisma.recipient.create({
        data: {
          mobile: body.recipientMobile,
          cityId,
          operatorId,
          documentId: document.id,
          status: MessageStatus.QUEUED,
        } satisfies Prisma.RecipientUncheckedCreateInput,
      });
    }

    // Create message log
    const messageLog = await prisma.messageLog.create({
      data: {
        recipientId: recipient.id,
        cityId,
        operatorId,
        documentId: document.id,
        recipientMobile: body.recipientMobile,
        channel: body.channel as Channel,
        provider: body.provider as Provider,
        body: body.body,
        status: MessageStatus.QUEUED,
      } satisfies Prisma.MessageLogUncheckedCreateInput,
    });

    // Send synchronously to return immediate results
    try {
      await sendMessage({
        messageLogId: messageLog.id,
        to: body.recipientMobile,
        channel: body.channel as Channel,
        provider: body.provider as Provider,
        documentUrl: document.fileUrl,
        documentName: document.originalName,
        storedName: document.storedName,
        body: body.body,
        cityId,
        fallbackEnabled: body.fallbackEnabled,
      });

      const updatedLog = await prisma.messageLog.findUnique({
        where: { id: messageLog.id },
      });

      if (updatedLog?.status === 'FAILED') {
        res.status(400).json({ error: updatedLog.error || 'Message delivery failed' });
        return;
      }

      await auditLog({
        actorId: operatorId,
        cityId,
        action: 'SEND_SINGLE_MESSAGE',
        entityType: 'MessageLog',
        entityId: messageLog.id,
        metadata: { to: body.recipientMobile, channel: body.channel, provider: body.provider },
      });

      res.status(201).json({
        message: 'Message sent successfully',
        messageLogId: messageLog.id,
        documentId: document.id,
        status: updatedLog?.status,
        providerMessageId: updatedLog?.providerMessageId,
      });
    } catch (sendErr: any) {
      res.status(400).json({ error: sendErr.message || 'Message delivery failed' });
    }
  } catch (err) {
    next(err);
  }
};

// ─── Bulk Send ───────────────────────────────────────────────────────────────
export const sendBulk = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const cityId = req.user!.cityId!;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    const pdfFile = files?.['pdf']?.[0];
    const csvFile = files?.['csv']?.[0];

    if (!pdfFile) {
      res.status(400).json({ error: 'PDF file is required' });
      return;
    }
    if (!csvFile) {
      res.status(400).json({ error: 'CSV file is required' });
      return;
    }

    const body = bulkSendSchema.parse(req.body);

    // Parse CSV and extract recipients
    let recipients: { mobile: string; name?: string }[];
    try {
      const csvContent = fs.readFileSync(csvFile.path, 'utf-8');
      recipients = parseAndExtractRecipients(csvContent);
    } catch (parseErr: any) {
      res.status(400).json({ error: parseErr.message || 'Invalid CSV file' });
      return;
    }

    if (recipients.length === 0) {
      res.status(400).json({ error: 'No valid mobile numbers found in CSV' });
      return;
    }

    // Validate Office & Credits
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    const office = req.user!.officeId ? await prisma.office.findUnique({ where: { id: req.user!.officeId } }) : null;

    if (office?.whatsappDisabled) {
      res.status(403).json({ error: 'WhatsApp sending is disabled for your office.' });
      return;
    }

    const requiredMessages = recipients.length;

    if (city.whatsappMonthlyLimit > 0) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlySent = await prisma.messageLog.count({
        where: {
          cityId,
          createdAt: { gte: startOfMonth },
          status: { not: 'FAILED' }
        }
      });

      if (monthlySent + requiredMessages > city.whatsappMonthlyLimit) {
        res.status(403).json({ error: `This bulk upload exceeds the monthly message limit of ${city.whatsappMonthlyLimit} messages.` });
        return;
      }
    }

    // Upload PDF and CSV to Cloudinary
    const cityName = city.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const officeName = office ? office.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'general';
    const pdfFolder = `etapalwala_files/${cityName}/${officeName}/pdfs`;
    const csvFolder = `etapalwala_files/${cityName}/${officeName}/csvs`;

    const cloudinaryUrl = await uploadFileToCloudinary(pdfFile.path, pdfFile.originalname, pdfFolder);
    const csvCloudinaryUrl = await uploadFileToCloudinary(csvFile.path, csvFile.originalname, csvFolder);

    // Create document record
    const document = await prisma.document.create({
      data: {
        originalName: pdfFile.originalname,
        storedName: pdfFile.filename,
        fileUrl: cloudinaryUrl,
        fileSize: BigInt(pdfFile.size),
        mimeType: pdfFile.mimetype,
        uploadedById: operatorId,
        cityId,
        messageType: MessageType.BULK,
        status: 'UPLOADED',
      } satisfies Prisma.DocumentUncheckedCreateInput,
    });

    // Create bulk operation
    const bulkOp = await prisma.bulkOperation.create({
      data: {
        name: body.name,
        cityId,
        operatorId,
        documentId: document.id,
        csvFileUrl: csvCloudinaryUrl,
        channel: body.channel as Channel,
        provider: body.provider as Provider,
        totalRecipients: recipients.length,
        queuedCount: recipients.length,
        status: BulkOperationStatus.QUEUED,
        startedAt: new Date(),
      } satisfies Prisma.BulkOperationUncheckedCreateInput,
    });

    // Bulk-create recipients
    await prisma.recipient.createMany({
      data: recipients.map(r => ({
        mobile: r.mobile,
        cityId,
        operatorId,
        documentId: document.id,
        bulkOperationId: bulkOp.id,
        status: MessageStatus.QUEUED,
      } satisfies Prisma.RecipientUncheckedCreateInput)),
    });

    const createdRecipients = await prisma.recipient.findMany({
      where: { bulkOperationId: bulkOp.id },
      select: { id: true, mobile: true },
    });

    // Create all message logs
    const messageLogsData = createdRecipients.map(r => ({
      recipientId: r.id,
      cityId,
      operatorId,
      documentId: document.id,
      bulkOperationId: bulkOp.id,
      recipientMobile: r.mobile,
      channel: body.channel as Channel,
      provider: body.provider as Provider,
      body: body.body,
      status: MessageStatus.QUEUED,
    } satisfies Prisma.MessageLogUncheckedCreateInput));

    await prisma.messageLog.createMany({ data: messageLogsData });

    // Fetch created logs to process
    const createdLogs = await prisma.messageLog.findMany({
      where: { bulkOperationId: bulkOp.id },
      select: { id: true, recipientMobile: true },
    });

    // Process in background
    setImmediate(async () => {
      await prisma.bulkOperation.update({
        where: { id: bulkOp.id },
        data: { status: BulkOperationStatus.PROCESSING },
      });

      let sentCount = 0;
      let failedCount = 0;

      for (const log of createdLogs) {
        try {
          await sendMessage({
            messageLogId: log.id,
            to: log.recipientMobile,
            channel: body.channel,
            provider: body.provider,
            documentUrl: document.fileUrl,
            documentName: document.originalName,
            storedName: document.storedName,
            body: body.body,
            cityId,
            fallbackEnabled: body.fallbackEnabled,
          });
          sentCount++;
        } catch (err) {
          failedCount++;
          logger.error(`Bulk send failed for ${log.recipientMobile}:`, err);
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 200));
      }

      await prisma.bulkOperation.update({
        where: { id: bulkOp.id },
        data: {
          status: failedCount === recipients.length ? BulkOperationStatus.FAILED : BulkOperationStatus.COMPLETED,
          sentCount,
          failedCount,
          completedAt: new Date(),
        },
      });
    });

    await auditLog({
      actorId: operatorId,
      cityId,
      action: 'SEND_BULK_MESSAGE',
      entityType: 'BulkOperation',
      entityId: bulkOp.id,
      metadata: { totalRecipients: recipients.length, channel: body.channel },
    });

    res.status(201).json({
      message: 'Bulk operation started',
      bulkOperationId: bulkOp.id,
      totalRecipients: recipients.length,
      preview: recipients.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
};

// ─── My Logs ─────────────────────────────────────────────────────────────────
export const getMyLogs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '10');
    const { status, channel, search } = req.query;

    const singleWhere: any = { 
      operatorId, 
      OR: [
        { bulkOperationId: null },
        { bulkOperationId: { isSet: false } }
      ],
      ...(status ? { status: status as MessageStatus } : {}),
      ...(channel ? { channel: channel as Channel } : {}),
      ...(search ? { recipientMobile: { contains: search as string } } : {}),
    };

    const bulkWhere: any = { 
      operatorId,
      ...(channel ? { channel: channel as Channel } : {}),
      ...(search ? { name: { contains: search as string } } : {}),
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

    const [singleCount, bulkCount] = await Promise.all([
      prisma.messageLog.count({ where: singleWhere }),
      prisma.bulkOperation.count({ where: bulkWhere }),
    ]);

    const total = singleCount + bulkCount;

    const [singleLogs, bulkOps] = await Promise.all([
      prisma.messageLog.findMany({
        where: singleWhere,
        include: { document: { select: { id: true, originalName: true, fileUrl: true } } },
        orderBy: { createdAt: 'desc' },
        take: page * limit,
      }),
      prisma.bulkOperation.findMany({
        where: bulkWhere,
        include: { document: { select: { id: true, originalName: true, fileUrl: true } } },
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

// ─── Bulk Operation Status ───────────────────────────────────────────────────
export const getBulkOperation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role, cityId } = req.user!;

    let whereClause: any = { id };
    if (role !== 'PLATFORM_ADMIN') {
      if (role === 'CITY_ADMIN' || role === 'Admin') {
        whereClause.cityId = cityId;
      } else {
        // OPERATOR/Clerk/etc
        whereClause.operatorId = userId;
      }
    }

    const bulkOp = await prisma.bulkOperation.findFirst({
      where: whereClause,
      include: { document: { select: { id: true, originalName: true } } },
    });

    if (!bulkOp) {
      res.status(404).json({ error: 'Bulk operation not found' });
      return;
    }

    const statusBreakdown = await prisma.messageLog.groupBy({
      by: ['status'],
      _count: { status: true },
      where: { bulkOperationId: id },
    });

    res.json({ ...bulkOp, statusBreakdown });
  } catch (err) {
    next(err);
  }
};

// ─── Retry Failed ────────────────────────────────────────────────────────────
export const retryMessage = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const cityId = req.user!.cityId!;
    const { id } = req.params;

    // Validate Office
    const office = req.user!.officeId ? await prisma.office.findUnique({ where: { id: req.user!.officeId } }) : null;
    if (office?.whatsappDisabled) {
      res.status(403).json({ error: 'WhatsApp sending is disabled for your office.' });
      return;
    }

    const log = await prisma.messageLog.findFirst({
      where: { id, operatorId, status: MessageStatus.FAILED },
      include: { document: true },
    });

    if (!log) {
      res.status(404).json({ error: 'Failed message not found' });
      return;
    }

    if (log.retryCount >= 3) {
      res.status(400).json({ error: 'Maximum retry attempts reached' });
      return;
    }

    await prisma.messageLog.update({
      where: { id },
      data: { status: MessageStatus.RETRYING, retryCount: { increment: 1 }, lastRetryAt: new Date() },
    });

    sendMessage({
      messageLogId: id,
      to: log.recipientMobile,
      channel: log.channel,
      provider: log.provider,
      documentUrl: log.document?.fileUrl,
      documentName: log.document?.originalName,
      body: log.body || undefined,
      cityId,
      fallbackEnabled: false,
    }).catch((err) => logger.error('Retry send failed:', err));

    res.json({ message: 'Message retry queued' });
  } catch (err) {
    next(err);
  }
};

// ─── Failed/Retry Queue ──────────────────────────────────────────────────────
export const getFailedMessages = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');

    const [logs, total] = await Promise.all([
      prisma.messageLog.findMany({
        where: { operatorId, status: { in: [MessageStatus.FAILED, MessageStatus.RETRYING] } },
        include: { document: { select: { originalName: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.messageLog.count({ where: { operatorId, status: { in: [MessageStatus.FAILED, MessageStatus.RETRYING] } } }),
    ]);

    res.json({ data: logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

// ─── CSV Preview ─────────────────────────────────────────────────────────────
export const previewCsv = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'CSV file is required' });
      return;
    }

    const csvContent = fs.readFileSync(file.path, 'utf-8');
    
    // Clean up temp file
    fs.unlinkSync(file.path);

    try {
      const recipients = parseAndExtractRecipients(csvContent);
      
      res.json({
        totalRows: recipients.length,
        columns: ['Mobile', 'Name'],
        mobileColumn: 'Mobile',
        preview: recipients.slice(0, 50).map(r => ({ Mobile: r.mobile, Name: r.name || '' })),
        validRows: recipients.length,
      });
    } catch (parseErr: any) {
      res.status(400).json({ error: parseErr.message || 'Invalid CSV file' });
    }
  } catch (err) {
    next(err);
  }
};

// ─── View Document Inline ────────────────────────────────────────────────────
export const viewDocument = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, fileUrl: true, originalName: true, mimeType: true, storedName: true },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // ── 1. If it's a local file and exists on disk, serve it directly ────────
    if (document.storedName) {
      const localFilePath = path.join(__dirname, '..', '..', '..', 'uploads', document.storedName);
      if (fs.existsSync(localFilePath)) {
        res.setHeader('Content-Type', document.mimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.originalName)}"`);
        fs.createReadStream(localFilePath).pipe(res);
        return;
      }
    }

    // ── 2. If the file is on Cloudinary, stream it inline to avoid redirection issues
    const isCloudinary = document.fileUrl && document.fileUrl.includes('cloudinary.com');
    if (isCloudinary) {
      try {
        res.setHeader('Content-Type', document.mimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.originalName)}"`);
        
        const response = await axios({
          method: 'get',
          url: document.fileUrl,
          responseType: 'stream',
          timeout: 10000
        });
        
        response.data.pipe(res);
        return;
      } catch (streamErr) {
        logger.error('Failed to proxy stream document from Cloudinary, redirecting directly', streamErr);
        res.redirect(document.fileUrl);
        return;
      }
    }

    res.status(404).json({ error: 'File not found on disk and Cloudinary URL is not available.' });
  } catch (err) {
    next(err);
  }
};
