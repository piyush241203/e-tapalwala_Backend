import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { logger } from './logger';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a local PDF file to Cloudinary and deletes the local file afterward.
 * @param filePath Local path to the file
 * @param originalName Original name of the file
 */
export async function uploadPdfToCloudinary(
  filePath: string,
  originalName: string
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const filename = filePath.split(/[\\/]/).pop();
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    logger.info(`Cloudinary credentials not set in .env. Using local upload fallback: ${apiUrl}/uploads/${filename}`);
    return `${apiUrl}/uploads/${filename}`;
  }

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'auto',
      folder: 'etapalwala_pdfs',
      public_id: `${Date.now()}-${originalName.replace(/\.[^/.]+$/, '')}`,
    });

    // Keep local file on disk so the backend can transmit it without downloading from Cloudinary
    return result.secure_url;
  } catch (error) {
    logger.error('Failed to upload PDF to Cloudinary, using local fallback:', error);
    const filename = filePath.split(/[\\/]/).pop();
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    return `${apiUrl}/uploads/${filename}`;
  }
}
