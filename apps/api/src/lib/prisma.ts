import { PrismaClient } from '@prisma/client';

// Prevent multiple Prisma Client instances during hot-reload in development.
declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const isDevelopment = process.env['NODE_ENV'] === 'development';

  return new PrismaClient({
    log: isDevelopment
      ? [
          { emit: 'stdout', level: 'error' },
          { emit: 'stdout', level: 'warn' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
  });
}

export const prisma = globalThis.__prismaClient ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__prismaClient = prisma;
}
