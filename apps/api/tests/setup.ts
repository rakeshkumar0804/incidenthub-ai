import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ensureLocalRedisServer, redis } from '../src/lib/redis';

beforeAll(async () => {
  await ensureLocalRedisServer();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  if (redis.status === 'ready' || redis.status === 'connecting') {
    await redis.quit();
  }
});
