import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import { logger } from '../../config/logger';

interface MetaSettings {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

interface SendDocumentOptions {
  to: string;
  documentUrl: string;
  caption?: string;
  filename?: string;
}

interface SendTemplateOptions {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: any[];
}

export class MetaWhatsAppService {
  private settings: MetaSettings;

  constructor(settings: MetaSettings) {
    this.settings = settings;
  }

  private get baseUrl(): string {
    return `https://graph.facebook.com/${this.settings.apiVersion}/${this.settings.phoneNumberId}`;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.settings.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async sendDocument(options: SendDocumentOptions): Promise<{ messageId: string }> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: options.to,
      type: 'document',
      document: {
        link: options.documentUrl,
        caption: options.caption || '',
        filename: options.filename || 'document.pdf',
      },
    };

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error?.error?.message || 'Meta API error');
    }

    const data = await response.json() as any;
    return { messageId: data.messages?.[0]?.id };
  }

  async sendTemplate(options: SendTemplateOptions): Promise<{ messageId: string }> {
    const body = {
      messaging_product: 'whatsapp',
      to: options.to,
      type: 'template',
      template: {
        name: options.templateName,
        language: { code: options.languageCode || 'en' },
        components: options.components || [],
      },
    };

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error?.error?.message || 'Meta API error');
    }

    const data = await response.json() as any;
    return { messageId: data.messages?.[0]?.id };
  }

  async uploadMedia(filePath: string, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { contentType: mimeType });
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);

    const response = await fetch(`${this.baseUrl}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.accessToken}` },
      body: form as any,
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error?.error?.message || 'Media upload failed');
    }

    const data = await response.json() as any;
    return data.id;
  }

  static verifyWebhook(token: string, mode: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  static parseWebhookStatus(body: any): {
    messageId: string;
    status: string;
    timestamp: string;
    to: string;
  } | null {
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const statuses = value?.statuses?.[0];

      if (!statuses) return null;

      return {
        messageId: statuses.id,
        status: statuses.status,
        timestamp: statuses.timestamp,
        to: statuses.recipient_id,
      };
    } catch {
      return null;
    }
  }
}
