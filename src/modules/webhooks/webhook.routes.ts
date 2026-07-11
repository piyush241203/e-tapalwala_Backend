import { Request, Response, NextFunction, Router } from 'express';
import { prisma } from '../../config/database';
import { MetaWhatsAppService } from '../messaging/meta.service';
import { normalizeMetaStatus } from '../messaging/unified.service';
import { logger } from '../../config/logger';

export const webhookRouter = Router();

// ─── Meta WhatsApp Webhook ───────────────────────────────────────────────────
webhookRouter.get('/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const result = MetaWhatsAppService.verifyWebhook(token, mode, challenge);
  if (result) {
    res.send(result);
  } else {
    res.sendStatus(403);
  }
});

webhookRouter.post('/meta', async (req: Request, res: Response) => {
  try {
    const statusUpdate = MetaWhatsAppService.parseWebhookStatus(req.body);

    if (statusUpdate) {
      const normalizedStatus = normalizeMetaStatus(statusUpdate.status);

      await prisma.messageLog.updateMany({
        where: { providerMessageId: statusUpdate.messageId },
        data: {
          status: normalizedStatus as any,
          ...(normalizedStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          ...(normalizedStatus === 'READ' ? { readAt: new Date() } : {}),
          ...(statusUpdate.error ? { error: statusUpdate.error } : {}),
        },
      });

      logger.info(`Meta webhook: ${statusUpdate.messageId} → ${normalizedStatus}`);
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error('Meta webhook error:', err);
    res.sendStatus(200); // Always 200 to prevent retries
  }
});

