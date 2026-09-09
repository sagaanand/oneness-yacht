const db = require('../db/connection');

class AvailabilityEngine {
  /**
   * Unified Availability Invariant Verification
   * @param {Object} params
   * @param {string} params.yachtId
   * @param {Date|string} params.startTime
   * @param {Date|string} params.endTime
   * @param {number} [params.guests]
   * @param {string} [params.excludeHoldId]
   * @param {string} [params.excludeBookingId]
   * @param {object} [params.txClient] - Optional active transaction client
   * @returns {Promise<Object>} { available: boolean, reason?: string, conflict?: object }
   */
  async isAvailable({
    yachtId,
    startTime,
    endTime,
    guests = 1,
    excludeHoldId = null,
    excludeBookingId = null,
    txClient = null
  }) {
    const executor = txClient || db;
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { available: false, reason: 'Invalid datetime format for start or end time.' };
    }

    if (end <= start) {
      return { available: false, reason: 'Charter end time must be strictly after start time.' };
    }

    // Reject past bookings (with 5-min grace period for clock drift)
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      return { available: false, reason: 'Charter reservations cannot be made for past dates or times.' };
    }

    const guestCount = parseInt(guests, 10);
    if (isNaN(guestCount) || guestCount < 1) {
      return { available: false, reason: 'Guest count must be at least 1 passenger.' };
    }

    // 1. Fetch Yacht Details
    const yachtRes = await executor.query('SELECT * FROM yachts WHERE id = $1', [yachtId]);
    const yacht = yachtRes.rows[0];

    if (!yacht) {
      return { available: false, reason: 'Yacht not found in fleet registry.' };
    }

    if (!yacht.active) {
      return { available: false, reason: `${yacht.title} is currently inactive or off-charter.` };
    }

    // 2. Guest Capacity Verification
    if (guestCount > yacht.capacity_day) {
      return {
        available: false,
        reason: `Requested guest count (${guestCount}) exceeds maximum licensed capacity for ${yacht.title} (${yacht.capacity_day} pax).`
      };
    }

    // 3. Charter Duration Verification
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const minHours = yacht.min_charter_hours || 2;
    const maxHours = yacht.max_charter_hours || 12;

    if (durationHours < minHours) {
      return {
        available: false,
        reason: `Charter duration (${durationHours.toFixed(1)}h) is below the minimum required for ${yacht.title} (${minHours} hours).`
      };
    }

    if (durationHours > maxHours) {
      return {
        available: false,
        reason: `Charter duration (${durationHours.toFixed(1)}h) exceeds the maximum single charter limit (${maxHours} hours).`
      };
    }

    // 4. Operating Window Verification
    const dayOfWeek = start.getDay();
    const opHoursRes = await executor.query('SELECT * FROM yacht_operating_hours WHERE yacht_id = $1', [yacht.id]);
    const daySchedule = opHoursRes.rows.find(oh => oh.day_of_week === dayOfWeek);

    if (daySchedule) {
      if (daySchedule.is_closed) {
        return {
          available: false,
          reason: `${yacht.title} is closed for scheduled maintenance on this day of the week.`
        };
      }

      // Format start and end as "HH:MM:SS"
      const formatTime = (d) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      };

      const reqStartTimeStr = formatTime(start);
      const reqEndTimeStr = formatTime(end);

      // Check window bounds
      if (reqStartTimeStr < daySchedule.open_time || (reqEndTimeStr > daySchedule.close_time && end.getDate() === start.getDate())) {
        return {
          available: false,
          reason: `Requested charter window (${reqStartTimeStr} to ${reqEndTimeStr}) falls outside operating hours (${daySchedule.open_time.slice(0, 5)} - ${daySchedule.close_time.slice(0, 5)}) for ${yacht.title}.`
        };
      }
    }

    // 5. Compute Effective Operational Buffers
    const bufferBeforeMins = yacht.default_buffer_before_mins || 15;
    const bufferAfterMins = yacht.default_buffer_after_mins || 30;

    const effectiveStart = new Date(start.getTime() - bufferBeforeMins * 60 * 1000);
    const effectiveEnd = new Date(end.getTime() + bufferAfterMins * 60 * 1000);

    // Overlap Helper: two intervals [A_start, A_end] and [B_start, B_end] overlap if A_start < B_end and A_end > B_start
    const hasOverlap = (s1, e1, s2, e2) => {
      const aStart = new Date(s1).getTime();
      const aEnd = new Date(e1).getTime();
      const bStart = new Date(s2).getTime();
      const bEnd = new Date(e2).getTime();
      return aStart < bEnd && aEnd > bStart;
    };

    // 6. Check Active Bookings Overlap
    const bookingsRes = await executor.query('SELECT * FROM bookings WHERE yacht_id = $1', [yacht.id]);
    const activeBookings = bookingsRes.rows.filter(b => {
      if (['CANCELLED', 'NO_SHOW'].includes(b.booking_status)) return false;
      if (excludeBookingId && (b.id === excludeBookingId || b.booking_ref === excludeBookingId)) return false;
      return true;
    });

    for (const b of activeBookings) {
      if (hasOverlap(effectiveStart, effectiveEnd, b.effective_start, b.effective_end)) {
        return {
          available: false,
          reason: `Vessel has a confirmed charter (${b.booking_ref}) including operational buffers from ${new Date(b.effective_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to ${new Date(b.effective_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          conflict: {
            type: 'CONFIRMED_BOOKING',
            reference: b.booking_ref,
            effectiveStart: b.effective_start,
            effectiveEnd: b.effective_end
          }
        };
      }
    }

    // 7. Check Active Unexpired Holds Overlap
    const holdsRes = await executor.query('SELECT * FROM holds WHERE yacht_id = $1 AND status = \'ACTIVE\'', [yacht.id]);
    const now = new Date();
    const activeHolds = holdsRes.rows.filter(h => {
      if (h.status !== 'ACTIVE') return false;
      if (new Date(h.expires_at) <= now) return false;
      if (excludeHoldId && (h.id === excludeHoldId || h.hold_token === excludeHoldId)) return false;
      return true;
    });

    for (const h of activeHolds) {
      if (hasOverlap(effectiveStart, effectiveEnd, h.effective_start, h.effective_end)) {
        const remainingMins = Math.ceil((new Date(h.expires_at).getTime() - now.getTime()) / 60000);
        return {
          available: false,
          reason: `Vessel is temporarily on a 15-minute checkout hold by another guest (${remainingMins} min remaining).`,
          conflict: {
            type: 'TEMPORARY_HOLD',
            expiresAt: h.expires_at,
            effectiveStart: h.effective_start,
            effectiveEnd: h.effective_end
          }
        };
      }
    }

    // 8. Check Maintenance Blocks Overlap
    const maintRes = await executor.query('SELECT * FROM maintenance_blocks WHERE yacht_id = $1', [yacht.id]);
    for (const m of maintRes.rows) {
      if (hasOverlap(effectiveStart, effectiveEnd, m.start_time, m.end_time)) {
        return {
          available: false,
          reason: `Vessel is scheduled for maintenance/docking (${m.reason}) from ${new Date(m.start_time).toLocaleTimeString()} to ${new Date(m.end_time).toLocaleTimeString()}.`,
          conflict: {
            type: 'MAINTENANCE_BLOCK',
            reason: m.reason,
            startTime: m.start_time,
            endTime: m.end_time
          }
        };
      }
    }

    // Passed all availability invariant checks
    return {
      available: true,
      yacht,
      interval: {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        effectiveStart: effectiveStart.toISOString(),
        effectiveEnd: effectiveEnd.toISOString(),
        durationHours,
        bufferBeforeMins,
        bufferAfterMins
      }
    };
  }
}

module.exports = new AvailabilityEngine();
