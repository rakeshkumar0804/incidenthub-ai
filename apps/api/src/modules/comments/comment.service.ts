import { prisma } from '../../lib/prisma';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import { SocketEvent, OrgRole } from '@incidenthub/shared';
import type { IncidentCommentDto } from '@incidenthub/shared';
import type { CreateCommentInput, UpdateCommentInput } from './comment.schema';

export class CommentService {
  private static toDto(comment: {
    id: string;
    incidentId: string;
    userId: string;
    parentId: string | null;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
    };
  }): IncidentCommentDto {
    return {
      id: comment.id,
      incidentId: comment.incidentId,
      userId: comment.userId,
      parentId: comment.parentId,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      user: {
        id: comment.user.id,
        name: comment.user.name,
        email: comment.user.email,
        avatarUrl: comment.user.avatarUrl,
      },
    };
  }

  /**
   * Lists all comments for an incident, ensuring tenant isolation.
   */
  public static async getComments(organizationId: string, incidentId: string): Promise<IncidentCommentDto[]> {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      select: { id: true },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in this organization');
    }

    const comments = await prisma.comment.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return comments.map((c) => CommentService.toDto(c));
  }

  /**
   * Adds a persistent comment to an incident and broadcasts real-time socket notification.
   */
  public static async createComment(
    organizationId: string,
    incidentId: string,
    userId: string,
    input: CreateCommentInput,
  ): Promise<IncidentCommentDto> {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      select: { id: true },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in this organization');
    }

    if (input.parentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: input.parentId, incidentId },
      });
      if (!parent) {
        throw new NotFoundError('Parent comment not found');
      }
    }

    const created = await prisma.comment.create({
      data: {
        incidentId,
        userId,
        parentId: input.parentId || null,
        content: input.content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    const dto = CommentService.toDto(created);

    // Broadcast real-time comment creation to room viewers
    broadcastToIncident(incidentId, SocketEvent.COMMENT_CREATED, dto);

    return dto;
  }

  /**
   * Updates a comment (author only or higher privilege).
   */
  public static async updateComment(
    organizationId: string,
    incidentId: string,
    commentId: string,
    userId: string,
    input: UpdateCommentInput,
  ): Promise<IncidentCommentDto> {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, incidentId },
      include: {
        incident: { select: { organizationId: true } },
      },
    });

    if (!comment || comment.incident.organizationId !== organizationId) {
      throw new NotFoundError('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenError('You can only edit your own comments');
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content: input.content },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    const dto = CommentService.toDto(updated);

    // Broadcast real-time comment update to room viewers
    broadcastToIncident(incidentId, SocketEvent.COMMENT_UPDATED, dto);

    return dto;
  }

  /**
   * Deletes a comment (author or ADMIN/OWNER role).
   */
  public static async deleteComment(
    organizationId: string,
    incidentId: string,
    commentId: string,
    userId: string,
    userRole: OrgRole,
  ): Promise<void> {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, incidentId },
      include: {
        incident: { select: { organizationId: true } },
      },
    });

    if (!comment || comment.incident.organizationId !== organizationId) {
      throw new NotFoundError('Comment not found');
    }

    const isAuthor = comment.userId === userId;
    const isManager = userRole === OrgRole.OWNER || userRole === OrgRole.ADMIN;

    if (!isAuthor && !isManager) {
      throw new ForbiddenError('You do not have permission to delete this comment');
    }

    await prisma.comment.delete({
      where: { id: commentId },
    });

    // Broadcast real-time comment deletion to room viewers
    broadcastToIncident(incidentId, SocketEvent.COMMENT_DELETED, { commentId, incidentId });
  }
}
