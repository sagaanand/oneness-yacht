/**
 * ONENESS YACHTS — CUSTOMER AUTHENTICATION SERVICE
 * Supports: EMAIL_OTP | GOOGLE | APPLE auth providers
 * Session management via customer_sessions table.
 * Tokens: cryptographically random, only hash stored in DB.
 */

const crypto = require('crypto');
const db = require('../db/connection');

const SESSION_DURATION_DAYS = 30;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

class CustomerAuthService {
  /**
   * Generate a cryptographically random session token
   * Returns: { rawToken, tokenHash }
   */
  _generateSessionToken() {
    const rawToken = `cst_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  /**
   * Generate and store an OTP code for email/phone login
   * @param {string} identifier - email or phone number
   * @param {string} identifierType - EMAIL | PHONE
   * @returns {Promise<Object>} { success, otp (dev only), expiresAt }
   */
  async generateOTP(identifier, identifierType = 'EMAIL') {
    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // Invalidate any existing OTPs for this identifier
    try {
      await db.query(
        `UPDATE otp_codes SET used_at = NOW() WHERE identifier = $1 AND identifier_type = $2 AND used_at IS NULL`,
        [identifier.toLowerCase().trim(), identifierType]
      );

      await db.query(
        `INSERT INTO otp_codes (identifier, identifier_type, code_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [identifier.toLowerCase().trim(), identifierType, codeHash, expiresAt]
      );
    } catch (err) {
      // Table may not exist yet in local dev
      console.warn('[CustomerAuth] OTP table not available — dev mode bypass');
    }

    const isDev = process.env.NODE_ENV !== 'production';

    return {
      success: true,
      expiresAt,
      // In dev/demo mode, return OTP in response so it can be used without SMS/email
      ...(isDev ? { otp: code, devMode: true } : { message: `OTP sent to ${identifierType === 'EMAIL' ? 'your email' : 'your mobile'}` })
    };
  }

  /**
   * Verify OTP and create/find customer + session
   * @param {string} identifier
   * @param {string} identifierType
   * @param {string} code - The 6-digit OTP
   * @param {Object} customerInfo - { fullName, email, phone } (for new customers)
   * @param {Object} meta - { ipAddress, userAgent }
   */
  async verifyOTPAndLogin(identifier, identifierType, code, customerInfo = {}, meta = {}) {
    const normalizedId = identifier.toLowerCase().trim();
    const codeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');

    // 1. Verify OTP
    let otpValid = false;
    let otpRow = null;

    try {
      const otpRes = await db.query(
        `SELECT * FROM otp_codes WHERE identifier = $1 AND identifier_type = $2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [normalizedId, identifierType]
      );
      otpRow = otpRes.rows[0];

      if (!otpRow) {
        return { success: false, error: 'No active OTP found. Please request a new code.' };
      }

      // Increment attempts
      await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otpRow.id]);

      if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
        return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
      }

      if (new Date(otpRow.expires_at) < new Date()) {
        return { success: false, error: 'OTP has expired. Please request a new code.' };
      }

      // Constant-time comparison to prevent timing attacks
      const hashA = Buffer.from(codeHash, 'hex');
      const hashB = Buffer.from(otpRow.code_hash, 'hex');
      if (hashA.length !== hashB.length || !crypto.timingSafeEqual(hashA, hashB)) {
        return { success: false, error: 'Invalid code. Please try again.' };
      }

      otpValid = true;
      await db.query(`UPDATE otp_codes SET used_at = NOW() WHERE id = $1`, [otpRow.id]);
    } catch (err) {
      // Dev mode: accept any 6-digit code if DB not available
      if (process.env.NODE_ENV !== 'production' && /^\d{6}$/.test(code)) {
        otpValid = true;
        console.warn('[CustomerAuth] Dev mode: OTP bypassed (DB unavailable)');
      } else {
        return { success: false, error: 'OTP verification failed. Please try again.' };
      }
    }

    if (!otpValid) {
      return { success: false, error: 'Invalid OTP code.' };
    }

    // 2. Find or create customer
    return this._findOrCreateCustomerAndSession({
      identifier: normalizedId,
      identifierType,
      customerInfo,
      authProvider: 'EMAIL_OTP',
      meta
    });
  }

  /**
   * OAuth login (Google / Apple)
   * @param {Object} params
   * @param {string} params.provider - GOOGLE | APPLE
   * @param {string} params.providerId - OAuth sub/id
   * @param {string} params.email
   * @param {string} params.name
   * @param {string} params.avatarUrl
   * @param {Object} params.meta
   */
  async oauthLogin({ provider, providerId, email, name, avatarUrl, meta = {} }) {
    try {
      // Find customer by OAuth provider ID
      let custRes = await db.query(
        `SELECT * FROM customers WHERE oauth_provider_id = $1 AND auth_provider = $2 LIMIT 1`,
        [providerId, provider]
      );

      let customer = custRes.rows[0];

      if (!customer && email) {
        // Try to find by email
        custRes = await db.query(`SELECT * FROM customers WHERE email = $1 LIMIT 1`, [email]);
        customer = custRes.rows[0];
      }

      if (!customer) {
        // Create new customer
        const newId = crypto.randomUUID();
        const insertRes = await db.query(
          `INSERT INTO customers (id, full_name, email, phone, email_verified, auth_provider, oauth_provider_id, avatar_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [newId, name || 'Guest', email || null, null, true, provider, providerId, avatarUrl || null]
        );
        customer = insertRes.rows[0];
      } else {
        // Update OAuth details
        await db.query(
          `UPDATE customers SET auth_provider = $1, oauth_provider_id = $2, email_verified = TRUE, avatar_url = COALESCE($3, avatar_url), updated_at = NOW() WHERE id = $4`,
          [provider, providerId, avatarUrl, customer.id]
        );
      }

      return this._createSession(customer, provider, meta);
    } catch (err) {
      console.error('[CustomerAuth] OAuth login error:', err.message);
      return { success: false, error: 'Authentication failed. Please try again.' };
    }
  }

  /**
   * Internal: find or create customer + create session
   */
  async _findOrCreateCustomerAndSession({ identifier, identifierType, customerInfo, authProvider, meta }) {
    try {
      let customer = null;

      if (identifierType === 'EMAIL') {
        const res = await db.query(`SELECT * FROM customers WHERE email = $1 LIMIT 1`, [identifier]);
        customer = res.rows[0];
      } else {
        const res = await db.query(`SELECT * FROM customers WHERE phone = $1 LIMIT 1`, [identifier]);
        customer = res.rows[0];
      }

      if (!customer) {
        // Create new customer
        const newId = crypto.randomUUID();
        const email = identifierType === 'EMAIL' ? identifier : (customerInfo.email || null);
        const phone = identifierType === 'PHONE' ? identifier : (customerInfo.phone || null);
        const name = customerInfo.fullName || customerInfo.name || 'Guest';

        const insertRes = await db.query(
          `INSERT INTO customers (id, full_name, email, phone, email_verified, phone_verified, auth_provider)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [newId, name, email, phone || '+971000000000',
           identifierType === 'EMAIL', identifierType === 'PHONE', authProvider]
        );
        customer = insertRes.rows[0];
      } else {
        // Update last login
        await db.query(`UPDATE customers SET updated_at = NOW() WHERE id = $1`, [customer.id]);
      }

      return this._createSession(customer, authProvider, meta);
    } catch (err) {
      console.error('[CustomerAuth] Find/create customer error:', err.message);
      return { success: false, error: 'Could not create or find your account. Please try again.' };
    }
  }

  /**
   * Create a secure customer session
   */
  async _createSession(customer, authProvider, meta = {}) {
    const { rawToken, tokenHash } = this._generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 3600 * 1000).toISOString();

    try {
      await db.query(
        `INSERT INTO customer_sessions (customer_id, token_hash, expires_at, ip_address, user_agent, auth_provider)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [customer.id, tokenHash, expiresAt, meta.ipAddress || null, meta.userAgent || null, authProvider]
      );
    } catch (err) {
      console.warn('[CustomerAuth] Could not persist session (DB issue):', err.message);
    }

    return {
      success: true,
      sessionToken: rawToken, // Set in HttpOnly cookie
      customer: {
        id: customer.id,
        name: customer.full_name,
        fullName: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatar_url,
        vipTier: customer.vip_tier || 'VIP'
      },
      expiresAt
    };
  }

  /**
   * Validate session token from cookie
   * @returns {Promise<Object|null>} customer or null
   */
  async validateSession(rawToken) {
    if (!rawToken || !rawToken.startsWith('cst_')) return null;

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    try {
      const sessionRes = await db.query(
        `SELECT cs.*, c.id as cust_id, c.full_name, c.email, c.phone, c.avatar_url, c.vip_tier
         FROM customer_sessions cs
         JOIN customers c ON c.id = cs.customer_id
         WHERE cs.token_hash = $1 AND cs.revoked_at IS NULL AND cs.expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );

      if (!sessionRes.rows.length) return null;

      const session = sessionRes.rows[0];

      // Update last_used_at
      await db.query(
        `UPDATE customer_sessions SET last_used_at = NOW() WHERE token_hash = $1`,
        [tokenHash]
      );

      return {
        id: session.cust_id,
        name: session.full_name,
        fullName: session.full_name,
        email: session.email,
        phone: session.phone,
        avatarUrl: session.avatar_url,
        vipTier: session.vip_tier || 'VIP',
        sessionTokenHash: tokenHash
      };
    } catch (err) {
      console.warn('[CustomerAuth] Session validation error:', err.message);
      return null;
    }
  }

  /**
   * Revoke a session (logout)
   */
  async revokeSession(rawToken) {
    if (!rawToken) return;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    try {
      await db.query(
        `UPDATE customer_sessions SET revoked_at = NOW() WHERE token_hash = $1`,
        [tokenHash]
      );
    } catch (err) {
      console.warn('[CustomerAuth] Could not revoke session:', err.message);
    }
  }

  /**
   * Get OAuth authorization URL (placeholder for Google/Apple)
   * In production: generate proper OAuth state + PKCE, redirect to provider
   */
  getOAuthUrl(provider, redirectAfter = '/') {
    const state = `st_${crypto.randomBytes(16).toString('hex')}`;

    if (provider === 'GOOGLE') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        return { success: false, error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID.' };
      }
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline'
      });
      return { success: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
    }

    if (provider === 'APPLE') {
      const clientId = process.env.APPLE_CLIENT_ID;
      if (!clientId) {
        return { success: false, error: 'Apple Sign In not configured. Set APPLE_CLIENT_ID.' };
      }
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/apple/callback`,
        response_type: 'code',
        scope: 'name email',
        state,
        response_mode: 'form_post'
      });
      return { success: true, url: `https://appleid.apple.com/auth/authorize?${params}` };
    }

    return { success: false, error: `Unknown provider: ${provider}` };
  }
}

module.exports = new CustomerAuthService();
