const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const pricingEngine = require('../services/pricingEngine');
const availabilityEngine = require('../services/availabilityEngine');
const holdService = require('../services/holdService');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const boardingPassService = require('../services/boardingPassService');
const weatherService = require('../services/weatherService');
const stripeService = require('../services/stripeService');
const customerAuthService = require('../services/customerAuthService');
const adminAuthService = require('../services/adminAuthService');
const { setSessionCookie, clearSessionCookie } = require('../middleware/customerAuth');
const { setAdminSessionCookie, clearAdminSessionCookie } = require('../middleware/adminAuth');
const {
  requireStaffAuth,
  holdRateLimiter,
  paymentRateLimiter,
  adminRateLimiter
} = require('../middleware/security');

// Mount RBAC guards for Operations & Crew endpoints
router.use('/admin', requireStaffAuth(['SUPER_ADMIN', 'OPERATIONS', 'CONCIERGE']), adminRateLimiter);
router.use('/crew', requireStaffAuth(['SUPER_ADMIN', 'OPERATIONS', 'CREW']));

// ============================================================================
// 0. CUSTOMER AUTHENTICATION ENDPOINTS
// ============================================================================

// Check current customer session
router.get('/auth/me', async (req, res) => {
  if (req.customer) {
    return res.json({ success: true, customer: req.customer });
  }
  res.json({ success: false, customer: null });
});

// Send OTP (email or phone)
router.post('/auth/send-otp', async (req, res) => {
  const { identifier, identifierType, name } = req.body;
  if (!identifier || !identifierType) {
    return res.status(400).json({ success: false, error: 'identifier and identifierType are required.' });
  }
  const result = await customerAuthService.generateOTP(identifier, identifierType.toUpperCase());
  res.json(result);
});

// Verify OTP and create session
router.post('/auth/verify-otp', async (req, res) => {
  const { identifier, identifierType, code, customerInfo } = req.body;
  if (!identifier || !identifierType || !code) {
    return res.status(400).json({ success: false, error: 'identifier, identifierType, and code are required.' });
  }
  const result = await customerAuthService.verifyOTPAndLogin(
    identifier,
    identifierType.toUpperCase(),
    code,
    customerInfo || {},
    { ipAddress: req.ip, userAgent: req.get('user-agent') }
  );
  if (result.success) {
    setSessionCookie(res, result.sessionToken);
  }
  res.json({ success: result.success, customer: result.customer, error: result.error });
});

// Get OAuth URL (Google/Apple)
router.get('/auth/oauth-url', (req, res) => {
  const { provider, redirectAfter } = req.query;
  if (!provider) return res.status(400).json({ success: false, error: 'provider required.' });
  const result = customerAuthService.getOAuthUrl(provider.toUpperCase(), redirectAfter || '/');
  res.json(result);
});

// Customer logout
router.post('/auth/logout', async (req, res) => {
  const token = req.cookies && req.cookies.ony_session;
  if (token) await customerAuthService.revokeSession(token);
  clearSessionCookie(res);
  res.json({ success: true });
});

// ============================================================================
// 0b. ADMIN AUTHENTICATION ENDPOINTS
// ============================================================================

// Admin login
router.post('/auth/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required.' });
  }
  const result = await adminAuthService.login(username, password, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  });
  if (result.success) {
    setAdminSessionCookie(res, result.sessionToken);
    return res.json({ success: true, user: result.user });
  }
  res.status(401).json({ success: false, error: result.error });
});

// Admin logout
router.post('/auth/admin/logout', async (req, res) => {
  const token = req.cookies && req.cookies.ony_admin_session;
  if (token) await adminAuthService.revokeSession(token);
  clearAdminSessionCookie(res);
  res.json({ success: true });
});

// ============================================================================
// 0c. CUSTOMER PORTAL ENDPOINTS
// ============================================================================

// Get customer's own bookings
router.get('/customer/bookings', async (req, res) => {
  if (!req.customer) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  try {
    const bRes = await db.query(
      `SELECT b.*, y.title AS yacht_title, y.slug AS yacht_slug, y.images_json
       FROM bookings b
       JOIN yachts y ON y.id = b.yacht_id
       WHERE b.customer_id = $1
       ORDER BY b.start_time DESC LIMIT 20`,
      [req.customer.id]
    );
    res.json({ success: true, bookings: bRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 0d. STRIPE PAYMENT INTENT ENDPOINT
// ============================================================================

// Create Stripe PaymentIntent for a booking
router.post('/payments/create-intent', async (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ success: false, error: 'bookingId required.' });

  try {
    const bRes = await db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    const booking = bRes.rows[0];
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });

    const yRes = await db.query('SELECT title FROM yachts WHERE id = $1', [booking.yacht_id]);
    const yacht = yRes.rows[0];

    let customer = { name: 'Guest', email: null };
    if (booking.customer_id) {
      const cRes = await db.query('SELECT full_name, email FROM customers WHERE id = $1', [booking.customer_id]);
      if (cRes.rows[0]) customer = { name: cRes.rows[0].full_name, email: cRes.rows[0].email };
    }

    const amount = parseFloat(booking.total_price);
    const result = await stripeService.createPaymentIntent({
      amount,
      bookingId: booking.id,
      bookingRef: booking.booking_ref,
      customerName: customer.name,
      customerEmail: customer.email,
      yachtTitle: yacht ? yacht.title : 'Luxury Charter',
      idempotencyKey: `bk_${booking.id}`
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stripe webhook (raw body required — must be before express.json)
router.post('/payments/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripeService.verifyWebhookSignature(req.body, sig);

  if (!event) {
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  // Handle key events
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const bookingId = pi.metadata && pi.metadata.booking_id;
    if (bookingId) {
      await paymentService.handleGatewayWebhook({
        paymentIntentId: pi.id,
        status: 'PAID',
        gatewayTransactionId: pi.id,
        gatewayResponseJson: JSON.stringify(pi)
      });
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const bookingId = pi.metadata && pi.metadata.booking_id;
    if (bookingId) {
      await paymentService.handleGatewayWebhook({
        paymentIntentId: pi.id,
        status: 'FAILED',
        failureReason: pi.last_payment_error ? pi.last_payment_error.message : 'Payment failed'
      });
    }
  }

  res.json({ received: true });
});

// ============================================================================
// 0e. EXTENDED ADMIN CRUD ENDPOINTS
// ============================================================================

// Get all bookings (paginated, filterable)
router.get('/admin/bookings/list', async (req, res) => {
  const { page = 1, limit = 20, status, yachtId, from, to, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    let where = [];
    let params = [];
    let pi = 1;
    if (status) { where.push(`b.booking_status = $${pi++}`); params.push(status); }
    if (yachtId) { where.push(`b.yacht_id = $${pi++}`); params.push(yachtId); }
    if (from) { where.push(`b.start_time >= $${pi++}`); params.push(from); }
    if (to) { where.push(`b.start_time <= $${pi++}`); params.push(to); }
    if (search) {
      where.push(`(b.booking_ref ILIKE $${pi} OR c.full_name ILIKE $${pi} OR c.email ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const query = `
      SELECT b.id, b.booking_ref, b.booking_status, b.payment_status, b.start_time, b.end_time,
             b.guest_count, b.total_price, b.created_at,
             y.title AS yacht_title, y.slug AS yacht_slug,
             c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
      FROM bookings b
      LEFT JOIN yachts y ON y.id = b.yacht_id
      LEFT JOIN customers c ON c.id = b.customer_id
      ${whereStr}
      ORDER BY b.start_time DESC
      LIMIT $${pi++} OFFSET $${pi++}
    `;
    params.push(parseInt(limit), offset);
    const result = await db.query(query, params);
    const countResult = await db.query(`SELECT COUNT(*) FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id ${whereStr}`, params.slice(0, -2));
    res.json({ success: true, bookings: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single booking detail
router.get('/admin/bookings/detail/:id', async (req, res) => {
  try {
    const bRes = await db.query(
      `SELECT b.*, y.title AS yacht_title, y.slug, c.full_name, c.email, c.phone,
              s.full_name AS captain_name
       FROM bookings b
       LEFT JOIN yachts y ON y.id = b.yacht_id
       LEFT JOIN customers c ON c.id = b.customer_id
       LEFT JOIN staff_users s ON s.id = b.assigned_captain_id
       WHERE b.id = $1 OR b.booking_ref = $1`, [req.params.id]);
    if (!bRes.rows.length) return res.status(404).json({ success: false, error: 'Booking not found.' });
    const events = await db.query('SELECT * FROM booking_events WHERE booking_id = $1 ORDER BY created_at ASC', [bRes.rows[0].id]);
    const payments = await db.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC', [bRes.rows[0].id]);
    res.json({ success: true, booking: bRes.rows[0], events: events.rows, payments: payments.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create yacht
router.post('/admin/yachts', async (req, res) => {
  const { title, slug, description, short_description, length_ft, capacity_day, cabins, speed_knots, marina,
    default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, booking_mode,
    payment_mode, deposit_pct, default_buffer_before_mins, default_buffer_after_mins,
    images_json, features_json, amenities_json, whats_included_json, specs_json,
    weekend_rate_override, sunset_surcharge_override } = req.body;
  try {
    const id = require('crypto').randomUUID();
    await db.query(
      `INSERT INTO yachts (id, slug, title, description, short_description, length_ft, capacity_day, cabins,
        speed_knots, marina, default_berth, base_hourly_rate, min_charter_hours, max_charter_hours,
        booking_mode, payment_mode, deposit_pct, default_buffer_before_mins, default_buffer_after_mins,
        images_json, features_json, amenities_json, whats_included_json, specs_json,
        weekend_rate_override, sunset_surcharge_override, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,true)`,
      [id, slug, title, description, short_description, parseInt(length_ft), parseInt(capacity_day),
       cabins ? parseInt(cabins) : null, speed_knots ? parseInt(speed_knots) : null,
       marina, default_berth, parseFloat(base_hourly_rate), parseInt(min_charter_hours) || 2, parseInt(max_charter_hours) || 12,
       booking_mode || 'INSTANT_BOOK', payment_mode || 'FULL', parseFloat(deposit_pct) || 30,
       parseInt(default_buffer_before_mins) || 15, parseInt(default_buffer_after_mins) || 30,
       JSON.stringify(images_json || []), JSON.stringify(features_json || []),
       JSON.stringify(amenities_json || []), JSON.stringify(whats_included_json || []),
       JSON.stringify(specs_json || {}),
       weekend_rate_override ? parseFloat(weekend_rate_override) : null,
       sunset_surcharge_override ? parseFloat(sunset_surcharge_override) : null]
    );
    // Add default operating hours
    await db.query(
      `INSERT INTO yacht_operating_hours (yacht_id, day_of_week, open_time, close_time, is_closed)
       SELECT $1, d, '08:00:00', '23:30:00', false FROM generate_series(0,6) d
       ON CONFLICT DO NOTHING`, [id]
    );
    res.json({ success: true, yachtId: id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update yacht
router.put('/admin/yachts/:id', async (req, res) => {
  const fields = ['title','slug','description','short_description','length_ft','capacity_day','cabins','speed_knots',
    'marina','default_berth','base_hourly_rate','min_charter_hours','max_charter_hours','booking_mode',
    'payment_mode','deposit_pct','default_buffer_before_mins','default_buffer_after_mins',
    'images_json','features_json','amenities_json','whats_included_json','specs_json',
    'weekend_rate_override','sunset_surcharge_override','active'];
  const updates = [];
  const vals = [];
  let pi = 1;
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${pi++}`);
      vals.push(req.body[f]);
    }
  });
  if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update.' });
  vals.push(req.params.id);
  try {
    await db.query(`UPDATE yachts SET ${updates.join(', ')} WHERE id = $${pi}`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Deactivate yacht (soft delete)
router.delete('/admin/yachts/:id', async (req, res) => {
  try {
    await db.query('UPDATE yachts SET active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Yacht deactivated.' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get all add-ons including inactive
router.get('/admin/addons/all', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM add_ons ORDER BY sort_order ASC');
    res.json({ success: true, addons: r.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create add-on
router.post('/admin/addons', async (req, res) => {
  const { name, description, price, pricing_type, category, icon, image_url, sort_order } = req.body;
  if (!name || !price) return res.status(400).json({ success: false, error: 'name and price required.' });
  try {
    const id = require('crypto').randomUUID();
    await db.query(
      `INSERT INTO add_ons (id, name, description, price, pricing_type, category, icon, image_url, sort_order, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [id, name, description, parseFloat(price), pricing_type || 'FIXED', category, icon, image_url, parseInt(sort_order) || 99]
    );
    res.json({ success: true, addonId: id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Update add-on
router.put('/admin/addons/:id', async (req, res) => {
  const { name, description, price, pricing_type, category, icon, image_url, sort_order, active } = req.body;
  try {
    await db.query(
      `UPDATE add_ons SET name=$1, description=$2, price=$3, pricing_type=$4, category=$5, icon=$6, image_url=$7, sort_order=$8, active=$9 WHERE id=$10`,
      [name, description, parseFloat(price), pricing_type, category, icon, image_url, parseInt(sort_order), active !== false, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create maintenance block
router.post('/admin/maintenance', async (req, res) => {
  const { yachtId, startTime, endTime, reason, blockedBy } = req.body;
  if (!yachtId || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: 'yachtId, startTime, endTime required.' });
  }
  try {
    const id = require('crypto').randomUUID();
    await db.query(
      `INSERT INTO maintenance_blocks (id, yacht_id, start_time, end_time, reason, blocked_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, yachtId, startTime, endTime, reason || 'Maintenance', blockedBy || 'Admin']
    );
    res.json({ success: true, blockId: id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Update yacht operating hours
router.put('/admin/yachts/:id/hours', async (req, res) => {
  const { hours } = req.body; // array of { day_of_week, open_time, close_time, is_closed }
  if (!Array.isArray(hours)) return res.status(400).json({ success: false, error: 'hours array required.' });
  try {
    for (const h of hours) {
      await db.query(
        `INSERT INTO yacht_operating_hours (yacht_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (yacht_id, day_of_week) DO UPDATE SET open_time=$3, close_time=$4, is_closed=$5`,
        [req.params.id, h.day_of_week, h.open_time, h.close_time, h.is_closed || false]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get customers list
router.get('/admin/customers', async (req, res) => {
  try {
    const r = await db.query('SELECT id, full_name, email, phone, vip_tier, created_at FROM customers ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, customers: r.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Admin: get all maintenance blocks for a yacht or date range
router.get('/admin/maintenance', async (req, res) => {
  const { yachtId, from, to } = req.query;
  try {
    let q = 'SELECT m.*, y.title FROM maintenance_blocks m JOIN yachts y ON y.id = m.yacht_id WHERE 1=1';
    const params = [];
    let pi = 1;
    if (yachtId) { q += ` AND m.yacht_id = $${pi++}`; params.push(yachtId); }
    if (from) { q += ` AND m.start_time >= $${pi++}`; params.push(from); }
    if (to) { q += ` AND m.end_time <= $${pi++}`; params.push(to); }
    q += ' ORDER BY m.start_time ASC';
    const r = await db.query(q, params);
    res.json({ success: true, blocks: r.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Delete maintenance block
router.delete('/admin/maintenance/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM maintenance_blocks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});



// ============================================================================
// 1. FLEET & CATALOGUE
// ============================================================================

// List all active yachts
router.get('/yachts', async (req, res) => {
  try {
    const yachtsRes = await db.query('SELECT * FROM yachts WHERE active = true ORDER BY length_ft ASC');
    res.json({ success: true, count: yachtsRes.rows.length, yachts: yachtsRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get yacht details by slug or ID
router.get('/yachts/:identifier', async (req, res) => {
  try {
    const id = req.params.identifier.toLowerCase();
    const yachtsRes = await db.query('SELECT * FROM yachts WHERE slug = $1 OR id = $1', [id]);
    if (!yachtsRes.rows.length) return res.status(404).json({ success: false, error: 'Yacht not found.' });
    res.json({ success: true, yacht: yachtsRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic Add-ons catalogue
router.get('/addons', async (req, res) => {
  try {
    const addonsRes = await db.query('SELECT * FROM add_ons WHERE active = true ORDER BY sort_order ASC');
    res.json({ success: true, addons: addonsRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancellation policies
router.get('/cancellation-policies', async (req, res) => {
  try {
    const polRes = await db.query('SELECT * FROM cancellation_policies ORDER BY hours_before_departure DESC');
    res.json({ success: true, policies: polRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 2. AVAILABILITY, PRICING & WEATHER
// ============================================================================

// Marine Weather Advisory Preview (Advisory Only)
router.get('/weather/marine', async (req, res) => {
  try {
    const weather = await weatherService.getMarineConditions();
    res.json({ success: true, weather });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Unified Availability Invariant Check
router.get('/availability/check', async (req, res) => {
  try {
    const { yachtId, startTime, endTime, guests } = req.query;
    if (!yachtId || !startTime || !endTime) {
      return res.status(400).json({ success: false, error: 'yachtId, startTime, and endTime query parameters are required.' });
    }

    const avail = await availabilityEngine.isAvailable({
      yachtId,
      startTime,
      endTime,
      guests: guests ? parseInt(guests, 10) : 1
    });

    res.json({ success: true, ...avail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Authoritative Pricing Quote (Supports both POST body and GET query)
const handleQuote = async (req, res) => {
  try {
    const data = req.method === 'GET' ? req.query : req.body;
    const { yachtId, yachtSlug, startTime, endTime, durationHours, guests, addonCodes } = data;
    const yId = yachtId || yachtSlug;
    if (!yId || !startTime) {
      return res.status(400).json({ success: false, error: 'yachtId/yachtSlug and startTime are required.' });
    }

    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1 OR slug = $1', [yId]);
    if (!yachtRes.rows.length) return res.status(404).json({ success: false, error: 'Yacht not found.' });

    const yacht = yachtRes.rows[0];
    const duration = parseFloat(durationHours) || 2;
    const start = new Date(startTime.includes('T') ? startTime : `${startTime}T12:00:00Z`);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + duration * 3600000);

    const pricing = await pricingEngine.calculatePrice({
      yacht,
      startTime: start,
      endTime: end,
      durationHours: duration,
      guestCount: guests ? parseInt(guests, 10) : 1,
      selectedAddonCodes: Array.isArray(addonCodes) ? addonCodes : (addonCodes ? [addonCodes] : [])
    });

    res.json({ success: true, pricing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

router.get('/pricing/quote', handleQuote);
router.post('/pricing/quote', handleQuote);

// ============================================================================
// 3. SERVER-AUTHORITATIVE 15-MINUTE HOLD
// ============================================================================

// Create 15-Minute Hold under Yacht Lock
router.post('/holds', holdRateLimiter, async (req, res) => {
  try {
    const { yachtId, startTime, endTime, durationHours, guests, addonCodes } = req.body;
    if (!yachtId || !startTime) {
      return res.status(400).json({ success: false, error: 'yachtId and startTime are required.' });
    }

    // Resolve yacht by ID or slug
    const yachtRes = await db.query('SELECT id FROM yachts WHERE id = $1 OR slug = $1', [yachtId]);
    if (!yachtRes.rows.length) return res.status(404).json({ success: false, error: 'Yacht not found.' });
    const resolvedYachtId = yachtRes.rows[0].id;

    const duration = parseFloat(durationHours) || 2;
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + duration * 3600000);

    const result = await holdService.createHold({
      yachtId: resolvedYachtId,
      startTime: start,
      endTime: end,
      guests: guests || 1,
      selectedAddonCodes: addonCodes || []
    });

    if (!result.success) {
      return res.status(409).json(result);
    }

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Hold Details & Remaining Seconds
router.get('/holds/:holdToken', async (req, res) => {
  try {
    const result = await holdService.getHold(req.params.holdToken);
    if (!result.valid) return res.status(410).json(result);
    res.json({ success: true, hold: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Release Hold Manually
router.delete('/holds/:holdToken', async (req, res) => {
  try {
    const result = await holdService.releaseHold(req.params.holdToken);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 4. BOOKINGS & CHECKOUT
// ============================================================================

// Convert Hold into Booking (PENDING_PAYMENT)
router.post('/bookings', async (req, res) => {
  try {
    const { holdToken, customer, occasion, specialRequests } = req.body;
    if (!holdToken || !customer || !customer.fullName || !customer.phone) {
      return res.status(400).json({ success: false, error: 'holdToken, customer.fullName, and customer.phone are required.' });
    }

    const result = await bookingService.createBookingFromHold({
      holdToken,
      customer,
      occasion,
      specialRequests,
      sourceChannel: 'WEBSITE_ONLINE'
    });

    if (!result.success) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Booking by Reference or Access Token
router.get('/bookings/:identifier', async (req, res) => {
  try {
    const id = req.params.identifier;
    let booking = await bookingService.getBookingByRef(id);
    if (!booking) {
      booking = await bookingService.getBookingByToken(id);
    }
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });

    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Digital Boarding Pass
router.get('/bookings/:token/boarding-pass', async (req, res) => {
  try {
    const pass = await boardingPassService.getBoardingPass(req.params.token);
    if (!pass.success) return res.status(404).json(pass);
    res.json({ success: true, boardingPass: pass });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 5. IDEMPOTENT PAYMENTS
// ============================================================================

// Initiate Payment
router.post('/payments', paymentRateLimiter, async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    const { bookingId, paymentMethod, gateway, amount } = req.body;

    if (!bookingId || !idempotencyKey) {
      return res.status(400).json({ success: false, error: 'bookingId and Idempotency-Key header are required.' });
    }

    const result = await paymentService.initiatePayment({
      bookingId,
      idempotencyKey,
      paymentMethod: paymentMethod || 'CARD_ONLINE',
      gateway: gateway || 'STRIPE',
      amount: amount ? parseFloat(amount) : null,
      simulateFailure: Boolean(req.body.simulateFailure),
      failureReasonText: req.body.failureReasonText
    });

    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Gateway Webhook (Asynchronous confirmation)
router.post('/payments/webhook', async (req, res) => {
  try {
    const { paymentIntentId, transactionId, status } = req.body;
    const result = await paymentService.handleGatewayWebhook({
      paymentIntentId,
      transactionId,
      gatewayStatus: status || 'succeeded',
      rawEvent: req.body
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 6. SANITIZED QR BOARDING CHECK-IN (CREW SCAN)
// ============================================================================

// Verify QR Token (No billing, no PII)
router.get('/checkin/:token', async (req, res) => {
  try {
    const checkinData = await boardingPassService.verifyCheckinToken(req.params.token);
    res.json({ success: true, checkin: checkinData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Confirm Guest Embarkation
router.post('/checkin/:token/confirm', async (req, res) => {
  try {
    const result = await boardingPassService.confirmCheckin(req.params.token);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 7. ADMIN OPERATIONS OS (/api/v1/admin/*)
// ============================================================================

// Today's Operations Manifest & KPIs
router.get('/admin/operations/today', async (req, res) => {
  try {
    const manifest = await bookingService.getTodaysManifest();
    res.json({ success: true, ...manifest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Concierge Manual Booking Creation
router.post('/admin/bookings', async (req, res) => {
  try {
    const { yachtId, startTime, endTime, guests, customer, addonCodes, occasion, specialRequests, sourceChannel } = req.body;
    const result = await bookingService.createConciergeBooking({
      yachtId,
      startTime,
      endTime,
      guests: guests || 1,
      customer,
      selectedAddonCodes: addonCodes || [],
      occasion,
      specialRequests,
      sourceChannel: sourceChannel || 'CONCIERGE_MANUAL',
      staffUser: { username: 'admin', full_name: 'Fleet Concierge' }
    });

    if (!result.success) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reschedule Booking with Yacht Lock & Buffer Check
router.post('/admin/bookings/:id/reschedule', async (req, res) => {
  try {
    const { newStartTime, newEndTime, reason } = req.body;
    if (!newStartTime || !newEndTime) {
      return res.status(400).json({ success: false, error: 'newStartTime and newEndTime are required.' });
    }

    const result = await bookingService.rescheduleBooking({
      bookingId: req.params.id,
      newStartTime,
      newEndTime,
      reason: reason || 'Operations Reschedule',
      staffUser: { username: 'admin' }
    });

    if (!result.success) return res.status(409).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel Booking with Policy-Driven Refund Calculation
router.post('/admin/bookings/:id/cancel', async (req, res) => {
  try {
    const { reason, overrideRefundPct } = req.body;
    const result = await bookingService.cancelBooking({
      bookingId: req.params.id,
      reason: reason || 'Customer Cancellation',
      overrideRefundPct: overrideRefundPct !== undefined ? overrideRefundPct : null,
      staffUser: { username: 'admin' }
    });

    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assign Captain & Crew Roster
router.post('/admin/bookings/:id/crew', async (req, res) => {
  try {
    const { captainId, crewNotes } = req.body;
    if (!captainId) return res.status(400).json({ success: false, error: 'captainId is required.' });

    const result = await bookingService.assignCrew({
      bookingId: req.params.id,
      captainId,
      crewNotes: crewNotes || '',
      staffUser: { username: 'admin' }
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Transition Operational State
router.patch('/admin/bookings/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'status is required.' });

    const result = await bookingService.updateStatus({
      bookingId: req.params.id,
      newStatus: status,
      actorType: 'STAFF',
      actorId: 'admin',
      metadata: { notes }
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify Manual Cash / Wire Payment
router.post('/admin/bookings/:id/verify-cash', async (req, res) => {
  try {
    const { paymentMethod, amount } = req.body;
    const result = await paymentService.verifyManualPayment({
      bookingId: req.params.id,
      paymentMethod: paymentMethod || 'CASH_AT_BERTH',
      amount,
      staffUser: { username: 'admin', full_name: 'Fleet Operations' }
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 8. CREW MOBILE PORTAL (/api/v1/crew/*)
// Zero financial data, only operational details
// ============================================================================

router.get('/crew/manifest', async (req, res) => {
  try {
    const manifest = await bookingService.getTodaysManifest();
    // Sanitize crew manifest: remove revenue, pricing snapshots, customer payment details
    const crewCharters = manifest.todayCharters.map(c => ({
      id: c.id,
      bookingRef: c.booking_ref,
      bookingStatus: c.booking_status,
      yachtTitle: c.yacht.title,
      lengthFt: c.yacht.length_ft,
      berthNumber: c.berth_number,
      departureMarina: c.departure_marina,
      startTime: c.start_time,
      endTime: c.end_time,
      guestCount: c.guest_count,
      occasion: c.occasion,
      specialRequests: c.special_requests,
      captainName: c.captain ? c.captain.full_name : 'Unassigned',
      crewNotes: c.crew_notes,
      checkedInAt: c.checked_in_at
    }));

    res.json({ success: true, count: crewCharters.length, charters: crewCharters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/crew/charter/:id/action', async (req, res) => {
  try {
    const { action } = req.body; // 'MARK_READY', 'MARK_DEPARTED', 'MARK_COMPLETED'
    let targetStatus = 'READY';

    if (action === 'MARK_READY') targetStatus = 'READY';
    else if (action === 'MARK_DEPARTED') targetStatus = 'DEPARTED';
    else if (action === 'MARK_COMPLETED') targetStatus = 'COMPLETED';
    else return res.status(400).json({ success: false, error: 'Invalid crew action.' });

    const result = await bookingService.updateStatus({
      bookingId: req.params.id,
      newStatus: targetStatus,
      actorType: 'CREW',
      actorId: req.body.crewUser || 'captain.ahmed'
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
