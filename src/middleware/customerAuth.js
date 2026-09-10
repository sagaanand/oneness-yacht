/**
 * ONENESS YACHTS — CUSTOMER AUTH MIDDLEWARE
 * Reads session cookie, validates against customer_sessions table.
 * Sets req.customer if authenticated.
 */

const customerAuthService = require('../services/customerAuthService');

const COOKIE_NAME = 'ony_session';

/**
 * Middleware that optionally authenticates the customer.
 * Does NOT block the request if not authenticated.
 * Sets req.customer if session is valid.
 */
async function optionalCustomerAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    req.customer = await customerAuthService.validateSession(token);
  }
  next();
}

/**
 * Middleware that REQUIRES customer authentication.
 * Returns 401 if not authenticated (API routes) or redirects (page routes).
 */
async function handleCustomerAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Authentication required.', redirectTo: '/auth' });
    }
    return res.redirect('/auth?returnTo=' + encodeURIComponent(req.originalUrl));
  }

  const customer = await customerAuthService.validateSession(token);
  if (!customer) {
    res.clearCookie(COOKIE_NAME);
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.', redirectTo: '/auth' });
    }
    return res.redirect('/auth?returnTo=' + encodeURIComponent(req.originalUrl));
  }

  req.customer = customer;
  next();
}

function requireCustomerAuth(req, res, next) {
  if (req && req.headers && next) {
    // Called directly as middleware: requireCustomerAuth(req, res, next)
    return handleCustomerAuth(req, res, next);
  }
  // Called as factory: requireCustomerAuth()
  return handleCustomerAuth;
}

/**
 * Set customer session cookie (HttpOnly, Secure in production)
 */
function setSessionCookie(res, sessionToken) {
  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

/**
 * Clear customer session cookie
 */
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

module.exports = { optionalCustomerAuth, requireCustomerAuth, setSessionCookie, clearSessionCookie, COOKIE_NAME };
