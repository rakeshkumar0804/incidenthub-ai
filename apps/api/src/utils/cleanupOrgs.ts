import type { PrismaClient } from '@prisma/client';

export async function cleanupExtraOrganizations(prisma: PrismaClient): Promise<{
  deletedOrganizations: { name: string; slug: string }[];
  emptiedOrganizations: string[];
  finalOrganizations: { id: string; name: string; slug: string; incidentCount: number; memberCount: number }[];
}> {
  const deletedOrgs: { name: string; slug: string }[] = [];
  const emptiedOrgs: string[] = [];

  // 1. Delete ALL organizations EXCEPT "Rakesh's Org" and "Acme Engineering"
  const allOrgs = await prisma.organization.findMany();
  for (const org of allOrgs) {
    if (org.name !== "Rakesh's Org" && org.name !== 'Acme Engineering') {
      await prisma.organization.delete({ where: { id: org.id } });
      deletedOrgs.push({ name: org.name, slug: org.slug });
    }
  }

  // 2. Ensure "Rakesh's Org" is completely empty of incidents/demo data (user's real empty workspace)
  const rakeshOrgs = await prisma.organization.findMany({
    where: { name: "Rakesh's Org" },
  });

  for (const rOrg of rakeshOrgs) {
    await prisma.incident.deleteMany({ where: { organizationId: rOrg.id } });
    await prisma.team.deleteMany({ where: { organizationId: rOrg.id } });
    await prisma.project.deleteMany({ where: { organizationId: rOrg.id } });
    await prisma.integration.deleteMany({ where: { organizationId: rOrg.id } });
    await prisma.analyticsSnapshot.deleteMany({ where: { organizationId: rOrg.id } });
    emptiedOrgs.push(`${rOrg.name} (${rOrg.slug})`);
  }

  // 3. Clean temporary auth test accounts
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: 'rakesh_live_' } },
        { email: 'test_admin_prod@company.com' },
        { email: { startsWith: 'test_user_' } },
      ],
    },
  });

  // 4. Fetch final remaining organizations
  const finalOrgs = await prisma.organization.findMany({
    include: {
      _count: {
        select: { incidents: true, members: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const finalResult = finalOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    incidentCount: o._count.incidents,
    memberCount: o._count.members,
  }));

  return {
    deletedOrganizations: deletedOrgs,
    emptiedOrganizations: emptiedOrgs,
    finalOrganizations: finalResult,
  };
}
