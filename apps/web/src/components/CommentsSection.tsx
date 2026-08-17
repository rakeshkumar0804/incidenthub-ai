import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getIncidentComments, createIncidentComment, updateIncidentComment, deleteIncidentComment } from '../services/commentService';
import { useAuth } from '../features/auth/AuthContext';
import type { IncidentCommentDto } from '@incidenthub/shared';

interface CommentsSectionProps {
  organizationId: string;
  incidentId: string;
}

export function CommentsSection({ organizationId, incidentId }: CommentsSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: comments = [], isLoading, isError } = useQuery({
    queryKey: ['comments', incidentId],
    queryFn: () => getIncidentComments(organizationId, incidentId),
    enabled: Boolean(organizationId && incidentId),
  });

  const createMutation = useMutation({
    mutationFn: (text: string) => createIncidentComment(organizationId, incidentId, text),
    onSuccess: (newComment) => {
      setContent('');
      setErrorMsg(null);
      queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
        if (!old) return [newComment];
        if (old.some((c) => c.id === newComment.id)) return old;
        return [...old, newComment];
      });
    },
    onError: (err: unknown) => {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const e = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(e.response?.data?.error?.message || 'Failed to add comment');
      } else {
        setErrorMsg('Failed to add comment');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      updateIncidentComment(organizationId, incidentId, commentId, text),
    onSuccess: (updatedComment) => {
      setEditingId(null);
      setEditContent('');
      queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
        if (!old) return [updatedComment];
        return old.map((c) => (c.id === updatedComment.id ? updatedComment : c));
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteIncidentComment(organizationId, incidentId, commentId),
    onSuccess: (_, commentId) => {
      queryClient.setQueryData<IncidentCommentDto[]>(['comments', incidentId], (old) => {
        if (!old) return [];
        return old.filter((c) => c.id !== commentId);
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    createMutation.mutate(content.trim());
  };

  const startEditing = (comment: IncidentCommentDto) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const handleSaveEdit = (commentId: string) => {
    if (!editContent.trim()) return;
    updateMutation.mutate({ commentId, text: editContent.trim() });
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-gray-800 pb-4">
        <h3 className="text-lg font-semibold text-gray-100">Discussion & Comments</h3>
        <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-lg bg-red-950/50 p-3 text-xs text-red-400 border border-red-800/50">
          {errorMsg}
        </div>
      )}

      {/* New Comment Composer */}
      <form onSubmit={handleSubmit} className="mt-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type a comment or status update..."
          rows={3}
          className="w-full rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={!content.trim() || createMutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? 'Posting...' : 'Post Comment'}
          </button>
        </div>
      </form>

      {/* Comments Feed */}
      <div className="mt-6 space-y-4">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-gray-500">Loading comments...</div>
        ) : isError ? (
          <div className="text-center py-6 text-xs text-red-400">Error loading comments.</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">
            No comments yet. Start the conversation!
          </div>
        ) : (
          comments.map((comment) => {
            const isOwner = comment.userId === user?.id;
            const isEditing = editingId === comment.id;

            return (
              <div
                key={comment.id}
                className="flex gap-3 rounded-lg border border-gray-800/60 bg-gray-950/40 p-4 transition-colors hover:border-gray-800"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-xs font-semibold text-brand-400">
                  {comment.user?.name ? comment.user.name.charAt(0).toUpperCase() : 'U'}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-200">{comment.user?.name || 'Unknown'}</span>
                      <span className="text-[10px] text-gray-500">
                        {new Date(comment.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {isOwner && !isEditing && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEditing(comment)}
                          className="text-[10px] text-gray-400 hover:text-gray-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(comment.id)}
                          className="text-[10px] text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full rounded-md border border-gray-700 bg-gray-900 p-2 text-xs text-gray-100 focus:border-brand-500 focus:outline-none"
                        rows={2}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-gray-700 px-3 py-1 text-[10px] text-gray-300 hover:bg-gray-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(comment.id)}
                          disabled={updateMutation.isPending}
                          className="rounded-md bg-brand-600 px-3 py-1 text-[10px] text-white hover:bg-brand-500"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">{comment.content}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
