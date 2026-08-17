import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

async function main() {
  const result = await prisma.user.updateMany({
    data: { name: 'Rakesh Kumar' },
  });

  logger.info({ updatedCount: result.count }, '✔ Successfully updated user name to Rakesh Kumar in database');
  process.exit(0);
}

void main();
