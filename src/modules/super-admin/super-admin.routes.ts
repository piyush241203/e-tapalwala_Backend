import { Router } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import {
  getDashboard, getCities, createCity, updateCity, toggleCityStatus, deleteCity,
  getCityAdmins, createCityAdmin, updateCityAdmin, resetCityAdminPassword,
  getGlobalLogs, getAuditLogs, getMessagingSettings, updateMessagingSettings, getReports,
  getOffices, createOffice, updateOffice, deleteOffice,
  getWhatsAppCities, updateWhatsAppCitySettings, getWhatsAppOffices,
  toggleWhatsAppOfficeStatus, downloadOfficePdfReport,
} from './super-admin.controller';

export const superAdminRouter = Router();

superAdminRouter.use(authenticate, requireRole('PLATFORM_ADMIN'));

// Dashboard
superAdminRouter.get('/dashboard', getDashboard);

// Cities
superAdminRouter.get('/cities', getCities);
superAdminRouter.post('/cities', createCity);
superAdminRouter.put('/cities/:id', updateCity);
superAdminRouter.patch('/cities/:id/toggle', toggleCityStatus);
superAdminRouter.delete('/cities/:id', deleteCity);

// Offices
superAdminRouter.get('/offices', getOffices);
superAdminRouter.post('/offices', createOffice);
superAdminRouter.put('/offices/:id', updateOffice);
superAdminRouter.delete('/offices/:id', deleteOffice);

// City Admins
superAdminRouter.get('/city-admins', getCityAdmins);
superAdminRouter.post('/city-admins', createCityAdmin);
superAdminRouter.put('/city-admins/:id', updateCityAdmin);
superAdminRouter.patch('/city-admins/:id/reset-password', resetCityAdminPassword);

// Logs
superAdminRouter.get('/logs', getGlobalLogs);
superAdminRouter.get('/audit-logs', getAuditLogs);

// Settings
superAdminRouter.get('/settings/messaging', getMessagingSettings);
superAdminRouter.put('/settings/messaging', updateMessagingSettings);

// WhatsApp Credit & Office Management Settings
superAdminRouter.get('/settings/whatsapp/cities', getWhatsAppCities);
superAdminRouter.put('/settings/whatsapp/cities/:id', updateWhatsAppCitySettings);
superAdminRouter.get('/settings/whatsapp/offices', getWhatsAppOffices);
superAdminRouter.patch('/settings/whatsapp/offices/:id/toggle', toggleWhatsAppOfficeStatus);
superAdminRouter.get('/settings/whatsapp/offices/:id/pdf', downloadOfficePdfReport);

// Reports
superAdminRouter.get('/reports', getReports);

