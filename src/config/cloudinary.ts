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
 * Uploads a local file to Cloudinary.
 * @param filePath Local path to the file
 * @param originalName Original name of the file
 * @param folder Cloudinary folder name
 */
export async function uploadFileToCloudinary(
  filePath: string,
  originalName: string,
  folder: string = 'etapalwala_files'
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
      folder: folder,
      public_id: `${Date.now()}-${originalName.replace(/\.[^/.]+$/, '')}`,
    });

    return result.secure_url;
  } catch (error) {
    logger.error('Failed to upload file to Cloudinary, using local fallback:', error);
    const filename = filePath.split(/[\\/]/).pop();
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    return `${apiUrl}/uploads/${filename}`;
  }
}
