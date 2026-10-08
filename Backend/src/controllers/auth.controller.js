const authService = require('../services/auth.service');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', // Protects against CSRF but allows local cross-origin
};

const setTokenCookies = (res, accessToken, refreshToken) => {
  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    path: '/api/auth/refresh', // Restrict path for refresh token
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const clearTokenCookies = (res) => {
  res.clearCookie('accessToken', { ...cookieOptions });
  res.clearCookie('refreshToken', { ...cookieOptions, path: '/api/auth/refresh' });
};

class AuthController {
  async register(req, res, next) {
    try {
      await authService.register(req.body);
      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, accessToken, refreshToken } = await authService.login(email, password);

      setTokenCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const refreshToken = req.cookies.refreshToken;
      await authService.logout(refreshToken);
      clearTokenCookies(res);
      
      res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  async getCurrentUser(req, res, next) {
    try {
      // req.user is set by the requireAuth middleware
      const user = req.user;
      res.status(200).json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async refresh(req, res, next) {
    try {
      const oldRefreshToken = req.cookies.refreshToken;
      const { user, accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens(oldRefreshToken);

      setTokenCookies(res, accessToken, newRefreshToken);

      res.status(200).json({
        success: true,
        message: 'Tokens refreshed successfully.'
      });
    } catch (error) {
      clearTokenCookies(res); // Clear invalid tokens if refresh fails
      next(error);
    }
  }

  async verifyEmail(req, res, next) {
    try {
      const { token } = req.query;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Verification token is required.' });
      }

      await authService.verifyEmail(token);
      res.status(200).json({
        success: true,
        message: 'Email verified successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  async resendVerification(req, res, next) {
      try {
        const { email } = req.body;
        // In a real app we might lookup the user and resend.
        // For security against enumeration, we don't confirm if the user exists.
        const user = await require('../models/user.model').findOne({ email: email.toLowerCase() });
        if (user && !user.isEmailVerified) {
             const tokenService = require('../services/token.service');
             const emailService = require('../services/email.service');
             const vToken = await tokenService.createVerificationToken(user._id, 'EMAIL_VERIFICATION');
             await emailService.sendVerificationEmail(user.email, vToken);
        }
        res.status(200).json({
          success: true,
          message: 'If the email is registered and not verified, a verification link has been sent.'
        });
      } catch (error) {
          next(error);
      }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      await authService.forgotPassword(email);
      
      res.status(200).json({
        success: true,
        message: 'If an account exists for this email, password reset instructions will be sent.'
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, password } = req.body;
      await authService.resetPassword(token, password);
      
      res.status(200).json({
        success: true,
        message: 'Password reset successful. You can now login with your new password.'
      });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      await authService.changePassword(req.user._id, currentPassword, newPassword);
      
      res.status(200).json({
        success: true,
        message: 'Password changed successfully. Existing sessions have been revoked.'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
