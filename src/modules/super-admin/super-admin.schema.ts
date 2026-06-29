import { z } from 'zod';

export const createCitySchema = z.object({
  name: z.string().min(2, 'City name too short'),
  code: z.string().min(2).max(10).toUpperCase(),
  state: z.string().min(2),
  district: z.string().optional(),
});

export const updateCitySchema = createCitySchema.partial();

export const createCityAdminSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  cityId: z.string().min(1, 'City is required'),
  officeId: z.string().min(1, 'Office is required'),
});

export const updateCityAdminSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  cityId: z.string().optional(),
  officeId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const updateMessagingSettingsSchema = z.object({
  metaAccessToken: z.string().optional(),
  metaPhoneNumberId: z.string().optional(),
  metaApiVersion: z.string().optional(),
  preferredProvider: z.enum(['META']).optional(),
});

export const logsFilterSchema = z.object({
  cityId: z.string().optional(),
  operatorId: z.string().optional(),
  status: z.string().optional(),
  channel: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().max(100).default(20),
});

export const createOfficeSchema = z.object({
  name: z.string().min(2, 'Office name too short'),
  code: z.string().min(2).max(20).toUpperCase(),
  cityId: z.string().min(1, 'City is required'),
});

export const updateOfficeSchema = createOfficeSchema.partial();

export const updateWhatsAppCitySettingsSchema = z.object({
  whatsappMonthlyLimit: z.number().int().min(0),
});

