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
  documentUrl?: string;
  documentName?: string;
  storedName?: string;
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

    if (status === 401 || status === 403) {
      return "Invalid WhatsApp API Token or Key Disabled. Please check your configuration.";
    }

    if (data && data.error) {
      const code = data.error.code;
      const message = data.error.message;

      if (code === 131026) return "Message failed: Phone number is not registered on WhatsApp.";
      if (code === 131021) return "Message failed: Invalid phone number format.";
      if (code === 131047) return "Message failed: Phone number is not a valid WhatsApp number.";
      if (code === 100) return "Message failed: Invalid parameter (likely phone number).";
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

  // If there are no settings in DB AND no process.env settings, block
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

async function uploadMediaToMeta(
  stream: any,
  filename: string,
  mimeType: string,
  accessToken: string,
  phoneNumberId: string,
  apiVersion: string
): Promise<string> {
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', stream, { filename });
  formData.append('type', mimeType);

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

  return response.data.id;
}

async function sendViaMeta(opts: SendMessageOptions, settings: any) {
  const accessToken = process.env.META_ACCESS_TOKEN || settings?.metaAccessToken;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID || settings?.metaPhoneNumberId;
  const apiVersion = process.env.META_API_VERSION || settings?.metaApiVersion || 'v19.0';

  logger.info(`[WhatsApp Trace] opts.cityId: ${opts.cityId}`);
  logger.info(`[WhatsApp Trace] Settings Scope: ${settings?.scope || 'NONE'}`);
  logger.info(`[WhatsApp Trace] Env Token: ${process.env.META_ACCESS_TOKEN ? process.env.META_ACCESS_TOKEN.slice(0, 15) : 'UNDEFINED'}...`);
  logger.info(`[WhatsApp Trace] DB Token: ${settings?.metaAccessToken ? settings.metaAccessToken.slice(0, 15) : 'UNDEFINED'}...`);
  logger.info(`[WhatsApp Trace] Resolved Token: ${accessToken ? accessToken.slice(0, 15) : 'UNDEFINED'}...`);
  logger.info(`[WhatsApp Trace] Resolved Phone ID: ${phoneNumberId}`);

  if (!accessToken || !phoneNumberId) {
    throw new Error('Meta WhatsApp not configured. Please define META_ACCESS_TOKEN and META_PHONE_NUMBER_ID in .env or Super Admin Settings.');
  }

  if (!opts.documentUrl) {
    throw new Error('Document URL is required for Meta WhatsApp');
  }

  // 1. Get document stream (from local disk if exists, otherwise download via HTTP)
  let stream: any;
  const filename = opts.documentName || 'Notice.pdf';
  const mimeType = 'application/pdf';

  // Try checking disk first using storedName if present (avoids downloading from Cloudinary entirely)
  if (opts.storedName) {
    const localFilePath = path.join(__dirname, '..', '..', '..', 'uploads', opts.storedName);
    if (fs.existsSync(localFilePath)) {
      stream = fs.createReadStream(localFilePath);
      logger.info(`Resolved document locally on disk using storedName: ${localFilePath}`);
    }
  }

  // Parse localhost fallback
  if (!stream) {
    const isLocalhost = opts.documentUrl.includes('localhost') || opts.documentUrl.includes('127.0.0.1');
    if (isLocalhost) {
      const fileParts = opts.documentUrl.split('/uploads/');
      const localName = fileParts.pop();
      const localFilePath = path.join(__dirname, '..', '..', '..', 'uploads', localName || '');
      if (fs.existsSync(localFilePath)) {
        stream = fs.createReadStream(localFilePath);
      }
    }
  }

  // Fallback to HTTP download
  if (!stream) {
    let docUrl = opts.documentUrl;
    const isLocalhost = opts.documentUrl.includes('localhost') || opts.documentUrl.includes('127.0.0.1');
    if (isLocalhost) {
      docUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
      logger.info(`Localhost file not found on disk. Downloading public dummy PDF instead: ${docUrl}`);
    }
    try {
      const downloadRes = await axios.get(docUrl, { responseType: 'stream' });
      stream = downloadRes.data;
    } catch (downloadErr: any) {
      throw new Error(`Failed to retrieve document from storage URL (${docUrl}): ${downloadErr.message}. Ensure your file server or Cloudinary account is active.`);
    }
  }

  // 2. Upload to Meta media API
  logger.info(`Uploading document stream to Meta...`);
  const mediaId = await uploadMediaToMeta(stream, filename, mimeType, accessToken, phoneNumberId, apiVersion);
  logger.info(`Meta media upload success. Media ID: ${mediaId}`);

  // 3. Send template message with document id in the header component
  let cleanTo = String(opts.to || '').replace(/\D/g, '');
  if (cleanTo.startsWith('00')) {
    cleanTo = cleanTo.slice(2);
  } else if (cleanTo.startsWith('0')) {
    cleanTo = cleanTo.slice(1);
  }
  if (cleanTo.length === 10) {
    cleanTo = '91' + cleanTo;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'template',
    template: {
      name: 'etapalwala_template',
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: {
                id: mediaId,
                filename: filename
              }
            }
          ]
        }
      ]
    }
  };

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

  logger.info(`Meta WhatsApp Template sent successfully: ${message.id}`);
}

async function updateStatus(messageLogId: string, status: any, error?: string) {
  await prisma.messageLog.update({
    where: { id: messageLogId },
    data: {
      status,
      ...(error ? { error } : {}),
      ...(status === 'FAILED' ? {} : {}),
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

