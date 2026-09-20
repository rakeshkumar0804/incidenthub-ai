import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireOrgIncidentPermission } from '../../middleware/resourceAuth';
import { CommentController } from './comment.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});

router.get(
  '/',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:read')(req, res, next);
  },
  (req, res, next) => {
    void CommentController.getComments(req, res, next);
  },
);

router.post(
  '/',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:comment')(req, res, next);
  },
  (req, res, next) => {
    void CommentController.createComment(req, res, next);
  },
);

router.patch(
  '/:commentId',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:comment')(req, res, next);
  },
  (req, res, next) => {
    void CommentController.updateComment(req, res, next);
  },
);

router.delete(
  '/:commentId',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:comment')(req, res, next);
  },
  (req, res, next) => {
    void CommentController.deleteComment(req, res, next);
  },
);

export { router as commentsRouter };
