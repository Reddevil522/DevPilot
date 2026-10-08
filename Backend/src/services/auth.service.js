const User = require('../models/user.model');
const RefreshToken = require('../models/refreshToken.model');
const VerificationToken = require('../models/verificationToken.model');
const { hashPassword, verifyPassword, hashToken } = require('../utils/crypto');
const tokenService = require('./token.service');
const emailService = require('./email.service');

// Constants
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 mins

class AuthService {
  async register(data) {
    const { name, email, password } = data;

    // Password already validated in middleware, hash it here
    const hashedPassword = await hashPassword(password);

    const user = await User.create({
      name,
      email,
      passwordHash: hashedPassword,
    });

    // Create Verification Token
    const vToken = await tokenService.createVerificationToken(user._id, 'EMAIL_VERIFICATION');
    await emailService.sendVerificationEmail(user.email, vToken);

    return user;
  }

  async login(email, password) {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      throw { statusCode: 401, message: 'Invalid email or password.' };
    }

    if (!user.isActive) {
      throw { statusCode: 403, message: 'Account is deactivated.' };
    }

    if (user.isLocked()) {
      throw { statusCode: 403, message: 'Account is temporarily locked. Try again later.' };
    }

    const isValid = await verifyPassword(user.passwordHash, password);

    if (!isValid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
      }
      await user.save();
      throw { statusCode: 401, message: 'Invalid email or password.' };
    }

    // Successful login - reset counters
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    // Generate tokens
    const accessToken = tokenService.generateAccessToken(user);
    const { tokenString: refreshToken, familyId } = await tokenService.createRefreshToken(user);

    return { user, accessToken, refreshToken, familyId };
  }

  async logout(refreshTokenString) {
    if (!refreshTokenString) return;
    const tokenHash = hashToken(refreshTokenString);
    const tokenDoc = await RefreshToken.findOne({ tokenHash });
    
    if (tokenDoc) {
      await tokenService.revokeTokenFamily(tokenDoc.familyId);
    }
  }

  async verifyEmail(tokenString) {
    const tokenHash = hashToken(tokenString);
    const tokenDoc = await VerificationToken.findOne({
      tokenHash,
      type: 'EMAIL_VERIFICATION',
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!tokenDoc) {
      throw { statusCode: 400, message: 'Invalid or expired verification token.' };
    }

    const user = await User.findById(tokenDoc.user);
    if (!user) {
      throw { statusCode: 400, message: 'User not found.' };
    }

    user.isEmailVerified = true;
    await user.save();

    tokenDoc.used = true;
    await tokenDoc.save();
  }

  async refreshTokens(refreshTokenString) {
    if (!refreshTokenString) {
      throw { statusCode: 401, message: 'Refresh token required.' };
    }

    const tokenHash = hashToken(refreshTokenString);
    const tokenDoc = await RefreshToken.findOne({ tokenHash }).populate('user');

    if (!tokenDoc) {
      throw { statusCode: 401, message: 'Invalid refresh token.' };
    }

    // If token is revoked, it's a token reuse attempt! Revoke entire family.
    if (tokenDoc.revoked) {
      await tokenService.revokeTokenFamily(tokenDoc.familyId);
      throw { statusCode: 401, message: 'Token reuse detected. Please login again.' };
    }

    if (tokenDoc.expiresAt < new Date()) {
      await tokenService.revokeTokenFamily(tokenDoc.familyId);
      throw { statusCode: 401, message: 'Refresh token expired.' };
    }

    // Valid token. Invalidate it (rotation) and create a new one in the same family.
    tokenDoc.revoked = true;
    await tokenDoc.save();

    const user = tokenDoc.user;
    if (!user || !user.isActive) {
      throw { statusCode: 401, message: 'User invalid or deactivated.' };
    }

    const accessToken = tokenService.generateAccessToken(user);
    const { tokenString: newRefreshToken } = await tokenService.createRefreshToken(user, tokenDoc.familyId);

    // Link the old token to the new one for traceability (optional but good practice)
    tokenDoc.replacedByTokenHash = hashToken(newRefreshToken);
    await tokenDoc.save();

    return { user, accessToken, refreshToken: newRefreshToken };
  }

  async forgotPassword(email) {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return success regardless of if user exists (to prevent enumeration)
    if (user) {
      const resetToken = await tokenService.createVerificationToken(user._id, 'PASSWORD_RESET');
      await emailService.sendPasswordResetEmail(user.email, resetToken);
    }
  }

  async resetPassword(tokenString, newPassword) {
    const tokenHash = hashToken(tokenString);
    const tokenDoc = await VerificationToken.findOne({
      tokenHash,
      type: 'PASSWORD_RESET',
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!tokenDoc) {
      throw { statusCode: 400, message: 'Invalid or expired reset token.' };
    }

    const user = await User.findById(tokenDoc.user);
    if (!user) {
      throw { statusCode: 400, message: 'User not found.' };
    }

    user.passwordHash = await hashPassword(newPassword);
    
    // Optional: unlock account if locked during password reset
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    tokenDoc.used = true;
    await tokenDoc.save();
    
    // Optional but recommended: Revoke all existing sessions for this user for security
    // We can just revoke all refresh tokens for this user
    await RefreshToken.updateMany({ user: user._id }, { $set: { revoked: true } });
  }

  async changePassword(userId, currentPassword, newPassword) {
     const user = await User.findById(userId);
     if (!user) throw { statusCode: 404, message: 'User not found.' };

     const isValid = await verifyPassword(user.passwordHash, currentPassword);
     if (!isValid) throw { statusCode: 400, message: 'Incorrect current password.' };

     user.passwordHash = await hashPassword(newPassword);
     await user.save();

     // Revoke existing sessions
     await RefreshToken.updateMany({ user: userId }, { $set: { revoked: true } });
  }
}

module.exports = new AuthService();
