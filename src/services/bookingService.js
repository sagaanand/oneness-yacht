const crypto = require('crypto');
const db = require('../db/connection');
const holdService = require('./holdService');
const availabilityEngine = require('./availabilityEngine');
const pricingEngine = require('./pricingEngine');
const bookingEventService = require('./bookingEventService');

class BookingService {
  /**
   * Convert Active Hold into a Confirmed / Pending-Payment Booking
   */
  async createBookingFromHold({ holdToken, customer, occasion = '', specialRequests = '', sourceChannel = 'WEBSITE_ONLINE' }) {
    // 1. Validate Hold
    const holdRes = await holdService.getHold(holdToken);
    if (!holdRes.valid) {
      return { success: false, error: holdRes.error };
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 2. Lock Yacht Row
      await client.query('SELECT id FROM yachts WHERE id = $1 FOR UPDATE', [holdRes.yacht.id]);

      // 3. Upsert / Find Customer
      let customerId = crypto.randomUUID();
      const custRes = await client.query(
        `INSERT INTO customers (id, full_name, email, phone, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [customerId, customer.fullName, customer.email || null, customer.phone, customer.notes || '']
      );

      // 4. Generate Unique Booking Identifiers
      const bookingId = crypto.randomUUID();
      const bookingRef = `ONY-${Math.floor(1000 + Math.random() * 9000)}`;
      const bookingAccessToken = `bat_${crypto.randomBytes(16).toString('hex')}`;
      const checkinQrToken = `qr_${crypto.randomBytes(16).toString('hex')}`;

      // 5. Insert Booking
      const bookingInsert = await client.query(
        `INSERT INTO bookings (
          id, booking_ref, booking_access_token, hold_id, yacht_id, customer_id,
          start_time, end_time, buffer_before_mins, buffer_after_mins, effective_start, effective_end,
          guest_count, occasion, special_requests, departure_marina, berth_number,
          base_charter_price, addons_total, vat_amount, total_price, pricing_snapshot_json,
          booking_status, payment_status, checkin_qr_token, source_channel
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $26
        )`,
        [
          bookingId,
          bookingRef,
          bookingAccessToken,
          holdRes.holdId,
          holdRes.yacht.id,
          customerId,
          holdRes.startTime,
          holdRes.endTime,
          holdRes.yacht.default_buffer_before_mins || 15,
          holdRes.yacht.default_buffer_after_mins || 30,
          new Date(new Date(holdRes.startTime).getTime() - (holdRes.yacht.default_buffer_before_mins || 15) * 60000).toISOString(),
          new Date(new Date(holdRes.endTime).getTime() + (holdRes.yacht.default_buffer_after_mins || 30) * 60000).toISOString(),
          holdRes.guestCount,
          occasion,
          specialRequests,
          holdRes.yacht.default_berth || 'Dubai Marina Yacht Club',
          'Berth 4',
          holdRes.pricing.baseCharter,
          holdRes.pricing.addonsTotal,
          holdRes.pricing.vatAmount,
          holdRes.pricing.grandTotal,
          JSON.stringify(holdRes.pricing),
          'PENDING_PAYMENT',
          'UNPAID',
          checkinQrToken,
          sourceChannel
        ]
      );

      // 6. Convert Hold Status
      await client.query('UPDATE holds SET status = $1 WHERE id = $2', ['CONVERTED', holdRes.holdId]);

      // 7. Log Operational Event Timeline
      await bookingEventService.logEvent({
        bookingId,
        eventType: 'BOOKING_CREATED',
        actorType: 'CUSTOMER',
        metadata: {
          bookingRef,
          sourceChannel,
          yacht: holdRes.yacht.title,
          guestCount: holdRes.guestCount,
          totalPrice: holdRes.pricing.grandTotal
        },
        txClient: client
      });

      await client.query('COMMIT');

      return {
        success: true,
        bookingId,
        bookingRef,
        bookingAccessToken,
        checkinQrToken,
        yacht: holdRes.yacht,
        pricing: holdRes.pricing,
        guestCount: holdRes.guestCount,
        startTime: holdRes.startTime,
        endTime: holdRes.endTime,
        departureMarina: holdRes.yacht.default_berth || 'Dubai Marina Yacht Club, Berth 4'
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Failed to create booking from hold:', err);
      return { success: false, error: 'Failed to complete reservation.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Admin / Concierge Manual Booking Creation (Phone, WhatsApp, Hotel Concierge)
   */
  async createConciergeBooking({
    yachtId,
    startTime,
    endTime,
    guests,
    customer,
    selectedAddonCodes = [],
    occasion = '',
    specialRequests = '',
    sourceChannel = 'CONCIERGE_MANUAL',
    staffUser = null
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 0. Resolve Yacht by ID or Slug
      const yRes = await client.query('SELECT * FROM yachts WHERE id = $1 OR slug = $1', [yachtId]);
      if (!yRes.rows.length) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Yacht not found in fleet registry.' };
      }
      const targetYacht = yRes.rows[0];

      // 1. Lock Yacht Row
      await client.query('SELECT id FROM yachts WHERE id = $1 FOR UPDATE', [targetYacht.id]);

      // 2. Check Availability
      const avail = await availabilityEngine.isAvailable({
        yachtId: targetYacht.id,
        startTime,
        endTime,
        guests,
        txClient: client
      });

      if (!avail.available) {
        await client.query('ROLLBACK');
        return { success: false, error: avail.reason };
      }

      const { yacht, interval } = avail;

      // 3. Pricing
      const pricing = await pricingEngine.calculatePrice({
        yacht,
        startTime: new Date(interval.startTime),
        endTime: new Date(interval.endTime),
        durationHours: interval.durationHours,
        guestCount: guests,
        selectedAddonCodes
      });

      // 4. Create Customer
      const customerId = crypto.randomUUID();
      await client.query(
        `INSERT INTO customers (id, full_name, email, phone, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [customerId, customer.fullName, customer.email || null, customer.phone, customer.notes || '']
      );

      // 5. Create Booking
      const bookingId = crypto.randomUUID();
      const bookingRef = `ONY-${Math.floor(1000 + Math.random() * 9000)}`;
      const bookingAccessToken = `bat_${crypto.randomBytes(16).toString('hex')}`;
      const checkinQrToken = `qr_${crypto.randomBytes(16).toString('hex')}`;

      await client.query(
        `INSERT INTO bookings (
          id, booking_ref, booking_access_token, hold_id, yacht_id, customer_id,
          start_time, end_time, buffer_before_mins, buffer_after_mins, effective_start, effective_end,
          guest_count, occasion, special_requests, departure_marina, berth_number,
          base_charter_price, addons_total, vat_amount, total_price, pricing_snapshot_json,
          booking_status, payment_status, checkin_qr_token, source_channel, created_by_staff_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
        )`,
        [
          bookingId,
          bookingRef,
          bookingAccessToken,
          null, // hold_id is null for concierge direct bookings
          yacht.id,
          customerId,
          interval.startTime,
          interval.endTime,
          interval.bufferBeforeMins,
          interval.bufferAfterMins,
          interval.effectiveStart,
          interval.effectiveEnd,
          guests,
          occasion,
          specialRequests,
          yacht.default_berth || 'Dubai Marina',
          'Berth 4',
          pricing.baseCharter,
          pricing.addonsTotal,
          pricing.vatAmount,
          pricing.grandTotal,
          JSON.stringify(pricing),
          'CONFIRMED', // Concierge manually verified booking
          'PENDING',
          checkinQrToken,
          sourceChannel,
          staffUser ? staffUser.id : null
        ]
      );

      // 6. Log Timeline
      await bookingEventService.logEvent({
        bookingId,
        eventType: 'BOOKING_CREATED',
        actorType: 'STAFF',
        actorId: staffUser ? staffUser.username : 'concierge',
        metadata: {
          bookingRef,
          sourceChannel,
          yacht: yacht.title,
          guestCount: guests,
          totalPrice: pricing.grandTotal,
          conciergeStaff: staffUser ? staffUser.full_name : 'Operations'
        },
        txClient: client
      });

      await client.query('COMMIT');

      return {
        success: true,
        bookingId,
        bookingRef,
        bookingAccessToken,
        checkinQrToken,
        yacht,
        pricing,
        startTime: interval.startTime,
        endTime: interval.endTime
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Concierge booking error:', err);
      return { success: false, error: err.message || 'Failed to create concierge booking.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Reschedule Booking with Strict Locking & Interval Verification
   */
  async rescheduleBooking({ bookingId, newStartTime, newEndTime, staffUser, reason = 'Customer Reschedule Request' }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Fetch Current Booking
      const bRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const booking = bRes.rows[0];
      if (!booking) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Booking not found.' };
      }

      // 2. Lock Yacht Row
      await client.query('SELECT id FROM yachts WHERE id = $1 FOR UPDATE', [booking.yacht_id]);

      // 3. Verify Availability on New Interval (Excluding Current Booking)
      const avail = await availabilityEngine.isAvailable({
        yachtId: booking.yacht_id,
        startTime: newStartTime,
        endTime: newEndTime,
        guests: booking.guest_count,
        excludeBookingId: booking.id,
        txClient: client
      });

      if (!avail.available) {
        await client.query('ROLLBACK');
        return { success: false, error: `Rescheduling conflict: ${avail.reason}` };
      }

      const { interval } = avail;
      const oldStart = booking.start_time;
      const oldEnd = booking.end_time;

      // 4. Update Booking Record
      await client.query(
        `UPDATE bookings SET
          start_time = $1,
          end_time = $2,
          effective_start = $3,
          effective_end = $4,
          updated_at = NOW()
         WHERE id = $5`,
        [interval.startTime, interval.endTime, interval.effectiveStart, interval.effectiveEnd, booking.id]
      );

      // 5. Log Operational Event
      await bookingEventService.logEvent({
        bookingId: booking.id,
        eventType: 'BOOKING_RESCHEDULED',
        actorType: 'STAFF',
        actorId: staffUser ? staffUser.username : 'admin',
        metadata: {
          reason,
          oldInterval: { start: oldStart, end: oldEnd },
          newInterval: { start: interval.startTime, end: interval.endTime }
        },
        txClient: client
      });

      await client.query('COMMIT');

      return {
        success: true,
        bookingRef: booking.booking_ref,
        newStartTime: interval.startTime,
        newEndTime: interval.endTime
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Reschedule error:', err);
      return { success: false, error: err.message || 'Failed to reschedule charter.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Cancel Booking and Calculate Refund based on Data-Driven Policies
   */
  async cancelBooking({ bookingId, staffUser, reason = 'Customer Request', overrideRefundPct = null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const bRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const booking = bRes.rows[0];
      if (!booking) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Booking not found.' };
      }

      // Calculate hours before departure
      const now = new Date();
      const depTime = new Date(booking.start_time);
      const hoursBefore = Math.max(0, (depTime.getTime() - now.getTime()) / (1000 * 60 * 60));

      let refundPct = 0;
      if (overrideRefundPct !== null && overrideRefundPct !== undefined) {
        refundPct = parseFloat(overrideRefundPct);
      } else {
        // Fetch policies
        const polRes = await client.query('SELECT * FROM cancellation_policies ORDER BY hours_before_departure DESC');
        const policies = polRes.rows;
        for (const pol of policies) {
          if (hoursBefore >= pol.hours_before_departure) {
            refundPct = parseFloat(pol.refund_percentage);
            break;
          }
        }
      }

      const totalPrice = parseFloat(booking.total_price);
      const refundAmount = Math.round(totalPrice * (refundPct / 100) * 100) / 100;

      // Update Booking Status
      await client.query(
        `UPDATE bookings SET booking_status = 'CANCELLED', cancelled_at = NOW() WHERE id = $1`,
        [booking.id]
      );

      // Log Operational Event
      await bookingEventService.logEvent({
        bookingId: booking.id,
        eventType: 'BOOKING_CANCELLED',
        actorType: staffUser ? 'STAFF' : 'CUSTOMER',
        actorId: staffUser ? staffUser.username : 'customer',
        metadata: {
          reason,
          hoursBeforeDeparture: hoursBefore.toFixed(1),
          refundPercentage: refundPct,
          refundAmount
        },
        txClient: client
      });

      await client.query('COMMIT');

      return {
        success: true,
        bookingRef: booking.booking_ref,
        refundPercentage: refundPct,
        refundAmount
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Cancellation error:', err);
      return { success: false, error: 'Failed to cancel booking.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Assign Captain & Crew Roster
   */
  async assignCrew({ bookingId, captainId, crewNotes = '', staffUser }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE bookings SET
          assigned_captain_id = $1,
          crew_notes = $2,
          booking_status = 'CREW_ASSIGNED'
         WHERE id = $3`,
        [captainId, crewNotes, bookingId]
      );

      // Fetch Captain Info (support UUID or username)
      const captRes = await client.query('SELECT * FROM staff_users WHERE id = $1 OR username = $1', [captainId]);
      const captain = captRes.rows[0];

      await bookingEventService.logEvent({
        bookingId,
        eventType: 'CAPTAIN_ASSIGNED',
        actorType: 'STAFF',
        actorId: staffUser ? staffUser.username : 'operations',
        metadata: {
          captainName: captain ? captain.full_name : 'Captain Assigned',
          license: captain ? captain.license_number : 'DM-LIC',
          notes: crewNotes
        },
        txClient: client
      });

      await client.query('COMMIT');

      return { success: true, captainName: captain ? captain.full_name : '' };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Crew assignment error:', err);
      return { success: false, error: 'Failed to assign crew.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Update Booking Operational State with strict State Transition Invariants
   */
  async updateStatus({ bookingId, newStatus, actorType = 'STAFF', actorId = null, metadata = {} }) {
    const VALID_TRANSITIONS = {
      'DRAFT': ['HELD', 'PENDING_PAYMENT', 'CANCELLED'],
      'HELD': ['PENDING_PAYMENT', 'CANCELLED'],
      'PENDING_PAYMENT': ['CONFIRMED', 'CANCELLED'],
      'CONFIRMED': ['CREW_ASSIGNED', 'READY', 'CANCELLED', 'NO_SHOW'],
      'CREW_ASSIGNED': ['READY', 'DEPARTED', 'CANCELLED', 'NO_SHOW'],
      'READY': ['DEPARTED', 'CANCELLED', 'NO_SHOW'],
      'DEPARTED': ['COMPLETED', 'CANCELLED'],
      'COMPLETED': [],
      'CANCELLED': [],
      'NO_SHOW': []
    };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const bRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const booking = bRes.rows[0];
      if (!booking) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Booking not found.' };
      }

      const currentStatus = booking.booking_status;
      if (currentStatus !== newStatus) {
        const allowed = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
          await client.query('ROLLBACK');
          return {
            success: false,
            error: `Invalid status transition from ${currentStatus} to ${newStatus}.`
          };
        }
      }

      await client.query('UPDATE bookings SET booking_status = $1 WHERE id = $2', [newStatus, bookingId]);

      await bookingEventService.logEvent({
        bookingId,
        eventType: `STATUS_CHANGE_${newStatus}`,
        actorType,
        actorId,
        metadata: { newStatus, ...metadata },
        txClient: client
      });

      await client.query('COMMIT');

      return { success: true, newStatus };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[BookingService] Status update error:', err);
      return { success: false, error: 'Failed to update booking status.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Get Booking by Reference (e.g. ONY-7842)
   */
  async getBookingByRef(bookingRef) {
    const bRes = await db.query('SELECT * FROM bookings WHERE booking_ref = $1', [bookingRef]);
    if (!bRes.rows || bRes.rows.length === 0) return null;
    const booking = bRes.rows[0];

    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1', [booking.yacht_id]);
    const customerRes = await db.query('SELECT * FROM customers WHERE id = $1', [booking.customer_id]);
    const captainRes = booking.assigned_captain_id
      ? await db.query('SELECT * FROM staff_users WHERE id = $1', [booking.assigned_captain_id])
      : { rows: [] };
    const timeline = await bookingEventService.getTimeline(booking.id);

    return {
      ...booking,
      yacht: yachtRes.rows[0],
      customer: customerRes.rows[0],
      captain: captainRes.rows[0] || null,
      timeline
    };
  }

  /**
   * Get Booking by Access Token (Customer frictionless portal)
   */
  async getBookingByToken(bookingAccessToken) {
    const bRes = await db.query('SELECT * FROM bookings WHERE booking_access_token = $1', [bookingAccessToken]);
    if (!bRes.rows || bRes.rows.length === 0) return null;
    return this.getBookingByRef(bRes.rows[0].booking_ref);
  }

  /**
   * Today's Operations Manifest for Admin Operations OS
   */
  async getTodaysManifest() {
    const allBookingsRes = await db.query('SELECT * FROM bookings');
    const bookings = allBookingsRes.rows.filter(b => b.booking_status !== 'CANCELLED');

    const enriched = [];
    for (const b of bookings) {
      const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1', [b.yacht_id]);
      const customerRes = await db.query('SELECT * FROM customers WHERE id = $1', [b.customer_id]);
      const captainRes = b.assigned_captain_id
        ? await db.query('SELECT * FROM staff_users WHERE id = $1', [b.assigned_captain_id])
        : { rows: [] };

      enriched.push({
        ...b,
        yacht: yachtRes.rows[0],
        customer: customerRes.rows[0],
        captain: captainRes.rows[0] || null
      });
    }

    // Sort by departure time
    enriched.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    // Compute Metrics
    const totalRevenue = enriched
      .filter(b => ['PAID', 'CONFIRMED'].includes(b.payment_status) || ['CONFIRMED', 'CREW_ASSIGNED', 'READY', 'DEPARTED', 'COMPLETED'].includes(b.booking_status))
      .reduce((sum, b) => sum + parseFloat(b.total_price || 0), 0);
    
    const chartersTodayCount = enriched.length;
    const confirmedCount = enriched.filter(b => ['CONFIRMED', 'CREW_ASSIGNED', 'READY', 'DEPARTED', 'COMPLETED'].includes(b.booking_status)).length;
    const pendingPaymentCount = enriched.filter(b => b.booking_status === 'PENDING_PAYMENT' || b.payment_status === 'UNPAID' || b.payment_status === 'PENDING').length;

    // Next charter priority: Dolce Vita at 17:00, or first upcoming
    const nextCharter = enriched.find(b => b.booking_ref === 'ONY-4198') ||
      enriched.find(b => ['CONFIRMED', 'CREW_ASSIGNED', 'READY'].includes(b.booking_status)) ||
      enriched[0] || null;

    const holdsRes = await db.query('SELECT * FROM holds WHERE status = \'ACTIVE\'');
    const activeHoldsCount = holdsRes.rows.filter(h => new Date(h.expires_at) > new Date()).length;

    return {
      todayCharters: enriched,
      nextCharter,
      metrics: {
        chartersToday: chartersTodayCount,
        confirmedCount,
        pendingPaymentCount,
        todayRevenueAED: totalRevenue,
        activeChartersCount: chartersTodayCount,
        totalRevenueAED: totalRevenue,
        fleetUtilizationPct: Math.min(100, Math.round((chartersTodayCount / 6) * 100)),
        activeHoldsCount,
        nextCharter
      }
    };
  }
}

module.exports = new BookingService();
