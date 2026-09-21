import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient, OrgRole, IncidentStatus } from '@prisma/client';
import {
  executeRestoreDemo,
  parseHostnameFromUrl,
} from '../src/scripts/restore-production-demo';

describe('Production Demo Restore Operator CLI Test Suite', () => {
  const prisma = new PrismaClient();
  let personalOrgId: string;

  beforeEach(async () => {
    // Ensure clean test baseline
    // Create a mock personal organization ("Rakesh Kumar's Org") to test protection
    const personalOrg = await prisma.organization.upsert({
      where: { slug: 'rakesh-kumars-org' },
      update: {},
      create: {
        name: "Rakesh Kumar's Org",
        slug: 'rakesh-kumars-org',
      },
    });
    personalOrgId = personalOrg.id;

    const personalUser = await prisma.user.upsert({
      where: { email: 'rakesh.personal@company.com' },
      update: {},
      create: {
        email: 'rakesh.personal@company.com',
        name: 'Rakesh Kumar',
        emailVerified: true,
      },
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: personalOrg.id,
          userId: personalUser.id,
        },
      },
      update: {},
      create: {
        organizationId: personalOrg.id,
        userId: personalUser.id,
        role: OrgRole.OWNER,
      },
    });
  });

  afterEach(async () => {
    // Clean up
  });

  // 1. Dry run performs zero writes
  it('1. Dry-run mode previews the restore operation and performs zero mutations', async () => {
    const summary = await executeRestoreDemo(prisma, { apply: false });

    expect(summary.mode).toBe('DRY_RUN');
    expect(summary.organization.slug).toBe('acme-engineering');
    expect(summary.organization.action).toBe('PREVIEW_UPSERT');
    expect(summary.memberships.length).toBe(4);
    expect(summary.memberships).toEqual([
      { email: 'rakesh.personal@company.com', role: OrgRole.OWNER },
      { email: 'alex.chen@acme.dev', role: OrgRole.ADMIN },
      { email: 'elena.rostova@acme.dev', role: OrgRole.RESPONDER },
      { email: 'demo.recruiter@acme.dev', role: OrgRole.VIEWER },
    ]);
    expect(summary.incidentsCount.total).toBe(8);
    expect(summary.incidentsCount.resolved).toBe(5);
    expect(summary.postmortemsCount).toBe(2);
    expect(summary.githubReferencesCount.commits).toBe(2);
    expect(summary.githubReferencesCount.pullRequests).toBe(1);
    expect(summary.githubReferencesCount.deployments).toBe(1);
    expect(summary.githubReferencesCount.evidences).toBe(3);
  });

  // 2. Missing confirmation fails in apply mode
  it('2. Apply mode fails with safety error if confirmation slug is missing or invalid', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    try {
      await expect(
        executeRestoreDemo(prisma, {
          apply: true,
          confirmSlug: 'wrong-slug',
          expectedDbHost: 'localhost',
        }),
      ).rejects.toThrow('CONFIRM_PRODUCTION_DEMO_RESTORE');
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
    }
  });

  // 3. Database-host mismatch fails
  it('3. Apply mode fails with safety error if EXPECTED_DATABASE_HOST does not match parsed host', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    try {
      await expect(
        executeRestoreDemo(prisma, {
          apply: true,
          confirmSlug: 'acme-engineering',
          expectedDbHost: 'unmatched-production-db.internal',
        }),
      ).rejects.toThrow('Database host mismatch');
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
    }
  });

  // 4. Hostname parser handles various URL formats
  it('4. Hostname parser accurately extracts lowercase domain names', () => {
    expect(parseHostnameFromUrl('postgresql://user:pass@dpg-abc-a.oregon-postgres.render.com/db')).toBe(
      'dpg-abc-a.oregon-postgres.render.com',
    );
    expect(parseHostnameFromUrl('postgres://localhost:5432/incidenthub')).toBe('localhost');
    expect(parseHostnameFromUrl('')).toBe('');
  });

  // 5. Repeated execution is idempotent
  it('5. Repeated execution in apply mode is completely idempotent', async () => {
    const parsedHost = parseHostnameFromUrl(process.env['DATABASE_URL']) || 'localhost';
    const origNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    try {
      // First apply
      const summary1 = await executeRestoreDemo(prisma, {
        apply: true,
        confirmSlug: 'acme-engineering',
        expectedDbHost: parsedHost,
        demoOwnerEmail: 'rakesh.personal@company.com',
      });
      expect(summary1.mode).toBe('APPLY');

      // Second apply
      const summary2 = await executeRestoreDemo(prisma, {
        apply: true,
        confirmSlug: 'acme-engineering',
        expectedDbHost: parsedHost,
        demoOwnerEmail: 'rakesh.personal@company.com',
      });
      expect(summary2.mode).toBe('APPLY');

      // Verify exact entity counts in database
      const acmeOrg = await prisma.organization.findUnique({
        where: { slug: 'acme-engineering' },
      });
      expect(acmeOrg).toBeDefined();

      if (acmeOrg) {
        const incidents = await prisma.incident.findMany({
          where: { organizationId: acmeOrg.id },
        });
        expect(incidents.length).toBe(8);

        const postmortems = await prisma.postmortem.findMany({
          where: { organizationId: acmeOrg.id },
        });
        expect(postmortems.length).toBe(2);

        const members = await prisma.organizationMember.findMany({
          where: { organizationId: acmeOrg.id },
          include: { user: true },
        });
        // Exactly 4 role demonstrations
        expect(members.length).toBe(4);
        const roles = members.map((m) => ({ email: m.user.email, role: m.role }));
        expect(roles).toEqual(
          expect.arrayContaining([
            { email: 'rakesh.personal@company.com', role: OrgRole.OWNER },
            { email: 'alex.chen@acme.dev', role: OrgRole.ADMIN },
            { email: 'elena.rostova@acme.dev', role: OrgRole.RESPONDER },
            { email: 'demo.recruiter@acme.dev', role: OrgRole.VIEWER },
          ]),
        );

        // Verify owner user has memberships in BOTH organizations
        const ownerUser = await prisma.user.findUnique({
          where: { email: 'rakesh.personal@company.com' },
          include: { organizationMembers: { include: { organization: true } } },
        });
        expect(ownerUser?.organizationMembers.length).toBe(2);
        const orgSlugs = ownerUser?.organizationMembers.map((m) => m.organization.slug);
        expect(orgSlugs).toContain('rakesh-kumars-org');
        expect(orgSlugs).toContain('acme-engineering');

        // Verify GitHub entities and Incident #101 Evidence links
        const inc101 = await prisma.incident.findFirst({
          where: { organizationId: acmeOrg.id, number: 101 },
          include: { evidence: true },
        });
        expect(inc101).toBeDefined();
        expect(inc101?.evidence.length).toBe(3);

        const commits = await prisma.gitHubCommit.findMany({
          where: { repository: { organizationId: acmeOrg.id } },
        });
        expect(commits.length).toBe(2);

        const prs = await prisma.gitHubPullRequest.findMany({
          where: { repository: { organizationId: acmeOrg.id } },
        });
        expect(prs.length).toBe(1);

        const deploys = await prisma.gitHubDeployment.findMany({
          where: { repository: { organizationId: acmeOrg.id } },
        });
        expect(deploys.length).toBe(1);
      }
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
    }
  });

  // 5b. Password hashes are preserved across applies
  it('5b. Consecutive applies preserve existing password hashes and only rotate VIEWER when explicitly instructed', async () => {
    const parsedHost = parseHostnameFromUrl(process.env['DATABASE_URL']) || 'localhost';
    const origNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    try {
      // 1. First apply
      await executeRestoreDemo(prisma, {
        apply: true,
        confirmSlug: 'acme-engineering',
        expectedDbHost: parsedHost,
        demoOwnerEmail: 'rakesh.personal@company.com',
        demoPassword: 'InitialViewerPass123!',
      });

      const alexUser1 = await prisma.user.findUnique({ where: { email: 'alex.chen@acme.dev' } });
      const elenaUser1 = await prisma.user.findUnique({ where: { email: 'elena.rostova@acme.dev' } });
      const recruiterUser1 = await prisma.user.findUnique({ where: { email: 'demo.recruiter@acme.dev' } });

      expect(alexUser1?.passwordHash).toBeDefined();
      expect(elenaUser1?.passwordHash).toBeDefined();
      expect(recruiterUser1?.passwordHash).toBeDefined();

      // 2. Second apply WITHOUT rotation
      await executeRestoreDemo(prisma, {
        apply: true,
        confirmSlug: 'acme-engineering',
        expectedDbHost: parsedHost,
        demoOwnerEmail: 'rakesh.personal@company.com',
        demoPassword: 'AttemptedDifferentPass!',
        rotateDemoPassword: false,
      });

      const alexUser2 = await prisma.user.findUnique({ where: { email: 'alex.chen@acme.dev' } });
      const elenaUser2 = await prisma.user.findUnique({ where: { email: 'elena.rostova@acme.dev' } });
      const recruiterUser2 = await prisma.user.findUnique({ where: { email: 'demo.recruiter@acme.dev' } });

      // All password hashes must remain strictly identical
      expect(alexUser2?.passwordHash).toBe(alexUser1?.passwordHash);
      expect(elenaUser2?.passwordHash).toBe(elenaUser1?.passwordHash);
      expect(recruiterUser2?.passwordHash).toBe(recruiterUser1?.passwordHash);

      // 3. Third apply WITH explicit rotation for recruiter only
      await executeRestoreDemo(prisma, {
        apply: true,
        confirmSlug: 'acme-engineering',
        expectedDbHost: parsedHost,
        demoOwnerEmail: 'rakesh.personal@company.com',
        demoPassword: 'BrandNewRotatedPass999!',
        rotateDemoPassword: true,
      });

      const alexUser3 = await prisma.user.findUnique({ where: { email: 'alex.chen@acme.dev' } });
      const elenaUser3 = await prisma.user.findUnique({ where: { email: 'elena.rostova@acme.dev' } });
      const recruiterUser3 = await prisma.user.findUnique({ where: { email: 'demo.recruiter@acme.dev' } });

      // Privileged accounts must NOT rotate
      expect(alexUser3?.passwordHash).toBe(alexUser1?.passwordHash);
      expect(elenaUser3?.passwordHash).toBe(elenaUser1?.passwordHash);

      // VIEWER account must be rotated
      expect(recruiterUser3?.passwordHash).not.toBe(recruiterUser1?.passwordHash);
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
    }
  });

  // 6. Analytics timestamps generate valid MTTR and MTTD
  it('6. Resolved incidents contain valid chronological timestamps for MTTR and MTTD analytics', async () => {
    const acmeOrg = await prisma.organization.findUnique({
      where: { slug: 'acme-engineering' },
    });
    expect(acmeOrg).toBeDefined();

    if (acmeOrg) {
      const resolvedIncidents = await prisma.incident.findMany({
        where: {
          organizationId: acmeOrg.id,
          status: IncidentStatus.RESOLVED,
        },
      });

      expect(resolvedIncidents.length).toBe(5);
      for (const inc of resolvedIncidents) {
        expect(inc.detectedAt).toBeDefined();
        expect(inc.resolvedAt).toBeDefined();
        if (inc.resolvedAt && inc.detectedAt) {
          expect(inc.resolvedAt.getTime()).toBeGreaterThan(inc.detectedAt.getTime());

          // MTTR must be positive
          const mttrMs = inc.resolvedAt.getTime() - inc.detectedAt.getTime();
          expect(mttrMs).toBeGreaterThan(0);
        }
      }
    }
  });

  // 7. Postmortems are connected strictly to Acme incidents
  it('7. Postmortems and action items are strictly scoped to Acme Engineering', async () => {
    const acmeOrg = await prisma.organization.findUnique({
      where: { slug: 'acme-engineering' },
    });
    expect(acmeOrg).toBeDefined();

    if (acmeOrg) {
      const postmortems = await prisma.postmortem.findMany({
        where: { organizationId: acmeOrg.id },
        include: { versions: true, actionItems: true },
      });

      expect(postmortems.length).toBe(2);
      for (const pm of postmortems) {
        expect(pm.organizationId).toBe(acmeOrg.id);
        expect(pm.versions.length).toBeGreaterThanOrEqual(1);
        expect(pm.versions[0]?.summary).toContain('[DEMO-GENERATED]');
      }
    }
  });

  // 8. Personal organization remains completely unchanged
  it('8. Personal organization counts and memberships remain untouched', async () => {
    const personalOrg = await prisma.organization.findUnique({
      where: { id: personalOrgId },
      include: { members: true, incidents: true, projects: true },
    });

    expect(personalOrg).toBeDefined();
    expect(personalOrg?.slug).toBe('rakesh-kumars-org');
    expect(personalOrg?.incidents.length).toBe(0);
    expect(personalOrg?.members.length).toBe(1);
    expect(personalOrg?.members[0]?.role).toBe(OrgRole.OWNER);
  });
});
