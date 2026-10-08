const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RefreshToken = require('../models/refreshToken.model');
const VerificationToken = require('../models/verificationToken.model');
const { hashToken, generateRandomToken } = require('../utils/crypto');

const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );
};

const generateRefreshTokenString = () => {
  return generateRandomToken(40);
};

const createRefreshToken = async (user, familyId = null) => {
  const tokenString = generateRefreshTokenString();
  const tokenHash = hashToken(tokenString);
  
  // Create a new family if not provided
  const finalFamilyId = familyId || crypto.randomUUID();
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await RefreshToken.create({
    user: user._id,
    tokenHash,
    familyId: finalFamilyId,
    expiresAt,
  });

  return { tokenString, familyId: finalFamilyId };
};

const revokeTokenFamily = async (familyId) => {
  await RefreshToken.updateMany(
    { familyId },
    { $set: { revoked: true } }
  );
};

const createVerificationToken = async (userId, type) => {
  const tokenString = generateRandomToken(32);
  const tokenHash = hashToken(tokenString);
  
  const expiresAt = new Date();
  if (type === 'EMAIL_VERIFICATION') {
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours
  } else if (type === 'PASSWORD_RESET') {
    expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 mins
  }

  await VerificationToken.create({
    user: userId,
    tokenHash,
    type,
    expiresAt,
  });

  return tokenString;
};

module.exports = {
  generateAccessToken,
  createRefreshToken,
  revokeTokenFamily,
  createVerificationToken,
};
