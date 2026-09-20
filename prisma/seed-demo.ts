import { PrismaClient } from '@prisma/client';
import { runDemoSeeding } from '../apps/api/src/utils/seedDemo';

const prisma = new PrismaClient();

function isLocalDatabaseUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === 'postgres';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.error('❌ Refusing to run demo seeding in production environment (NODE_ENV=production)');
    process.exit(1);
  }

  if (process.env['ALLOW_DEMO_SEED'] !== 'true') {
    console.error('❌ Demo seeding disabled. Set ALLOW_DEMO_SEED=true in environment to permit seeding.');
    process.exit(1);
  }

  const dbUrl = process.env['DATABASE_URL'];
  if (!isLocalDatabaseUrl(dbUrl)) {
    console.error('❌ Refusing to run demo seeding: DATABASE_URL must point to a local host (localhost, 127.0.0.1, or postgres). Remote and cloud databases (Neon, Render, etc.) are strictly prohibited.');
    process.exit(1);
  }

  console.log('🚀 Running IncidentHub AI Demo Database Seeder...');
  const result = await runDemoSeeding(prisma);
  console.log('✅ Result:', result);
}


main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seeder failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
