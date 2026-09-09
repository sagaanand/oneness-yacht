const db = require('../db/connection');

class BookingEventService {
  /**
   * Log operational milestone event to the booking timeline
   * @param {Object} params
   * @param {string} params.bookingId
   * @param {string} params.eventType - e.g. 'BOOKING_CREATED', 'PAYMENT_CONFIRMED', 'CREW_MARKED_READY'
   * @param {string} params.actorType - 'CUSTOMER', 'STAFF', 'CREW', 'GATEWAY', 'SYSTEM'
   * @param {string} [params.actorId]
   * @param {Object} [params.metadata]
   * @param {Object} [params.txClient]
   */
  async logEvent({ bookingId, eventType, actorType = 'SYSTEM', actorId = null, metadata = {}, txClient = null }) {
    const executor = txClient || db;
    try {
      const res = await executor.query(
        `INSERT INTO booking_events (booking_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [bookingId, eventType, actorType, actorId, JSON.stringify(metadata)]
      );
      return res.rows[0];
    } catch (err) {
      console.error('[BookingEventService] Failed to log event:', err);
      return null;
    }
  }

  /**
   * Fetch full operational timeline for a charter
   */
  async getTimeline(bookingId) {
    const res = await db.query(
      `SELECT * FROM booking_events WHERE booking_id = $1 ORDER BY created_at ASC`,
      [bookingId]
    );
    return res.rows;
  }
}

module.exports = new BookingEventService();
