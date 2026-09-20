import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ensureLocalRedisServer } from '../src/lib/redis';

beforeAll(async () => {
  process.env['GITHUB_WEBHOOK_SECRET'] = 'test-github-webhook-secret-phase1-audit';
  process.env['SENTRY_WEBHOOK_SECRET'] = 'test-sentry-webhook-secret-phase1-audit';
  process.env['SLACK_SIGNING_SECRET'] = 'test-slack-signing-secret-phase1-audit';
  process.env['JIRA_WEBHOOK_SECRET'] = 'test-jira-webhook-secret-phase1-audit';
  await ensureLocalRedisServer();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
