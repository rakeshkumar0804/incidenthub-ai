import { z } from 'zod';

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment body cannot be empty').max(5000, 'Comment too long'),
  parentId: z.string().cuid('Invalid parent comment ID').optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment body cannot be empty').max(5000, 'Comment too long'),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
