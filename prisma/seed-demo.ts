import { PrismaClient } from '@prisma/client';
import { runDemoSeeding } from '../apps/api/src/utils/seedDemo';

const prisma = new PrismaClient();

async function main(): Promise<void> {
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
