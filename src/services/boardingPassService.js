const db = require('../db/connection');
const bookingEventService = require('./bookingEventService');

class BoardingPassService {
  /**
   * Customer Digital Boarding Pass Details (Frictionless access via bookingAccessToken)
   */
  async getBoardingPass(bookingAccessToken) {
    const bRes = await db.query('SELECT * FROM bookings WHERE booking_access_token = $1', [bookingAccessToken]);
    if (!bRes.rows || bRes.rows.length === 0) {
      return { success: false, error: 'Boarding pass not found or invalid token.' };
    }

    const booking = bRes.rows[0];
    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1', [booking.yacht_id]);
    const yacht = yachtRes.rows[0];
    const customerRes = await db.query('SELECT * FROM customers WHERE id = $1', [booking.customer_id]);
    const customer = customerRes.rows[0] || { full_name: 'Distinguished Guest', email: '', phone: '' };

    const captainRes = booking.assigned_captain_id
      ? await db.query('SELECT * FROM staff_users WHERE id = $1', [booking.assigned_captain_id])
      : { rows: [] };
    const captain = captainRes.rows[0] || {
      full_name: 'Captain Assigned Upon Departure',
      phone: '+971585441134',
      license_number: 'DM-MASTER'
    };

    // Format Times
    const startDate = new Date(booking.start_time);
    const endDate = new Date(booking.end_time);

    const checkinUrl = `/checkin/${booking.checkin_qr_token}`;

    return {
      success: true,
      bookingRef: booking.booking_ref,
      bookingStatus: booking.booking_status,
      paymentStatus: booking.payment_status,
      yacht: {
        title: yacht.title,
        lengthFt: yacht.length_ft,
        capacity: yacht.capacity_day,
        defaultBerth: yacht.default_berth,
        image: yacht.images_json && yacht.images_json[0] ? yacht.images_json[0] : '/assets/images/home/01.jpg'
      },
      charterTime: {
        date: startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        departureTime: startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        arrivalTime: endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        rawStart: booking.start_time,
        rawEnd: booking.end_time
      },
      marina: {
        name: booking.departure_marina || 'Dubai Marina Yacht Club',
        berth: booking.berth_number || 'Berth 4',
        directions: 'Dubai Marina Yacht Club, West Bay Promenade. Complimentary valet parking at Marina Clubhouse.'
      },
      guest: {
        name: customer.full_name,
        count: booking.guest_count,
        occasion: booking.occasion || 'Luxury Charter'
      },
      captain: {
        name: captain.full_name,
        phone: captain.phone,
        license: captain.license_number
      },
      checkinQrToken: booking.checkin_qr_token,
      checkinUrl,
      pricing: booking.pricing_snapshot_json,
      checkedInAt: booking.checked_in_at,
      conciergeWhatsApp: 'https://wa.me/971585441134?text=' + encodeURIComponent(`Hello Oneness Concierge! Regarding my charter ${booking.booking_ref} on ${yacht.title}...`)
    };
  }

  /**
   * Sanitized QR Check-in Verifier for Crew & Berth Staff
   * Security Rule: Zero billing, pricing, or sensitive PII exposed.
   */
  async verifyCheckinToken(checkinQrToken) {
    const bRes = await db.query('SELECT * FROM bookings WHERE checkin_qr_token = $1', [checkinQrToken]);
    if (!bRes.rows || bRes.rows.length === 0) {
      return { valid: false, reason: 'Invalid or fraudulent boarding QR token.' };
    }

    const booking = bRes.rows[0];
    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1', [booking.yacht_id]);
    const yacht = yachtRes.rows[0];

    const customerRes = await db.query('SELECT full_name FROM customers WHERE id = $1', [booking.customer_id]);
    const customerName = customerRes.rows[0] ? customerRes.rows[0].full_name : 'Guest';

    const startDate = new Date(booking.start_time);
    const now = new Date();

    const isCancelled = booking.booking_status === 'CANCELLED';
    const isCompleted = booking.booking_status === 'COMPLETED';
    const alreadyCheckedIn = Boolean(booking.checked_in_at);

    return {
      valid: !isCancelled && !isCompleted,
      status: booking.booking_status,
      bookingRef: booking.booking_ref,
      yachtTitle: yacht.title,
      lengthFt: yacht.length_ft,
      departureDate: startDate.toLocaleDateString(),
      departureTime: startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      guestName: customerName,
      guestCount: booking.guest_count,
      berthNumber: booking.berth_number,
      occasion: booking.occasion,
      specialRequests: booking.special_requests,
      alreadyCheckedIn,
      checkedInAt: booking.checked_in_at,
      canBoard: (!isCancelled && !isCompleted && booking.booking_status !== 'DRAFT')
    };
  }

  /**
   * Mark Guest Checked-in / Boarded
   */
  async confirmCheckin(checkinQrToken, crewUser = null) {
    const bRes = await db.query('SELECT * FROM bookings WHERE checkin_qr_token = $1', [checkinQrToken]);
    if (!bRes.rows || bRes.rows.length === 0) return { success: false, error: 'Token not found.' };

    const booking = bRes.rows[0];
    if (booking.checked_in_at) {
      return { success: true, message: 'Guest was already checked in.', checkedInAt: booking.checked_in_at };
    }

    const now = new Date().toISOString();
    await db.query('UPDATE bookings SET checked_in_at = $1 WHERE id = $2', [now, booking.id]);

    await bookingEventService.logEvent({
      bookingId: booking.id,
      eventType: 'GUEST_CHECKED_IN',
      actorType: 'CREW',
      actorId: crewUser ? crewUser.username : 'berth_scanner',
      metadata: { checkinTime: now, berth: booking.berth_number }
    });

    return { success: true, checkedInAt: now };
  }
}

module.exports = new BoardingPassService();
