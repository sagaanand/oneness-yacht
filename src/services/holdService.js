const crypto = require('crypto');
const db = require('../db/connection');
const availabilityEngine = require('./availabilityEngine');
const pricingEngine = require('./pricingEngine');

class HoldService {
  /**
   * Create Server-Authoritative 15-Minute Hold with Yacht-Level Locking
   * @param {Object} params
   * @param {string} params.yachtId
   * @param {string|Date} params.startTime
   * @param {string|Date} params.endTime
   * @param {number} params.guests
   * @param {Array<string>} [params.selectedAddonCodes]
   * @returns {Promise<Object>} hold result
   */
  async createHold({ yachtId, startTime, endTime, guests, selectedAddonCodes = [] }) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Mandatory Yacht Row Lock: Serializes concurrent reservation requests on this vessel
      const lockRes = await client.query('SELECT id FROM yachts WHERE id = $1 FOR UPDATE', [yachtId]);
      if (!lockRes.rows || lockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Yacht not found.' };
      }

      // 2. Check Unified Availability Invariant under lock
      const avail = await availabilityEngine.isAvailable({
        yachtId,
        startTime,
        endTime,
        guests,
        txClient: client
      });

      if (!avail.available) {
        await client.query('ROLLBACK');
        return { success: false, error: avail.reason, conflict: avail.conflict };
      }

      const { yacht, interval } = avail;

      // 3. Authoritative Server Pricing Calculation
      const pricing = await pricingEngine.calculatePrice({
        yacht,
        startTime: new Date(interval.startTime),
        endTime: new Date(interval.endTime),
        durationHours: interval.durationHours,
        guestCount: guests,
        selectedAddonCodes
      });

      // 4. Generate 15-Minute Hold Token & Expiration
      const holdId = crypto.randomUUID();
      const holdToken = `hld_${crypto.randomBytes(16).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // 5. Insert Hold into Database
      await client.query(
        `INSERT INTO holds (
          id, hold_token, yacht_id, start_time, end_time, buffer_before_mins, buffer_after_mins,
          effective_start, effective_end, guest_count, subtotal, addons_total, vat_amount,
          total_price, pricing_breakdown_json, selected_addons_json, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          holdId,
          holdToken,
          yacht.id,
          interval.startTime,
          interval.endTime,
          interval.bufferBeforeMins,
          interval.bufferAfterMins,
          interval.effectiveStart,
          interval.effectiveEnd,
          guests,
          pricing.subtotal,
          pricing.addonsTotal,
          pricing.vatAmount,
          pricing.grandTotal,
          JSON.stringify(pricing),
          JSON.stringify(pricing.addonLineItems),
          'ACTIVE',
          expiresAt
        ]
      );

      // 6. Audit Trail
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, changes_json)
         VALUES ($1, $2, $3, $4, $5)`,
        ['HOLD', holdToken, 'HOLD_CREATED', 'CUSTOMER', JSON.stringify({ yacht: yacht.title, pricing: pricing.grandTotal, expiresAt })]
      );

      await client.query('COMMIT');

      return {
        success: true,
        holdToken,
        holdId,
        expiresAt,
        remainingSeconds: 900,
        yacht: {
          id: yacht.id,
          title: yacht.title,
          slug: yacht.slug,
          lengthFt: yacht.length_ft,
          capacity: yacht.capacity_day,
          berth: yacht.default_berth
        },
        interval,
        pricing
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[HoldService] Error creating hold:', err);
      return { success: false, error: 'Internal server error while reserving yacht hold.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Retrieve active hold details and remaining seconds
   */
  async getHold(holdToken) {
    const res = await db.query('SELECT * FROM holds WHERE hold_token = $1', [holdToken]);
    const hold = res.rows[0];

    if (!hold) {
      return { valid: false, error: 'Hold not found or invalid token.' };
    }

    const now = new Date();
    const expiry = new Date(hold.expires_at);

    if (hold.status !== 'ACTIVE' || expiry <= now) {
      if (hold.status === 'ACTIVE') {
        await db.query('UPDATE holds SET status = $1 WHERE hold_token = $2', ['EXPIRED', holdToken]);
      }
      return { valid: false, error: 'Hold has expired. Please select a charter slot again.', status: 'EXPIRED' };
    }

    const remainingSeconds = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 1000));
    const yachtRes = await db.query('SELECT * FROM yachts WHERE id = $1', [hold.yacht_id]);
    const yacht = yachtRes.rows[0];

    return {
      valid: true,
      holdToken: hold.hold_token,
      holdId: hold.id,
      yacht,
      startTime: hold.start_time,
      endTime: hold.end_time,
      guestCount: hold.guest_count,
      pricing: hold.pricing_breakdown_json,
      selectedAddons: hold.selected_addons_json,
      expiresAt: hold.expires_at,
      remainingSeconds
    };
  }

  /**
   * Manually release hold to free interval immediately
   */
  async releaseHold(holdToken) {
    const res = await db.query('UPDATE holds SET status = $1 WHERE hold_token = $2', ['RELEASED', holdToken]);
    return { success: res.rows.length > 0 };
  }

  /**
   * Bulk sweep and mark expired holds
   */
  async sweepExpiredHolds() {
    const now = new Date().toISOString();
    const res = await db.query(
      `UPDATE holds SET status = $1 WHERE status = 'ACTIVE' AND expires_at <= $2`,
      ['EXPIRED', now]
    );
    return { sweptCount: res.rows.length };
  }
}

module.exports = new HoldService();
