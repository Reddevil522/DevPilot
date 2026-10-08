const rateLimit = require('express-rate-limit');

// Common options for standard rate limits
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message: message || 'Too many requests. Please try again later.' },
    standardHeaders: true, 
    legacyHeaders: false,
    // Note: In a production multi-server deployment, 
    // a Redis store should be configured here.
    // store: new RedisStore({ ... }) 
  });
};

const loginLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 mins
  10, // max 10 requests per window
  'Too many login attempts. Please try again after 15 minutes.'
);

const registerLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  5, // max 5 accounts created per IP per hour
  'Too many accounts created from this IP. Please try again later.'
);

const forgotPasswordLimiter = createRateLimiter(
  15 * 60 * 1000,
  3,
  'Too many password reset requests. Please try again later.'
);

const resendVerificationLimiter = createRateLimiter(
  15 * 60 * 1000,
  3,
  'Too many verification email requests. Please try again later.'
);

module.exports = {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resendVerificationLimiter
};
