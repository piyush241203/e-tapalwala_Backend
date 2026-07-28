import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import { logger } from './logger';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

// Initialize S3 Client for Cloudflare R2
export const r2Client = new S3Client({
  endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: accessKeyId || '',
    secretAccessKey: secretAccessKey || '',
  },
  region: 'auto',
});

/**
 * Uploads a local file to Cloudflare R2.
 * @param filePath Local path to the file
 * @param originalName Original name of the file
 * @param folder R2 prefix / folder name
 * @param customPublicId Custom public ID to use for filename
 */
export async function uploadFileToR2(
  filePath: string,
  originalName: string,
  folder: string = 'etapalwala_files',
  customPublicId?: string
): Promise<string> {
  const filename = filePath.split(/[\\/]/).pop() || '';
  const apiUrl = process.env.API_URL || 'http://localhost:4000';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    logger.info(`R2 credentials not set in .env. Using local upload fallback: ${apiUrl}/uploads/${filename}`);
    return `${apiUrl}/uploads/${filename}`;
  }

  try {
    const ext = originalName.substring(originalName.lastIndexOf('.')).toLowerCase();
    const cleanOriginalName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
    const basePublicId = customPublicId || `${Date.now()}${cleanOriginalName}`;
    const finalPublicId = `${basePublicId}${ext}`;
    
    const key = `${folder}/${finalPublicId}`.replace(/\/+/g, '/'); // Normalize slashes

    let contentType = 'application/octet-stream';
    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.csv') {
      contentType = 'text/csv';
    }

    const fileBuffer = fs.readFileSync(filePath);

    logger.info(`[R2] Uploading local file: ${filePath} -> Key: ${key} (Content-Type: ${contentType})`);

    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    const fileUrl = `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${key}`;
    logger.info(`[R2] Upload successful. Virtual URL: ${fileUrl}`);
    return fileUrl;
  } catch (error) {
    logger.error('Failed to upload file to Cloudflare R2, using local fallback:', error);
    return `${apiUrl}/uploads/${filename}`;
  }
}
