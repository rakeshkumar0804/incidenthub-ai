import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { CommentController } from './comment.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

router.get('/', requirePermission('incidents:read'), (req, res, next) => {
  void CommentController.getComments(req, res, next);
});

router.post('/', requirePermission('incidents:comment'), (req, res, next) => {
  void CommentController.createComment(req, res, next);
});

router.patch('/:commentId', requirePermission('incidents:comment'), (req, res, next) => {
  void CommentController.updateComment(req, res, next);
});

router.delete('/:commentId', requirePermission('incidents:comment'), (req, res, next) => {
  void CommentController.deleteComment(req, res, next);
});

export { router as commentsRouter };
