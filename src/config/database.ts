import { PrismaClient } from '../generated/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const isProd = process.env.NODE_ENV === 'production';

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: isProd
      ? [{ level: 'error', emit: 'stdout' }]
      : [
          { level: 'query', emit: 'event' },
          { level: 'error', emit: 'stdout' },
          { level: 'warn', emit: 'stdout' },
        ],
  });

if (!isProd) {
  globalForPrisma.prisma = prisma;
}

prisma.$connect()
  .then(() => logger.info('✅ Connected to MongoDB Atlas'))
  .catch((err) => {
    logger.error('❌ Failed to connect to database', err);
    process.exit(1);
  });

export default prisma;
