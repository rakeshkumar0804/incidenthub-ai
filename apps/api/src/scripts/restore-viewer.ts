import { AuthService } from '../modules/auth/auth.service';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

async function main() {
  const result = await AuthService.devResetViewerPassword();
  logger.info(result, '✔ Viewer password successfully reset in development environment');
}

main()
  .catch((err) => logger.error({ err }, 'Failed to reset viewer password'))
  .finally(() => void prisma.$disconnect());
