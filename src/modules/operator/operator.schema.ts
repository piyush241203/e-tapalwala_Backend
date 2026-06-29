import { z } from 'zod';

export const singleSendSchema = z.object({
  recipientMobile: z.string().min(10, 'Invalid mobile number'),
  channel: z.enum(['WHATSAPP', 'SMS']),
  provider: z.enum(['META']),
  body: z.string().optional(),
  fallbackEnabled: z.boolean().optional().default(false),
});

export const bulkSendSchema = z.object({
  name: z.string().min(2, 'Operation name required'),
  channel: z.enum(['WHATSAPP', 'SMS']),
  provider: z.enum(['META']),
  body: z.string().optional(),
  fallbackEnabled: z.boolean().optional().default(false),
});
