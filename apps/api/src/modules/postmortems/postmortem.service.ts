import { Prisma, PostmortemStatus, PostmortemTriggerType, OrgRole, IncidentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis, acquireDistributedLock, verifyLockOwnership, releaseDistributedLock } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError, LockOwnershipLostError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import type { AIPostmortemProvider } from './providers/postmortemProvider.interface';
import {
  buildPostmortemSnapshot,
  sanitizeSnapshotForPrompt,
  validateAndGroundPostmortemOutput,
} from './postmortem.engine';
import { sanitizeString } from '../ai/sanitizer';
import { toFiniteNonNegativeInteger } from './postmortem.numeric';
import type { UpdatePostmortemSchema, CreateActionItemSchema, UpdateActionItemSchema } from './postmortem.schema';

export { toFiniteNonNegativeInteger } from './postmortem.numeric';

export function redactSecrets(text: string): string {
  if (!text) return '';
  return sanitizeString(text)
    .replace(/postgres:\/\/\[REDACTED_CREDS\]@[^\s]+/g, 'postgres://[REDACTED_DB_CREDENTIALS]')
    .replace(/\[REDACTED_SENTRY_KEY\]/g, '[REDACTED_SENTRY_TOKEN]')
    .replace(/Bearer \[REDACTED_TOKEN\]/g, 'Bearer [REDACTED_JWT_TOKEN]');
}

const KNOWN_COMPOUND_CONSTRAINT_IDENTIFIERS = new Set([
  'postmortem_versions_postmortemid_versionnumber_key',
  'postmortemversion_postmortemid_versionnumber_key',
  'postmortem_versions_postmortemid_versionnumber_idx',
  'postmortemversion_postmortemid_versionnumber_idx',
  'postmortemid_versionnumber',
  'postmortemid,versionnumber',
  'versionnumber,postmortemid',
]);

export function isPostmortemVersionNumberConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const prismaErr = error as { code?: string; meta?: { target?: unknown } };
  if (prismaErr.code !== 'P2002') return false;

  const target = prismaErr.meta?.target;
  if (!target) return false;

  if (Array.isArray(target)) {
    const stringElements = target.filter((t): t is string => typeof t === 'string');
    return stringElements.includes('postmortemId') && stringElements.includes('versionNumber');
  }

  if (typeof target === 'string') {
    const normalized = target.trim().toLowerCase();
    return KNOWN_COMPOUND_CONSTRAINT_IDENTIFIERS.has(normalized);
  }

  return false;
}

export class PostmortemService {
  private static provider: AIPostmortemProvider | null = null;
  private static localInFlight = new Set<string>();

  public static setProvider(customProvider: AIPostmortemProvider): void {
    this.provider = customProvider;
  }

  private static async getProvider(): Promise<AIPostmortemProvider> {
    if (!this.provider) {
      const { OpenAIPostmortemProvider } = await import('./providers/openaiPostmortem.provider');
      this.provider = new OpenAIPostmortemProvider();
    }
    return this.provider;
  }

  public static async generatePostmortem(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: PostmortemTriggerType = PostmortemTriggerType.MANUAL_REQUEST,
  ): Promise<{ postmortemId: string; versionId: string; versionNumber: number; status?: string; runId?: string }> {
    // 1. Process-Local Concurrency Guard (Synchronous check & add before first await)
    if (PostmortemService.localInFlight.has(incidentId)) {
      logger.info({ incidentId }, 'Postmortem generation already in progress locally');
      return { postmortemId: 'none', versionId: 'none', versionNumber: 0, status: 'skipped_lock_active', runId: 'none' };
    }
    PostmortemService.localInFlight.add(incidentId);

    // 2. Redis Distributed Locking with Ownership-Safe Heartbeat (60s TTL)
    const lockKey = `lock:postmortem:${incidentId}`;
    const lockVal = crypto.randomUUID();
    const lockTtlMs = 60000;
    let renewalTimer: NodeJS.Timeout | null = null;
    let lockLost = false;
    let isRenewing = false;

    // Atomic lock acquisition: fails closed (503) in production if Redis is unavailable or throws
    const lockResult = await acquireDistributedLock(lockKey, lockVal, lockTtlMs, 'postmortem_generation');
    if (!lockResult.acquired) {
      PostmortemService.localInFlight.delete(incidentId);
      logger.info({ incidentId }, 'Postmortem generation already in progress (lock active)');
      return { postmortemId: 'none', versionId: 'none', versionNumber: 0, status: 'skipped_lock_active', runId: 'none' };
    }

    const redisLockAcquired = lockResult.isRedisLock;

    if (redisLockAcquired) {
      // Start safe background renewal timer (heartbeat every 10 seconds)
      renewalTimer = setInterval(() => {
        if (isRenewing || lockLost) return;
        isRenewing = true;
        const renewLua = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("pexpire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        redis
          .eval(renewLua, 1, lockKey, lockVal, lockTtlMs)
          .then((result) => {
            if (result !== 1) {
              lockLost = true;
              logger.warn({ incidentId, lockKey }, 'Redis postmortem lock ownership lost during renewal heartbeat');
            }
          })
          .catch((err) => {
            logger.warn({ err, incidentId }, 'Redis postmortem lock renewal heartbeat failed');
          })
          .finally(() => {
            isRenewing = false;
          });
      }, 10000);
    }


    let runId = '';
    const startTime = Date.now();

    try {
      // 3. Assemble coherent, bounded source snapshot inside a RepeatableRead transaction
      const snapshot = await buildPostmortemSnapshot(organizationId, incidentId);
      if (!snapshot) {
        throw new NotFoundError('Incident not found in organization');
      }

      // 4. Create PostmortemRun audit record
      const runRecord = await prisma.postmortemRun.create({
        data: {
          organizationId,
          incidentId,
          triggerType,
          status: 'RUNNING',
          triggeredById: triggeredById || null,
        },
      });
      runId = runRecord.id;

      // Broadcast generation started socket event
      broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_STARTED', {
        incidentId,
        runId: runRecord.id,
        startedAt: runRecord.startedAt.toISOString(),
      });

      // 5. Sanitize context and execute AI Provider outside any database transaction
      const promptContext = sanitizeSnapshotForPrompt(snapshot);
      const provider = await PostmortemService.getProvider();
      const providerResult = await provider.generatePostmortem(
        promptContext,
        snapshot,
      );

      // 6. Ground & Validate Citations and Action Items against the Server Allowlist
      const { groundedOutput, validatedCitations, deduplicatedActions } = validateAndGroundPostmortemOutput(
        providerResult.rawOutput,
        snapshot.validSourceMap,
        snapshot,
      );

      // 7. Check Lock Ownership Loss before entering final commit transaction
      if (redisLockAcquired) {
        if (lockLost) {
          throw new LockOwnershipLostError();
        }
        const isOwner = await verifyLockOwnership(lockKey, lockVal, lockTtlMs);
        if (!isOwner) {
          throw new LockOwnershipLostError();
        }
      }

      // 8. Atomic Database Persistence with Safe Version Allocation & Retries
      const maxRetries = 3;
      let committedResult: {
        postmortemId: string;
        versionId: string;
        versionNumber: number;
      } | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          committedResult = await prisma.$transaction(
            async (tx) => {
              // Pre-write lock ownership verification
              if (redisLockAcquired) {
                if (lockLost) {
                  throw new LockOwnershipLostError();
                }
                const isOwnerPre = await verifyLockOwnership(lockKey, lockVal, lockTtlMs);
                if (!isOwnerPre) {
                  throw new LockOwnershipLostError();
                }
              }



              // A. Find or create Postmortem container
              let postmortem = await tx.postmortem.findFirst({
                where: { incidentId, organizationId },
              });

              if (!postmortem) {
                postmortem = await tx.postmortem.create({
                  data: {
                    organizationId,
                    incidentId,
                    status: PostmortemStatus.DRAFT,
                  },
                });
              }

              // B. Allocate next version number safely
              const highestVersion = await tx.postmortemVersion.findFirst({
                where: { postmortemId: postmortem.id },
                orderBy: { versionNumber: 'desc' },
                select: { versionNumber: true },
              });
              const nextVersionNumber = (highestVersion?.versionNumber || 0) + 1;

              // C. Reset previous isCurrent flags
              await tx.postmortemVersion.updateMany({
                where: { postmortemId: postmortem.id },
                data: { isCurrent: false },
              });

              // D. Create new immutable PostmortemVersion
              const version = await tx.postmortemVersion.create({
                data: {
                  postmortemId: postmortem.id,
                  organizationId,
                  incidentId,
                  versionNumber: nextVersionNumber,
                  status: PostmortemStatus.DRAFT,
                  isCurrent: true,
                  aiGenerated: true,
                  summary: groundedOutput.summary,
                  impact: groundedOutput.impact,
                  incidentTimeline: groundedOutput.incidentTimeline,
                  rootCause: groundedOutput.rootCause,
                  contributingFactors: groundedOutput.contributingFactors,
                  detection: groundedOutput.detection,
                  resolution: groundedOutput.resolution,
                  wentWell: groundedOutput.wentWell,
                  wentWrong: groundedOutput.wentWrong,
                  uncertainty: groundedOutput.uncertainty || null,
                  evidenceReferences: JSON.parse(JSON.stringify(validatedCitations)) as Prisma.InputJsonValue,
                  correlationRunId: snapshot.correlationRun?.id || null,
                  investigationRunId: snapshot.investigationRun?.id || null,
                  replayRunId: snapshot.replayRun?.id || null,
                  providerName: providerResult.providerName,
                  modelName: providerResult.modelName,
                  promptTokens: providerResult.promptTokens,
                  completionTokens: providerResult.completionTokens,
                  totalTokens: providerResult.totalTokens,
                  latencyMs: providerResult.latencyMs,
                  schemaVersion: 'v1.0',
                  createdById: triggeredById || null,
                },
              });

              // E. Update Postmortem active version pointer
              await tx.postmortem.update({
                where: { id: postmortem.id },
                data: { activeVersionId: version.id, status: PostmortemStatus.DRAFT },
              });

              // F. Create generated ActionItems attached to this exact new version
              if (deduplicatedActions.length > 0) {
                await tx.actionItem.createMany({
                  data: deduplicatedActions.map((ai) => ({
                    organizationId,
                    postmortemId: postmortem.id,
                    postmortemVersionId: version.id,
                    incidentId,
                    title: ai.title,
                    description: ai.description || null,
                    priority: ai.priority,
                    status: 'OPEN',
                    createdById: triggeredById || null,
                  })),
                });
              }

              // G. Update PostmortemRun audit record
              await tx.postmortemRun.update({
                where: { id: runRecord.id },
                data: {
                  postmortemId: postmortem.id,
                  status: 'COMPLETED',
                  providerName: providerResult.providerName,
                  modelName: providerResult.modelName,
                  promptTokens: toFiniteNonNegativeInteger(providerResult.promptTokens, 0, 10000000),
                  completionTokens: toFiniteNonNegativeInteger(providerResult.completionTokens, 0, 10000000),
                  totalTokens: toFiniteNonNegativeInteger(providerResult.totalTokens, 0, 10000000),
                  latencyMs: toFiniteNonNegativeInteger(
                    providerResult.latencyMs,
                    toFiniteNonNegativeInteger(Date.now() - startTime, 0),
                  ),
                  completedAt: new Date(),
                },
              });

              // H. Audit Timeline Event
              await tx.incidentEvent.create({
                data: {
                  incidentId,
                  organizationId,
                  userId: triggeredById || null,
                  source: 'AI',
                  type: 'POSTMORTEM_DRAFT_CREATED',
                  message: `AI Postmortem Version v${version.versionNumber} draft generated`,
                  metadata: {
                    automated: true,
                    postmortemRun: true,
                    postmortemId: postmortem.id,
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                  },
                },
              });

              // Post-write pre-commit lock ownership verification
              if (redisLockAcquired) {
                if (lockLost) {
                  throw new LockOwnershipLostError();
                }
                const isOwnerPost = await verifyLockOwnership(lockKey, lockVal, lockTtlMs);
                if (!isOwnerPost) {
                  throw new LockOwnershipLostError();
                }
              }

              return {
                postmortemId: postmortem.id,
                versionId: version.id,
                versionNumber: version.versionNumber,
              };
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            },
          );

          break; // Successful transaction commit
        } catch (txErr: unknown) {
          // Check for retryable version unique collision or serialization failure
          const isP2034 = (txErr as { code?: string })?.code === 'P2034';
          const isVersionConflict = isPostmortemVersionNumberConflict(txErr);

          if ((isVersionConflict || isP2034) && attempt < maxRetries) {
            logger.warn({ attempt, incidentId }, 'Retrying postmortem persistence on version number race');
            await new Promise((r) => setTimeout(r, 50 * attempt));
            continue;
          }

          throw txErr;
        }
      }

      if (!committedResult) {
        throw new Error('Failed to commit postmortem generation after retries');
      }

      // 9. Post-Commit Broadcasts & Socket Notifications
      broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_COMPLETED', {
        incidentId,
        postmortemId: committedResult.postmortemId,
        versionId: committedResult.versionId,
        versionNumber: committedResult.versionNumber,
      });

      return {
        postmortemId: committedResult.postmortemId,
        versionId: committedResult.versionId,
        versionNumber: committedResult.versionNumber,
        status: 'COMPLETED',
        runId,
      };
    } catch (err) {
      logger.error({ err, incidentId }, 'AI Postmortem generation failed');

      if (runId) {
        const sanitizedError = redactSecrets(sanitizeString((err as Error).message || 'Generation failed')).slice(0, 1000);
        await prisma.postmortemRun
          .update({
            where: { id: runId },
            data: {
              status: 'FAILED',
              error: sanitizedError,
              completedAt: new Date(),
            },
          })
          .catch(() => undefined);

        broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_FAILED', {
          incidentId,
          runId,
          error: sanitizedError,
        });
      }

      throw err;
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      PostmortemService.localInFlight.delete(incidentId);

      if (redisLockAcquired) {
        await releaseDistributedLock(lockKey, lockVal);
      }
    }

  }

  public static async updatePostmortemVersion(
    organizationId: string,
    incidentId: string,
    input: UpdatePostmortemSchema,
    userId: string,
    userRole?: OrgRole,
  ) {
    // 1. Authorization: Fetch membership role if not provided
    let effectiveRole = userRole;
    if (!effectiveRole) {
      const membership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });
      if (!membership) {
        throw new ForbiddenError('User is not a member of this organization');
      }
      effectiveRole = membership.role;
    }

    if (effectiveRole === OrgRole.VIEWER) {
      throw new ForbiddenError('VIEWER role cannot edit or transition postmortem documents');
    }

    // 2. Fetch Postmortem Container
    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
      include: {
        incident: true,
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });

    if (!postmortem) {
      throw new NotFoundError('Postmortem document not found for this incident');
    }

    const currentVersion =
      postmortem.versions.find((v) => v.id === postmortem.activeVersionId) ||
      postmortem.versions.find((v) => v.isCurrent) ||
      postmortem.versions[0];

    if (!currentVersion) {
      throw new NotFoundError('No active postmortem version found');
    }

    if (!input.baseVersionId) {
      throw new ValidationError('baseVersionId is required for all postmortem edits and transitions');
    }

    // 4. Status Transition Handling (when NO content edits are present)
    if (input.status && !hasContentEdits(input)) {
      const targetStatus = input.status;

      return prisma.$transaction(
        async (tx) => {
          const txPostmortem = await tx.postmortem.findFirst({
            where: { incidentId, organizationId },
            include: {
              incident: true,
              versions: { orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }] },
            },
          });

          if (!txPostmortem) {
            throw new NotFoundError('Postmortem document not found for this incident');
          }

          const txActiveVersion =
            txPostmortem.versions.find((v) => v.id === txPostmortem.activeVersionId) ||
            txPostmortem.versions.find((v) => v.isCurrent) ||
            txPostmortem.versions[0];

          if (!txActiveVersion) {
            throw new NotFoundError('No active postmortem version found');
          }

          if (input.baseVersionId !== txActiveVersion.id) {
            throw new ConflictError('Stale postmortem edit: baseVersionId does not match current active version');
          }

          const currentStatus = txActiveVersion.status;

          // Validate allowed transitions
          // DRAFT -> IN_REVIEW (RESPONDER, ADMIN, OWNER)
          // IN_REVIEW -> DRAFT (RESPONDER, ADMIN, OWNER)
          // IN_REVIEW -> APPROVED (ADMIN, OWNER only)
          // APPROVED -> PUBLISHED (ADMIN, OWNER only, Incident must be RESOLVED)
          if (currentStatus === PostmortemStatus.DRAFT && targetStatus === PostmortemStatus.IN_REVIEW) {
            // Allowed for all non-viewers
          } else if (currentStatus === PostmortemStatus.IN_REVIEW && targetStatus === PostmortemStatus.DRAFT) {
            // Allowed for all non-viewers (request changes)
          } else if (currentStatus === PostmortemStatus.IN_REVIEW && targetStatus === PostmortemStatus.APPROVED) {
            if (effectiveRole !== OrgRole.OWNER && effectiveRole !== OrgRole.ADMIN) {
              throw new ForbiddenError('Only OWNER or ADMIN can approve a postmortem');
            }
          } else if (currentStatus === PostmortemStatus.APPROVED && targetStatus === PostmortemStatus.PUBLISHED) {
            if (effectiveRole !== OrgRole.OWNER && effectiveRole !== OrgRole.ADMIN) {
              throw new ForbiddenError('Only OWNER or ADMIN can publish a postmortem');
            }
            if (txPostmortem.incident.status !== IncidentStatus.RESOLVED) {
              throw new ValidationError('Cannot publish postmortem for an unresolved incident');
            }
            // Verify required sections are non-empty
            if (!txActiveVersion.summary || !txActiveVersion.rootCause || !txActiveVersion.resolution || !txActiveVersion.impact) {
              throw new ValidationError('Cannot publish postmortem with incomplete required narrative sections');
            }
          } else if (currentStatus === targetStatus) {
            // No-op transition
            return txActiveVersion;
          } else {
            throw new ValidationError(`Invalid status transition from ${currentStatus} to ${targetStatus}`);
          }

          const updateData: Prisma.PostmortemVersionUpdateInput = {
            status: targetStatus,
          };

          if (targetStatus === PostmortemStatus.APPROVED) {
            updateData.approvedById = userId;
          } else if (targetStatus === PostmortemStatus.PUBLISHED) {
            updateData.publishedById = userId;
            updateData.publishedAt = new Date();
          } else if (targetStatus === PostmortemStatus.DRAFT) {
            updateData.approvedById = null;
            updateData.publishedById = null;
            updateData.publishedAt = null;
          }

          const updated = await tx.postmortemVersion.update({
            where: { id: txActiveVersion.id },
            data: updateData,
          });

          await tx.postmortem.update({
            where: { id: txPostmortem.id },
            data: { status: targetStatus },
          });

          return updated;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );
    }

    // 5. Complete Immutable Versioning on Content Edits (Blocker 4)
    // Every content edit creates a NEW version (including edits to an existing DRAFT).
    return prisma.$transaction(
      async (tx) => {
        const txPostmortem = await tx.postmortem.findFirst({
          where: { incidentId, organizationId },
          include: {
            versions: { orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }] },
          },
        });

        if (!txPostmortem) {
          throw new NotFoundError('Postmortem not found in transaction');
        }

        const txActiveVersion =
          txPostmortem.versions.find((v) => v.id === txPostmortem.activeVersionId) ||
          txPostmortem.versions.find((v) => v.isCurrent) ||
          txPostmortem.versions[0];

        if (!txActiveVersion) {
          throw new NotFoundError('No active postmortem version found');
        }

        if (input.baseVersionId !== txActiveVersion.id) {
          throw new ConflictError('Stale postmortem edit: baseVersionId does not match current active version');
        }

        const maxVersionNum = Math.max(...txPostmortem.versions.map((v) => v.versionNumber), 0);
        const nextVersionNumber = maxVersionNum + 1;

        // Mark existing versions non-current
        await tx.postmortemVersion.updateMany({
          where: { postmortemId: txPostmortem.id },
          data: { isCurrent: false },
        });

        // Create new version
        const newVersion = await tx.postmortemVersion.create({
          data: {
            postmortemId: txPostmortem.id,
            organizationId,
            incidentId,
            versionNumber: nextVersionNumber,
            status: PostmortemStatus.DRAFT,
            isCurrent: true,
            aiGenerated: false,
            summary: input.summary !== undefined ? sanitizeString(input.summary) : txActiveVersion.summary,
            impact: input.impact !== undefined ? sanitizeString(input.impact) : txActiveVersion.impact,
            incidentTimeline:
              input.incidentTimeline !== undefined
                ? sanitizeString(input.incidentTimeline)
                : txActiveVersion.incidentTimeline,
            rootCause: input.rootCause !== undefined ? sanitizeString(input.rootCause) : txActiveVersion.rootCause,
            contributingFactors:
              input.contributingFactors !== undefined
                ? sanitizeString(input.contributingFactors)
                : txActiveVersion.contributingFactors,
            detection: input.detection !== undefined ? sanitizeString(input.detection) : txActiveVersion.detection,
            resolution: input.resolution !== undefined ? sanitizeString(input.resolution) : txActiveVersion.resolution,
            wentWell: input.wentWell !== undefined ? sanitizeString(input.wentWell) : txActiveVersion.wentWell,
            wentWrong: input.wentWrong !== undefined ? sanitizeString(input.wentWrong) : txActiveVersion.wentWrong,
            uncertainty:
              input.uncertainty !== undefined
                ? input.uncertainty
                  ? sanitizeString(input.uncertainty)
                  : null
                : txActiveVersion.uncertainty,
            evidenceReferences: txActiveVersion.evidenceReferences as unknown as Prisma.InputJsonValue,
            correlationRunId: txActiveVersion.correlationRunId,
            investigationRunId: txActiveVersion.investigationRunId,
            replayRunId: txActiveVersion.replayRunId,
            createdById: userId,
            approvedById: null,
            publishedById: null,
            publishedAt: null,
          },
        });

        // Copy generated action items belonging to the old active version to the new version
        const existingVersionActions = await tx.actionItem.findMany({
          where: {
            postmortemId: txPostmortem.id,
            postmortemVersionId: txActiveVersion.id,
          },
        });

        if (existingVersionActions.length > 0) {
          await tx.actionItem.createMany({
            data: existingVersionActions.map((ai) => ({
              organizationId,
              postmortemId: txPostmortem.id,
              postmortemVersionId: newVersion.id,
              incidentId,
              title: ai.title,
              description: ai.description,
              status: ai.status,
              priority: ai.priority,
              assigneeId: ai.assigneeId,
              dueDate: ai.dueDate,
              createdById: ai.createdById,
            })),
          });
        }

        // Update postmortem container activeVersionId and status to DRAFT
        await tx.postmortem.update({
          where: { id: txPostmortem.id },
          data: {
            activeVersionId: newVersion.id,
            status: PostmortemStatus.DRAFT,
          },
        });

        return newVersion;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  public static async createActionItem(
    organizationId: string,
    incidentId: string,
    input: CreateActionItemSchema,
    userId: string,
  ) {
    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
    });

    if (!postmortem) {
      throw new NotFoundError('Postmortem document not found for this incident');
    }

    if (input.assigneeId) {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: input.assigneeId,
          },
        },
      });
      if (!member) {
        throw new ValidationError('Assigned user is not a member of this organization');
      }
    }

    return prisma.actionItem.create({
      data: {
        organizationId,
        postmortemId: postmortem.id,
        postmortemVersionId: null, // Manual action items are global to the postmortem
        incidentId,
        title: sanitizeString(input.title).slice(0, 255),
        description: input.description ? sanitizeString(input.description).slice(0, 2000) : null,
        priority: input.priority || 'MEDIUM',
        status: 'OPEN',
        assigneeId: input.assigneeId || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdById: userId,
      },
    });
  }

  public static async updateActionItem(
    organizationId: string,
    incidentId: string,
    actionItemId: string,
    input: UpdateActionItemSchema,
  ) {
    const actionItem = await prisma.actionItem.findFirst({
      where: { id: actionItemId, incidentId, organizationId },
    });

    if (!actionItem) {
      throw new NotFoundError('Action item not found for this incident');
    }

    if (input.assigneeId) {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: input.assigneeId,
          },
        },
      });
      if (!member) {
        throw new ValidationError('Assigned user is not a member of this organization');
      }
    }

    return prisma.actionItem.update({
      where: { id: actionItemId },
      data: {
        title: input.title !== undefined ? sanitizeString(input.title).slice(0, 255) : actionItem.title,
        description:
          input.description !== undefined
            ? input.description
              ? sanitizeString(input.description).slice(0, 2000)
              : null
            : actionItem.description,
        priority: input.priority ?? actionItem.priority,
        status: input.status ?? actionItem.status,
        assigneeId: input.assigneeId !== undefined ? input.assigneeId : actionItem.assigneeId,
        dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : actionItem.dueDate,
      },
    });
  }

  public static async getPostmortem(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
      include: {
        versions: {
          orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
          take: 50,
        },
      },
    });

    // Upstream Run Lookups for honest telemetry status
    const latestRun = await prisma.postmortemRun.findFirst({
      where: { incidentId, organizationId },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });

    const latestCompletedRun = await prisma.postmortemRun.findFirst({
      where: { incidentId, organizationId, status: 'COMPLETED', completedAt: { not: null } },
      orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
    });

    const isRunning = Boolean(latestRun && latestRun.status === 'RUNNING');

    const latestFailure =
      latestRun && latestRun.status === 'FAILED'
        ? {
            runId: latestRun.id,
            error: latestRun.error ? redactSecrets(latestRun.error).slice(0, 1000) : 'Generation failed',
            completedAt: latestRun.completedAt ? latestRun.completedAt.toISOString() : null,
          }
        : null;

    if (!postmortem) {
      return {
        incidentId,
        postmortem: null,
        activeVersion: null,
        versions: [],
        actionItems: [],
        latestRun,
        latestCompletedRun,
        latestFailure,
        isRunning,
        isGenerating: isRunning,
      };
    }

    // Integrity Check: Multiple active current versions detection (Blocker 8)
    const currentVersions = postmortem.versions.filter((v) => v.isCurrent);
    if (currentVersions.length > 1) {
      logger.error({ incidentId, count: currentVersions.length }, 'Integrity violation: multiple current versions detected');
      throw new Error('Integrity violation: multiple active postmortem versions found');
    }

    // Determine authoritative active version
    const activeVersion =
      postmortem.versions.find((v) => v.id === postmortem.activeVersionId) ||
      postmortem.versions.find((v) => v.isCurrent) ||
      postmortem.versions[0] ||
      null;

    // Fetch action items: AI generated for activeVersion + global manual items (postmortemVersionId: null)
    const actionItems = activeVersion
      ? await prisma.actionItem.findMany({
          where: {
            postmortemId: postmortem.id,
            organizationId,
            OR: [{ postmortemVersionId: activeVersion.id }, { postmortemVersionId: null }],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];

    return {
      incidentId,
      postmortem: {
        ...postmortem,
        activeVersion,
        actionItems,
      },
      activeVersion,
      versions: postmortem.versions,
      actionItems,
      latestRun,
      latestCompletedRun,
      latestFailure,
      isRunning,
      isGenerating: isRunning,
    };
  }
}

function hasContentEdits(input: UpdatePostmortemSchema): boolean {
  return (
    input.summary !== undefined ||
    input.impact !== undefined ||
    input.incidentTimeline !== undefined ||
    input.rootCause !== undefined ||
    input.contributingFactors !== undefined ||
    input.detection !== undefined ||
    input.resolution !== undefined ||
    input.wentWell !== undefined ||
    input.wentWrong !== undefined ||
    input.uncertainty !== undefined
  );
}
