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

// Authoritative Pricing Quote
router.post('/pricing/quote', async (req, res) => {
  try {
    const { yachtId, startTime, endTime, durationHours, guests, addonCodes } = req.body;
    if (!yachtId || !startTime) {
      return res.status(400).json({ success: false, error: 'yachtId and startTime are required.' });
    }

    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1 OR slug = $1', [yachtId]);
    if (!yachtRes.rows.length) return res.status(404).json({ success: false, error: 'Yacht not found.' });

    const yacht = yachtRes.rows[0];
    const duration = parseFloat(durationHours) || 2;
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + duration * 3600000);

    const pricing = await pricingEngine.calculatePrice({
      yacht,
      startTime: start,
      endTime: end,
      durationHours: duration,
      guestCount: guests || 1,
      selectedAddonCodes: addonCodes || []
    });

    res.json({ success: true, pricing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
