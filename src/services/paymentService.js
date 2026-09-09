const crypto = require('crypto');
const db = require('../db/connection');
const bookingEventService = require('./bookingEventService');

class PaymentService {
  /**
   * Idempotent Payment Initiation
   * @param {Object} params
   * @param {string} params.bookingId
   * @param {string} params.idempotencyKey
   * @param {string} params.paymentMethod - 'CARD_ONLINE', 'APPLE_PAY', 'BANK_TRANSFER', 'CASH_AT_BERTH'
   * @param {string} params.gateway - 'STRIPE', 'TAP', 'MANUAL_CONCIERGE'
   * @param {number} [params.amount]
   */
  async initiatePayment({ bookingId, idempotencyKey, paymentMethod = 'CARD_ONLINE', gateway = 'STRIPE', amount = null, simulateFailure = false, failureReasonText = null }) {
    if (!idempotencyKey) {
      return { success: false, error: 'Idempotency-Key header or property is required for payment operations.' };
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Check Idempotency Cache
      const existingPayRes = await client.query('SELECT * FROM payments WHERE idempotency_key = $1', [idempotencyKey]);
      if (existingPayRes.rows.length > 0) {
        await client.query('COMMIT');
        console.log(`[PaymentService] Idempotent replay detected for key: ${idempotencyKey}`);
        return {
          success: true,
          idempotentReplay: true,
          payment: existingPayRes.rows[0]
        };
      }

      // 2. Fetch Booking
      const bRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const booking = bRes.rows[0];
      if (!booking) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Booking not found.' };
      }

      const chargeAmount = amount !== null ? parseFloat(amount) : parseFloat(booking.total_price);
      const paymentId = crypto.randomUUID();
      const paymentRef = `PAY-${Date.now().toString().slice(-6)}`;
      const paymentIntentId = `pi_${crypto.randomBytes(12).toString('hex')}`;

      // 3. Authorization / Capture evaluation (with failure support)
      const isFailed = Boolean(simulateFailure);
      const isInstantSuccess = !isFailed && (paymentMethod === 'CARD_ONLINE' || paymentMethod === 'APPLE_PAY');
      const paymentStatus = isFailed ? 'FAILED' : (isInstantSuccess ? 'PAID' : 'PENDING');
      const failureMsg = isFailed ? (failureReasonText || 'Card declined: Insufficient funds or card issuer declined.') : null;

      const insertRes = await client.query(
        `INSERT INTO payments (
          id, booking_id, idempotency_key, payment_intent_id, payment_ref,
          payment_method, gateway, amount, currency, status, failure_reason, gateway_transaction_id, gateway_response_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          paymentId,
          booking.id,
          idempotencyKey,
          paymentIntentId,
          paymentRef,
          paymentMethod,
          gateway,
          chargeAmount,
          'AED',
          paymentStatus,
          failureMsg,
          isInstantSuccess ? `txn_${crypto.randomBytes(8).toString('hex')}` : null,
          JSON.stringify({ method: paymentMethod, authorized: isInstantSuccess, failureReason: failureMsg })
        ]
      );

      if (isFailed) {
        await client.query(
          `UPDATE bookings SET payment_status = 'FAILED' WHERE id = $1`,
          [booking.id]
        );
        await bookingEventService.logEvent({
          bookingId: booking.id,
          eventType: 'PAYMENT_FAILED',
          actorType: 'GATEWAY',
          metadata: { paymentRef, failureReason: failureMsg },
          txClient: client
        });
        await client.query('COMMIT');
        return {
          success: false,
          paymentRef,
          status: 'FAILED',
          error: failureMsg
        };
      }

      // 4. Log Operational Timeline
      await bookingEventService.logEvent({
        bookingId: booking.id,
        eventType: isInstantSuccess ? 'PAYMENT_CONFIRMED' : 'PAYMENT_INITIATED',
        actorType: isInstantSuccess ? 'GATEWAY' : 'CUSTOMER',
        metadata: {
          paymentRef,
          paymentMethod,
          amount: chargeAmount,
          currency: 'AED',
          status: paymentStatus
        },
        txClient: client
      });

      // 5. If Paid, transition Booking to CONFIRMED
      if (isInstantSuccess) {
        await client.query(
          `UPDATE bookings SET
            booking_status = 'CONFIRMED',
            payment_status = 'PAID',
            confirmed_at = NOW()
           WHERE id = $1`,
          [booking.id]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        paymentRef,
        paymentIntentId,
        status: paymentStatus,
        amount: chargeAmount,
        currency: 'AED',
        clientSecret: `sec_${paymentIntentId}`
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      // Graceful concurrent idempotency collision handling
      if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
        try {
          const replayRes = await db.query('SELECT * FROM payments WHERE idempotency_key = $1', [idempotencyKey]);
          if (replayRes.rows.length > 0) {
            return {
              success: true,
              idempotentReplay: true,
              payment: replayRes.rows[0]
            };
          }
        } catch (_) {}
      }
      console.error('[PaymentService] Payment initiation error:', err);
      return { success: false, error: err.message || 'Payment initiation failed.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Gateway Webhook Handler (Stripe / Tap)
   */
  async handleGatewayWebhook({ paymentIntentId, transactionId, gatewayStatus = 'succeeded', rawEvent = {} }) {
    const client = await db.getClient();
    try {
      const payRes = await client.query('SELECT * FROM payments WHERE payment_intent_id = $1', [paymentIntentId]);
      const payment = payRes.rows[0];
      if (!payment) return { success: false, error: 'Payment intent not found.' };

      if (gatewayStatus === 'succeeded') {
        await client.query(
          `UPDATE payments SET status = 'PAID', gateway_transaction_id = $1, gateway_response_json = $2 WHERE id = $3`,
          [transactionId, JSON.stringify(rawEvent), payment.id]
        );

        await client.query(
          `UPDATE bookings SET booking_status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = NOW() WHERE id = $1`,
          [payment.booking_id]
        );

        await bookingEventService.logEvent({
          bookingId: payment.booking_id,
          eventType: 'PAYMENT_CONFIRMED',
          actorType: 'GATEWAY',
          metadata: { transactionId, amount: payment.amount },
          txClient: client
        });
      }

      return { success: true };
    } catch (err) {
      console.error('[PaymentService] Webhook error:', err);
      return { success: false, error: 'Webhook processing failed.' };
    } finally {
      await client.release();
    }
  }

  /**
   * Admin / Concierge manual payment verification (Cash at Berth, Bank Wire)
   */
  async verifyManualPayment({ bookingId, staffUser, paymentMethod = 'CASH_AT_BERTH', amount }) {
    const client = await db.getClient();
    try {
      const bRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const booking = bRes.rows[0];
      if (!booking) return { success: false, error: 'Booking not found.' };

      const paymentId = crypto.randomUUID();
      const paymentRef = `CASH-${Date.now().toString().slice(-6)}`;
      const idempotencyKey = `manual_${paymentRef}`;

      await client.query(
        `INSERT INTO payments (
          id, booking_id, idempotency_key, payment_intent_id, payment_ref,
          payment_method, gateway, amount, currency, status, failure_reason, gateway_transaction_id, gateway_response_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          paymentId,
          booking.id,
          idempotencyKey,
          `pi_manual_${paymentRef}`,
          paymentRef,
          paymentMethod,
          'MANUAL_CONCIERGE',
          parseFloat(amount || booking.total_price),
          'AED',
          'PAID',
          null,
          `VERIFIED_BY_${staffUser ? staffUser.username : 'ADMIN'}`,
          JSON.stringify({ verifiedBy: staffUser ? staffUser.full_name : 'Operations' })
        ]
      );

      await client.query(
        `UPDATE bookings SET booking_status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = NOW() WHERE id = $1`,
        [booking.id]
      );

      await bookingEventService.logEvent({
        bookingId: booking.id,
        eventType: 'PAYMENT_CONFIRMED',
        actorType: 'STAFF',
        actorId: staffUser ? staffUser.username : 'admin',
        metadata: { method: paymentMethod, amount: parseFloat(amount || booking.total_price), ref: paymentRef },
        txClient: client
      });

      return { success: true, paymentRef };
    } catch (err) {
      console.error('[PaymentService] Manual verification error:', err);
      return { success: false, error: 'Manual payment verification failed.' };
    } finally {
      await client.release();
    }
  }
}

module.exports = new PaymentService();
