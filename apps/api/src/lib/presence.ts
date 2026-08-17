import type { PresenceUserDto } from '@incidenthub/shared';
import { logger } from '../utils/logger';

interface ActiveViewer {
  socketId: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  joinedAt: string;
}

class PresenceManager {
  // IncidentId -> Array of ActiveViewers
  private incidentViewers: Map<string, Map<string, ActiveViewer>> = new Map();
  // SocketId -> Set of IncidentIds
  private socketIncidents: Map<string, Set<string>> = new Map();

  public addViewer(
    incidentId: string,
    socketId: string,
    user: { id: string; name: string; email: string; avatarUrl?: string | null },
  ): PresenceUserDto[] {
    let viewersMap = this.incidentViewers.get(incidentId);
    if (!viewersMap) {
      viewersMap = new Map();
      this.incidentViewers.set(incidentId, viewersMap);
    }

    const now = new Date().toISOString();

    viewersMap.set(socketId, {
      socketId,
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      joinedAt: now,
    });

    let socketRooms = this.socketIncidents.get(socketId);
    if (!socketRooms) {
      socketRooms = new Set();
      this.socketIncidents.set(socketId, socketRooms);
    }
    socketRooms.add(incidentId);

    logger.debug({ incidentId, userId: user.id, socketId }, 'User joined incident presence');

    return this.getViewers(incidentId);
  }

  public removeViewer(incidentId: string, socketId: string): PresenceUserDto[] {
    const viewersMap = this.incidentViewers.get(incidentId);
    if (viewersMap) {
      viewersMap.delete(socketId);
      if (viewersMap.size === 0) {
        this.incidentViewers.delete(incidentId);
      }
    }

    const socketRooms = this.socketIncidents.get(socketId);
    if (socketRooms) {
      socketRooms.delete(incidentId);
      if (socketRooms.size === 0) {
        this.socketIncidents.delete(socketId);
      }
    }

    logger.debug({ incidentId, socketId }, 'User left incident presence');

    return this.getViewers(incidentId);
  }

  public removeSocket(socketId: string): Array<{ incidentId: string; viewers: PresenceUserDto[] }> {
    const affectedIncidents: Array<{ incidentId: string; viewers: PresenceUserDto[] }> = [];
    const rooms = this.socketIncidents.get(socketId);

    if (rooms) {
      for (const incidentId of rooms) {
        const viewersMap = this.incidentViewers.get(incidentId);
        if (viewersMap) {
          viewersMap.delete(socketId);
          if (viewersMap.size === 0) {
            this.incidentViewers.delete(incidentId);
          }
        }
        affectedIncidents.push({
          incidentId,
          viewers: this.getViewers(incidentId),
        });
      }
      this.socketIncidents.delete(socketId);
    }

    return affectedIncidents;
  }

  public getViewers(incidentId: string): PresenceUserDto[] {
    const viewersMap = this.incidentViewers.get(incidentId);
    if (!viewersMap) return [];

    // Deduplicate by userId for UI presentation while preserving socket presence
    const userMap = new Map<string, PresenceUserDto>();
    for (const viewer of viewersMap.values()) {
      if (!userMap.has(viewer.userId)) {
        userMap.set(viewer.userId, {
          id: viewer.userId,
          name: viewer.name,
          email: viewer.email,
          avatarUrl: viewer.avatarUrl,
          joinedAt: viewer.joinedAt,
        });
      }
    }

    return Array.from(userMap.values());
  }
}

export const presenceManager = new PresenceManager();
