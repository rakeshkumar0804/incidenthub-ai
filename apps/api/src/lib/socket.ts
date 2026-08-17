import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from './prisma';
import { presenceManager } from './presence';
import { SocketEvent } from '@incidenthub/shared';

export interface AuthenticatedSocketData {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CustomSocket = Socket<Record<string, (...args: any[]) => void>, Record<string, (...args: any[]) => void>, Record<string, (...args: any[]) => void>, AuthenticatedSocketData>;

let ioInstance: Server | null = null;

export function getIO(): Server {
  if (!ioInstance) {
    throw new Error('Socket.IO server not initialized');
  }
  return ioInstance;
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // Socket Authentication Middleware
  io.use((socket: CustomSocket, next) => {
    void (async () => {
    try {
      // Extract token from handshake auth or query or cookies
      let token: string | undefined = socket.handshake.auth?.token as string | undefined;

      if (!token && socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        }
      }

      if (!token && socket.handshake.headers.cookie) {
        const cookies = socket.handshake.headers.cookie.split(';').reduce<Record<string, string>>((acc, cookie) => {
          const [key, val] = cookie.trim().split('=');
          if (key && val) acc[key] = decodeURIComponent(val);
          return acc;
        }, {});
        token = cookies['accessToken'] || cookies['accessToken'];
      }

      if (!token) {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: missing access token');
        return next(new Error('Authentication error: token missing'));
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: invalid token');
        return next(new Error('Authentication error: invalid token'));
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, name: true, avatarUrl: true },
      });

      if (!user) {
        return next(new Error('Authentication error: user not found'));
      }

      socket.data.user = user;
      return next();
    } catch (err) {
      logger.error(err, 'Error in socket auth middleware');
      return next(new Error('Authentication error'));
    }
    })();
  });

  io.on('connection', (socket: CustomSocket) => {
    logger.info({ socketId: socket.id, userId: socket.data.user?.id }, 'Socket connected');

    // Join Incident Room Handler
    socket.on(SocketEvent.JOIN_INCIDENT, async (data: { incidentId?: string }) => {
      try {
        const incidentId = data?.incidentId;
        if (!incidentId || typeof incidentId !== 'string') return;

        const userId = socket.data.user.id;

        // 1. Verify incident exists
        const incident = await prisma.incident.findUnique({
          where: { id: incidentId },
          select: { id: true, organizationId: true },
        });

        if (!incident) {
          socket.emit('error', { message: 'Incident not found' });
          return;
        }

        // 2. Verify user is a member of the organization that owns the incident
        const member = await prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: incident.organizationId,
              userId,
            },
          },
        });

        if (!member) {
          logger.warn(
            { userId, incidentId, orgId: incident.organizationId },
            'Cross-tenant room join rejected',
          );
          socket.emit('error', { message: 'Forbidden: cross-tenant access denied' });
          return;
        }

        const roomName = `incident:${incidentId}`;
        await socket.join(roomName);

        // Update presence
        const viewers = presenceManager.addViewer(incidentId, socket.id, socket.data.user);
        io.to(roomName).emit(SocketEvent.PRESENCE_UPDATE, { incidentId, viewers });

        logger.info({ userId, incidentId, socketId: socket.id }, 'Joined incident room');
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Error joining incident room');
      }
    });

    // Leave Incident Room Handler
    socket.on(SocketEvent.LEAVE_INCIDENT, async (data: { incidentId?: string }) => {
      try {
        const incidentId = data?.incidentId;
        if (!incidentId || typeof incidentId !== 'string') return;

        const roomName = `incident:${incidentId}`;
        await socket.leave(roomName);

        const viewers = presenceManager.removeViewer(incidentId, socket.id);
        io.to(roomName).emit(SocketEvent.PRESENCE_UPDATE, { incidentId, viewers });

        logger.info({ userId: socket.data.user.id, incidentId }, 'Left incident room');
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Error leaving incident room');
      }
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id, userId: socket.data.user?.id }, 'Socket disconnected');
      const affected = presenceManager.removeSocket(socket.id);
      for (const { incidentId, viewers } of affected) {
        io.to(`incident:${incidentId}`).emit(SocketEvent.PRESENCE_UPDATE, { incidentId, viewers });
      }
    });
  });

  ioInstance = io;
  return io;
}

/**
 * Helper to broadcast an event payload to all sockets in an incident room.
 */
export function broadcastToIncident(incidentId: string, event: SocketEvent | string, payload: unknown): void {
  if (ioInstance) {
    ioInstance.to(`incident:${incidentId}`).emit(event, payload);
  }
}
