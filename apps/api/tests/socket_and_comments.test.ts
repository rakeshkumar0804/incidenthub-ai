import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import supertest from 'supertest';
import { io as ioClient } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signAccessToken } from '../src/utils/jwt';
import { initSocketServer } from '../src/lib/socket';
import { OrgRole, SocketEvent, IncidentSeverity, IncidentStatus } from '@incidenthub/shared';
import type { ApiSuccess, IncidentCommentDto, PresenceUserDto, IncidentDto } from '@incidenthub/shared';

describe('Phase 5: Real-Time Collaboration & Comments API', () => {
  let server: http.Server;
  let port: number;
  let serverUrl: string;

  let request: ReturnType<typeof supertest>;

  let orgAId: string;
  let orgBId: string;

  let ownerAId: string;
  let ownerBId: string;

  let ownerAToken: string;
  let ownerBToken: string;

  let projectAId: string;
  let incidentAId: string;

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    initSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
          serverUrl = `http://127.0.0.1:${port}`;
        }
        resolve();
      });
    });

    request = supertest(server);

    const timestamp = Date.now();

    // 1. Create Org A & Owner A
    const orgA = await prisma.organization.create({
      data: { name: `Socket Org A ${timestamp}`, slug: `socket-org-a-${timestamp}` },
    });
    orgAId = orgA.id;

    const userA = await prisma.user.create({
      data: { name: 'Socket Alice', email: `socket.alice.${timestamp}@test.com` },
    });
    ownerAId = userA.id;

    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: ownerAId, role: OrgRole.OWNER },
    });
    ownerAToken = signAccessToken(ownerAId, userA.email);

    // Create Project A & Incident A
    const projectA = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A ${timestamp}`, slug: `proj-a-${timestamp}` },
    });
    projectAId = projectA.id;

    const incidentA = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        number: 1,
        title: 'API Server Outage',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.OPEN,
        createdById: ownerAId,
      },
    });
    incidentAId = incidentA.id;

    // 2. Create Org B & Owner B
    const orgB = await prisma.organization.create({
      data: { name: `Socket Org B ${timestamp}`, slug: `socket-org-b-${timestamp}` },
    });
    orgBId = orgB.id;

    const userB = await prisma.user.create({
      data: { name: 'Socket Bob', email: `socket.bob.${timestamp}@test.com` },
    });
    ownerBId = userB.id;

    await prisma.organizationMember.create({
      data: { organizationId: orgBId, userId: ownerBId, role: OrgRole.OWNER },
    });
    ownerBToken = signAccessToken(ownerBId, userB.email);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('1. Socket Authentication & Rejection', () => {
    it('rejects unauthenticated socket connection attempts', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        socket.on('connect_error', (err) => {
          expect(err.message).toContain('Authentication error');
          socket.disconnect();
          resolve();
        });
      });
    });

    it('authenticates valid JWT token socket connection', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        auth: { token: ownerAToken },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        socket.on('connect', () => {
          expect(socket.connected).toBe(true);
          socket.disconnect();
          resolve();
        });
      });
    });
  });

  describe('2. Incident Room Authorization & Cross-Tenant Isolation', () => {
    it('allows authorized User A to join Org A incident room and receive presence update', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        auth: { token: ownerAToken },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        socket.on('connect', () => {
          socket.emit(SocketEvent.JOIN_INCIDENT, { incidentId: incidentAId });
        });

        socket.on(SocketEvent.PRESENCE_UPDATE, (data: { incidentId: string; viewers: PresenceUserDto[] }) => {
          expect(data.incidentId).toBe(incidentAId);
          expect(data.viewers.some((v) => v.id === ownerAId)).toBe(true);
          socket.disconnect();
          resolve();
        });
      });
    });

    it('REJECTS User B (Org B) attempting to join Org A incident room', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        auth: { token: ownerBToken },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        socket.on('connect', () => {
          socket.emit(SocketEvent.JOIN_INCIDENT, { incidentId: incidentAId });
        });

        socket.on('error', (err: { message: string }) => {
          expect(err.message).toContain('Forbidden');
          socket.disconnect();
          resolve();
        });
      });
    });
  });

  describe('3. Persistent Incident Comments REST API & Tenant Isolation', () => {
    let createdCommentId: string;

    it('POST /comments — User A posts a comment on Org A incident', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ content: 'Database cluster memory spikes at 94%.' });

      expect(res.status).toBe(201);
      const body = res.body as ApiSuccess<IncidentCommentDto>;
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('Database cluster memory spikes at 94%.');
      expect(body.data.userId).toBe(ownerAId);
      createdCommentId = body.data.id;
    });

    it('GET /comments — retrieves incident comments in chronological order', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentCommentDto[]>;
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].id).toBe(createdCommentId);
    });

    it('REJECTS User B (Org B) from creating or reading comments on Org A incident', async () => {
      const readRes = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`)
        .set('Authorization', `Bearer ${ownerBToken}`);
      expect(readRes.status).toBe(403);

      const postRes = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ content: 'Malicious Org B comment' });
      expect(postRes.status).toBe(403);
    });

    it('PATCH /comments/:commentId — allows author to edit own comment', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments/${createdCommentId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ content: 'Updated comment: Memory spikes stabilized.' });

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentCommentDto>;
      expect(body.data.content).toBe('Updated comment: Memory spikes stabilized.');
    });

    it('DELETE /comments/:commentId — allows author to delete own comment', async () => {
      const res = await request
        .delete(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments/${createdCommentId}`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('4. Real-Time Socket Event Broadcasting', () => {
    it('broadcasts INCIDENT_UPDATED event to room viewers when status changes via REST', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        auth: { token: ownerAToken },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('INCIDENT_UPDATED test timeout')), 5000);

        socket.on('connect', () => {
          socket.emit(SocketEvent.JOIN_INCIDENT, { incidentId: incidentAId });
        });

        socket.once(SocketEvent.PRESENCE_UPDATE, () => {
          setTimeout(() => {
            void (async () => {
              const res = await request
                .patch(`/api/v1/incidents/${incidentAId}/status`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ status: IncidentStatus.INVESTIGATING });
              if (res.status !== 200) {
                console.error('PATCH status failed:', res.status, res.body);
              }
            })();
          }, 50);
        });

        socket.once(SocketEvent.INCIDENT_UPDATED, (updatedIncident: IncidentDto) => {
          clearTimeout(timer);
          expect(updatedIncident.id).toBe(incidentAId);
          expect(updatedIncident.status).toBe(IncidentStatus.INVESTIGATING);
          socket.disconnect();
          resolve();
        });
      });
    }, 10000);

    it('broadcasts COMMENT_CREATED socket event to room viewers when new comment posted via REST', async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        path: '/socket.io',
        auth: { token: ownerAToken },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('COMMENT_CREATED test timeout')), 5000);

        socket.on('connect', () => {
          socket.emit(SocketEvent.JOIN_INCIDENT, { incidentId: incidentAId });
        });

        socket.once(SocketEvent.PRESENCE_UPDATE, () => {
          setTimeout(() => {
            void (async () => {
              const res = await request
                .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ content: 'Real-time broadcast test comment' });
              if (res.status !== 201) {
                console.error('POST comment failed:', res.status, res.body);
              }
            })();
          }, 50);
        });

        socket.once(SocketEvent.COMMENT_CREATED, (newComment: IncidentCommentDto) => {
          clearTimeout(timer);
          expect(newComment.incidentId).toBe(incidentAId);
          expect(newComment.content).toBe('Real-time broadcast test comment');
          socket.disconnect();
          resolve();
        });
      });
    }, 10000);
  });
});
