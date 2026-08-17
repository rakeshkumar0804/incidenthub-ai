import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate, requireAuth } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

// Public auth endpoints with rate limiting
router.post('/register', authRateLimiter, (req, res, next) => {
  void AuthController.register(req, res, next);
});

router.post('/login', authRateLimiter, (req, res, next) => {
  void AuthController.login(req, res, next);
});

router.post('/logout', (req, res, next) => {
  void AuthController.logout(req, res, next);
});

router.post('/refresh', (req, res, next) => {
  void AuthController.refresh(req, res, next);
});

router.post('/forgot-password', authRateLimiter, (req, res, next) => {
  void AuthController.forgotPassword(req, res, next);
});

router.post('/reset-password', (req, res, next) => {
  void AuthController.resetPassword(req, res, next);
});

router.post('/verify-email', (req, res, next) => {
  void AuthController.verifyEmail(req, res, next);
});

router.post('/resend-verification', (req, res, next) => {
  void AuthController.resendVerification(req, res, next);
});

router.post('/dev-restore-owner', (req, res, next) => {
  void AuthController.devRestoreOwner(req, res, next);
});

router.post('/dev-reset-viewer', (req, res, next) => {
  void AuthController.devResetViewer(req, res, next);
});

router.post('/seed-demo', (req, res, next) => {
  void AuthController.seedDemo(req, res, next);
});


// Protected endpoints
router.get(
  '/me',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void AuthController.me(req, res, next);
  },
);

export { router as authRouter };
