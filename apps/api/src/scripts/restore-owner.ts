import { AuthService } from '../modules/auth/auth.service';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

async function main() {
  const result = await AuthService.devRestoreOwner();
  logger.info(result, '✔ Owner account successfully restored in development environment');
}

main()
  .catch((err) => logger.error({ err }, 'Failed to restore owner'))
  .finally(() => void prisma.$disconnect());
