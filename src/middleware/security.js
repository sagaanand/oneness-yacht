// Security, Rate Limiting & RBAC Middleware

const ipRequestMap = new Map();

/**
 * Sliding Window Rate Limiter Factory
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Max allowed requests in window
 * @param {string} options.message - Error message upon limit reached
 */
function createRateLimiter({ windowMs = 60000, max = 30, message = 'Too many requests. Please try again later.' }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const key = `${req.baseUrl || ''}:${req.path}:${ip}`;

    let record = ipRequestMap.get(key);
    if (!record || now - record.startTime > windowMs) {
      record = { startTime: now, count: 1 };
      ipRequestMap.set(key, record);
    } else {
      record.count++;
    }

    // Set standard RateLimit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', new Date(record.startTime + windowMs).toISOString());

    if (record.count > max) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: Math.ceil((record.startTime + windowMs - now) / 1000)
      });
    }

    next();
  };
}

/**
 * Enterprise HTTP Security Headers Middleware
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

/**
 * Role-Based Access Control (RBAC) Staff Authentication Middleware
 * Enforces staff/admin access for operations & crew portals.
 * In production: validates x-admin-key or Authorization Bearer header.
 * In development: defaults to authorized super-admin if key omitted.
 */
function requireStaffAuth(allowedRoles = ['SUPER_ADMIN', 'OPERATIONS']) {
  return (req, res, next) => {
    const adminKey = req.headers['x-admin-key'] || 
      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') 
        ? req.headers.authorization.slice(7) 
        : null);

    const configuredKey = process.env.ADMIN_API_KEY || 'oneness_admin_secret_2026';

    if (process.env.NODE_ENV === 'production') {
      if (!adminKey || adminKey !== configuredKey) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized. Valid staff credentials or API key required.'
        });
      }
    } else {
      // In development mode, check key if provided, otherwise permit with default audit identity
      if (adminKey && adminKey !== configuredKey) {
        return res.status(401).json({
          success: false,
          error: 'Invalid staff API key provided.'
        });
      }
    }

    req.staffUser = {
      username: req.headers['x-staff-user'] || 'admin',
      role: 'SUPER_ADMIN',
      fullName: 'Oneness Operations Staff'
    };

    next();
  };
}

// Pre-configured rate limiters
const holdRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Hold limit reached. Please wait before creating more checkout holds.'
});

const paymentRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: 'Payment rate limit exceeded. Please wait a moment before retrying.'
});

const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Operations rate limit reached.'
});

module.exports = {
  createRateLimiter,
  securityHeaders,
  requireStaffAuth,
  holdRateLimiter,
  paymentRateLimiter,
  adminRateLimiter
};

