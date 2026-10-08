const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

/**
 * Middleware to verify JWT Access Token from cookies
 */
const requireAuth = async (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken;

    if (!accessToken) {
      return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    }

    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);
      
      // Load minimal user details and attach to request
      const user = await User.findById(decoded.userId).select('-passwordHash -failedLoginAttempts -lockUntil');
      if (!user) {
         return res.status(401).json({ success: false, message: 'User associated with this token no longer exists.' });
      }

      req.user = user;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Access token expired.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware for Role-Based Access Control
 * Usage: requireRole('ADMIN')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
    }
    next();
  };
};

module.exports = {
  requireAuth,
  requireRole
};
