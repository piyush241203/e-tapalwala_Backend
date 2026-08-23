import { prisma } from '../../config/database';
import { MetaWhatsAppService } from './meta.service';
import { logger } from '../../config/logger';
import { Channel, Provider } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

export interface SendMessageOptions {
  messageLogId: string;
  to: string;
  channel: Channel;
  provider: Provider;
  /** Absolute path to the PDF on local disk — used directly for Meta media upload */
  localFilePath: string;
  documentName?: string;
  body?: string;
  cityId: string;
  fallbackEnabled?: boolean;
}

async function getSettings(cityId?: string) {
  // Try city-level settings first, then global
  const settings = await prisma.messagingSettings.findFirst({
    where: cityId ? { OR: [{ cityId }, { scope: 'GLOBAL' }] } : { scope: 'GLOBAL' },
    orderBy: { scope: 'asc' }, // CITY before GLOBAL
  });
  return settings;
}

function mapWhatsAppError(error: any): string {
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    logger.error(`[WhatsApp API Error Response] Status: ${status}, Body: ${JSON.stringify(data)}`);

    if (status === 401 || status === 403) {
      return "Invalid WhatsApp API Token or Key Disabled. Please check your configuration.";
    }

    if (data && data.error) {
      const code = data.error.code;
      const message = data.error.message || '';

      if (code === 131026) return "Message failed: Phone number is not registered on WhatsApp.";
      if (code === 131021) return "Message failed: Invalid phone number format.";
      if (code === 131047) return "Message failed: Phone number is not a valid WhatsApp number.";
      if (code === 100) {
        if (
          message.toLowerCase().includes('sandbox') ||
          message.toLowerCase().includes('test number') ||
          message.toLowerCase().includes('allowed list') ||
          message.toLowerCase().includes('verify')
        ) {
          return "Message failed: Recipient number is not verified in sandbox settings. Please verify it in your Meta Developer Console.";
        }
        return `Message failed: Invalid parameter - ${message}`;
      }
      if (code === 131008) return "Message failed: WABA Currency and Payment issue.";
      if (code === 131009) return "Message failed: WABA Payment issue.";

      return `WhatsApp API Error (${code}): ${message}`;
    }
  }

  if (error.message && (error.message.includes('status code 401') || error.message.includes('401'))) {
    return "Invalid WhatsApp API Token or Key Disabled. Please check your configuration.";
  }

  return error.message || "Unknown WhatsApp API Error";
}

export async function sendMessage(opts: SendMessageOptions): Promise<void> {
  const settings = await getSettings(opts.cityId);

  const hasEnvSettings = !!(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID);
  if (!settings && !hasEnvSettings) {
    const err = 'No messaging settings configured';
    await updateStatus(opts.messageLogId, 'FAILED', err);
    throw new Error(err);
  }

  await updateStatus(opts.messageLogId, 'PROCESSING');

  try {
    if (opts.provider === 'META' && opts.channel === 'WHATSAPP') {
      await sendViaMeta(opts, settings);
    } else {
      throw new Error(`Unsupported provider/channel: ${opts.provider}/${opts.channel}`);
    }
  } catch (primaryError: any) {
    const errorMsg = mapWhatsAppError(primaryError);
    logger.warn(`Primary send failed: ${errorMsg}`);
    await updateStatus(opts.messageLogId, 'FAILED', errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Upload a local file stream directly to the Meta media API.
 * Returns the Meta media ID.
 */
async function uploadLocalFileToMeta(
  localFilePath: string,
  filename: string,
  mimeType: string,
  accessToken: string,
  phoneNumberId: string,
  apiVersion: string
): Promise<string> {
  if (!fs.existsSync(localFilePath)) {
    throw new Error(`Local file not found at path: ${localFilePath}`);
  }

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', fs.createReadStream(localFilePath), { filename, contentType: mimeType });
  formData.append('type', mimeType);

  logger.info(`[WhatsApp] Uploading local file to Meta media API: ${localFilePath}`);

  const response = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...formData.getHeaders(),
      },
    }
  );

  if (!response.data || !response.data.id) {
    throw new Error('Meta media upload failed: ' + JSON.stringify(response.data));
  }

  logger.info(`[WhatsApp] Meta media upload success. Media ID: ${response.data.id}`);
  return response.data.id;
}

async function sendViaMeta(opts: SendMessageOptions, settings: any) {
  const accessToken = process.env.META_ACCESS_TOKEN || settings?.metaAccessToken;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID || settings?.metaPhoneNumberId;
  const apiVersion = process.env.META_API_VERSION || settings?.metaApiVersion || 'v19.0';
  const templateName = process.env.META_TEMPLATE_NAME || 'etapalwala_update';

  logger.info(`[WhatsApp Trace] cityId: ${opts.cityId}`);
  logger.info(`[WhatsApp Trace] Settings Scope: ${settings?.scope || 'NONE'}`);
  logger.info(`[WhatsApp Trace] Resolved Token: ${accessToken ? accessToken.slice(0, 15) : 'UNDEFINED'}...`);
  logger.info(`[WhatsApp Trace] Resolved Phone ID: ${phoneNumberId}`);

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'Meta WhatsApp not configured. Please define META_ACCESS_TOKEN and META_PHONE_NUMBER_ID in .env or Super Admin Settings.'
    );
  }

  if (!opts.localFilePath) {
    throw new Error('localFilePath is required to send a document via Meta WhatsApp.');
  }

  // ── Clean filename
  const rawFilename = opts.documentName || 'Notice.pdf';
  const ext = path.extname(rawFilename);
  const baseName = path.basename(rawFilename, ext);
  const cleanBaseName = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `${cleanBaseName}${ext}`;
  const mimeType = 'application/pdf';

  // ── Normalize phone number (strip non-digits, ensure country code)
  let cleanTo = String(opts.to || '').replace(/\D/g, '');
  if (cleanTo.startsWith('00')) cleanTo = cleanTo.slice(2);
  else if (cleanTo.startsWith('0')) cleanTo = cleanTo.slice(1);
  if (cleanTo.length === 10) cleanTo = '91' + cleanTo;
  logger.info(`[WhatsApp] Sending to: ${cleanTo}`);

  // ── STEP 1: Upload local disk file directly to Meta media API
  const mediaId = await uploadLocalFileToMeta(
    opts.localFilePath,
    filename,
    mimeType,
    accessToken,
    phoneNumberId,
    apiVersion
  );

  // ── STEP 2: Send template message with mediaId in header
  // Template: etapalwala_update | ID: 1419599073102113 | Category: Utility | Language: en_US
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: {
                id: mediaId,
                filename,
              },
            },
          ],
        },
      ],
    },
  };

  logger.info(`[WhatsApp] Sending template to ${cleanTo} with media ID: ${mediaId}`);

  const res = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (res.data.error || res.status >= 400) {
    throw new Error(`WhatsApp Template API Error: ${JSON.stringify(res.data.error || res.data)}`);
  }

  const message = res.data.messages?.[0];
  if (!message || !message.id) {
    throw new Error('Meta API returned no message ID: ' + JSON.stringify(res.data));
  }

  await prisma.messageLog.update({
    where: { id: opts.messageLogId },
    data: {
      status: 'SENT',
      providerMessageId: message.id,
      sentAt: new Date(),
    },
  });

  logger.info(`[WhatsApp] ✅ Template message sent! Message ID: ${message.id}`);
}

async function updateStatus(messageLogId: string, status: any, error?: string) {
  await prisma.messageLog.update({
    where: { id: messageLogId },
    data: {
      status,
      ...(error ? { error } : {}),
    },
  });
}

export function normalizeMetaStatus(metaStatus: string): string {
  const map: Record<string, string> = {
    sent: 'SENT',
    delivered: 'DELIVERED',
    read: 'READ',
    failed: 'FAILED',
  };
  return map[metaStatus] || 'SENT';
}
