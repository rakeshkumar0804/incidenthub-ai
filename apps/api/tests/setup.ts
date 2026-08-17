import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ensureLocalRedisServer } from '../src/lib/redis';

beforeAll(async () => {
  await ensureLocalRedisServer();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
