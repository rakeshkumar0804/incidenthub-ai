import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvent } from '@incidenthub/shared';
import type { PresenceUserDto, IncidentDto, IncidentCommentDto } from '@incidenthub/shared';
import { useAuth } from '../features/auth/AuthContext';

export type SocketConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface UseIncidentSocketResult {
  status: SocketConnectionStatus;
  viewers: PresenceUserDto[];
}

export function useIncidentSocket(incidentId: string | undefined): UseIncidentSocketResult {
  const { accessToken, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SocketConnectionStatus>('connecting');
  const [viewers, setViewers] = useState<PresenceUserDto[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!incidentId || !isAuthenticated) {
      setStatus('disconnected');
      setViewers([]);
      return;
    }

    setStatus('connecting');

    const socketUrl = (import.meta.env['VITE_API_URL'] as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:4000';

    const socket: Socket = io(socketUrl, {
      path: '/socket.io',
      auth: { token: accessToken },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      socket.emit(SocketEvent.JOIN_INCIDENT, { incidentId });
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server forcibly disconnected socket
        setStatus('disconnected');
      } else {
        setStatus('reconnecting');
      }
    });

    socket.on('connect_error', () => {
      setStatus('disconnected');
    });

    socket.on(SocketEvent.PRESENCE_UPDATE, (data: { incidentId: string; viewers: PresenceUserDto[] }) => {
      if (data.incidentId === incidentId) {
        setViewers(data.viewers || []);
      }
    });

    // Real-time incident updates
    socket.on(SocketEvent.INCIDENT_UPDATED, (updatedIncident: IncidentDto) => {
      if (updatedIncident.id === incidentId) {
        queryClient.setQueryData(['incident', incidentId], updatedIncident);
        void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      }
    });

    // Real-time comments updates
    socket.on(SocketEvent.COMMENT_CREATED, (newComment: IncidentCommentDto) => {
      if (newComment.incidentId === incidentId) {
        queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
          if (!old) return [newComment];
          if (old.some((c) => c.id === newComment.id)) return old;
          return [...old, newComment];
        });
      }
    });

    socket.on(SocketEvent.COMMENT_UPDATED, (updatedComment: IncidentCommentDto) => {
      if (updatedComment.incidentId === incidentId) {
        queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
          if (!old) return [updatedComment];
          return old.map((c) => (c.id === updatedComment.id ? updatedComment : c));
        });
      }
    });

    socket.on(SocketEvent.COMMENT_DELETED, (data: { commentId: string; incidentId: string }) => {
      if (data.incidentId === incidentId) {
        queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
          if (!old) return [];
          return old.filter((c) => c.id !== data.commentId);
        });
      }
    });

    return () => {
      if (socket.connected) {
        socket.emit(SocketEvent.LEAVE_INCIDENT, { incidentId });
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [incidentId, accessToken, isAuthenticated, queryClient]);

  return { status, viewers };
}
