const express = require('express');
const authController = require('../controllers/auth.controller');
const { validateRequest } = require('../middleware/validation.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const {
  registerLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  resendVerificationLimiter
} = require('../middleware/rateLimit.middleware');
const {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator
} = require('../validators/auth.validator');

const router = express.Router();

// Public Routes
router.post(
  '/register',
  registerLimiter,
  registerValidator,
  validateRequest,
  authController.register
);

router.post(
  '/login',
  loginLimiter,
  loginValidator,
  validateRequest,
  authController.login
);

router.post('/logout', authController.logout);

router.post('/refresh', authController.refresh);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  forgotPasswordValidator,
  validateRequest,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  resetPasswordValidator,
  validateRequest,
  authController.resetPassword
);

router.post(
  '/verify-email',
  authController.verifyEmail
);

router.post(
  '/resend-verification',
  resendVerificationLimiter,
  forgotPasswordValidator, // We can reuse the email validator
  validateRequest,
  authController.resendVerification
);

// Protected Routes
router.get('/me', requireAuth, authController.getCurrentUser);

router.post(
  '/change-password',
  requireAuth,
  changePasswordValidator,
  validateRequest,
  authController.changePassword
);

module.exports = router;
