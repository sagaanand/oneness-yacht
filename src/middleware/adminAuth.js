/**
 * ONENESS YACHTS — ADMIN AUTH MIDDLEWARE
 * Validates admin session cookie (ast_*) or API key header.
 * Separate from customer authentication.
 */

const adminAuthService = require('../services/adminAuthService');

const ADMIN_COOKIE_NAME = 'ony_admin_session';

/**
 * Middleware: require admin authentication (session cookie or API key)
 */
function requireAdminAuth(allowedRoles = ['SUPER_ADMIN', 'OPERATIONS', 'CONCIERGE']) {
  return async (req, res, next) => {
    // 1. Try session cookie
    const cookieToken = req.cookies && req.cookies[ADMIN_COOKIE_NAME];

    // 2. Try API key header (legacy + programmatic access)
    const apiKey = req.headers['x-admin-key'] ||
      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice(7) : null);

    const configuredApiKey = process.env.ADMIN_API_KEY || 'oneness_admin_secret_2026';

    let adminUser = null;

    if (cookieToken) {
      adminUser = await adminAuthService.validateSession(cookieToken);
      if (!adminUser) {
        clearAdminSessionCookie(res);
      }
    }

    if (!adminUser && apiKey) {
      if (apiKey === configuredApiKey) {
        adminUser = { id: 'admin', username: 'admin', fullName: 'Fleet Director', role: 'SUPER_ADMIN' };
      }
    }

    // Dev mode fallback (no auth provided, development only)
    if (!adminUser && process.env.NODE_ENV !== 'production' && !cookieToken && !apiKey) {
      adminUser = { id: 'admin', username: 'admin', fullName: 'Fleet Director (Dev)', role: 'SUPER_ADMIN' };
    }

    if (!adminUser) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          success: false,
          error: 'Admin authentication required.',
          redirectTo: '/admin/login'
        });
      }
      return res.redirect('/admin/login?returnTo=' + encodeURIComponent(req.originalUrl));
    }

    // Role check
    if (!allowedRoles.includes(adminUser.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${adminUser.role}`
      });
    }

    req.adminUser = adminUser;
    next();
  };
}

/**
 * Set admin session cookie
 */
function setAdminSessionCookie(res, sessionToken) {
  const isSecure = process.env.COOKIE_SECURE === 'true' || 
    (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false' && Boolean(res.req && res.req.secure));
  res.cookie(ADMIN_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  });
}

function clearAdminSessionCookie(res) {
  const isSecure = process.env.COOKIE_SECURE === 'true' || 
    (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false' && Boolean(res.req && res.req.secure));
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax'
  });
}

module.exports = { requireAdminAuth, setAdminSessionCookie, clearAdminSessionCookie, ADMIN_COOKIE_NAME };
