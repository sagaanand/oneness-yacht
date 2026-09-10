/**
 * ONENESS YACHTS — STRIPE PAYMENT SERVICE
 * Real Stripe integration with graceful fallback for missing keys.
 * Never exposes secret keys. All amounts in AED (Stripe uses fils = AED * 100).
 */

const crypto = require('crypto');

let stripe = null;

function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key.startsWith('sk_test_51...') || key === 'sk_test_...') {
      return null; // Not configured
    }
    try {
      stripe = require('stripe')(key);
    } catch (err) {
      console.error('[StripeService] Failed to initialize Stripe:', err.message);
      return null;
    }
  }
  return stripe;
}

class StripeService {
  /**
   * Create a Stripe PaymentIntent for a booking
   * @param {Object} params
   * @param {number} params.amount - Amount in AED
   * @param {string} params.bookingId
   * @param {string} params.bookingRef
   * @param {string} params.customerName
   * @param {string} params.customerEmail
   * @param {string} params.yachtTitle
   * @param {string} params.idempotencyKey
   * @returns {Promise<Object>} { success, clientSecret?, paymentIntentId?, mode }
   */
  async createPaymentIntent({ amount, bookingId, bookingRef, customerName, customerEmail, yachtTitle, idempotencyKey }) {
    const stripeClient = getStripe();

    if (!stripeClient) {
      // Demo/test mode — simulate a payment intent
      console.warn('[StripeService] STRIPE_SECRET_KEY not configured. Running in demo mode.');
      const mockIntentId = `pi_demo_${crypto.randomBytes(12).toString('hex')}`;
      return {
        success: true,
        mode: 'DEMO',
        paymentIntentId: mockIntentId,
        clientSecret: `${mockIntentId}_secret_demo`,
        amount,
        currency: 'AED',
        message: 'Demo mode: Stripe not configured. Set STRIPE_SECRET_KEY for real payments.'
      };
    }

    try {
      // Stripe amounts are in smallest currency unit
      // AED uses fils (1 AED = 100 fils)
      const amountInFils = Math.round(amount * 100);

      const intent = await stripeClient.paymentIntents.create(
        {
          amount: amountInFils,
          currency: 'aed',
          description: `Oneness Yachts — ${yachtTitle} Charter (${bookingRef})`,
          metadata: {
            booking_id: bookingId,
            booking_ref: bookingRef,
            yacht: yachtTitle,
            customer_name: customerName || 'Guest'
          },
          receipt_email: customerEmail || undefined,
          automatic_payment_methods: { enabled: true }
        },
        {
          idempotencyKey: `pi_${idempotencyKey}`
        }
      );

      return {
        success: true,
        mode: 'LIVE',
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amount,
        currency: 'AED'
      };
    } catch (err) {
      console.error('[StripeService] PaymentIntent creation failed:', err.message);
      return {
        success: false,
        error: err.message,
        stripeCode: err.code
      };
    }
  }

  /**
   * Verify and parse Stripe webhook event
   * @param {Buffer} rawBody - Raw request body (must NOT be parsed)
   * @param {string} signature - stripe-signature header
   * @returns {Object|null} Parsed Stripe event or null
   */
  verifyWebhookSignature(rawBody, signature) {
    const stripeClient = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeClient || !secret || secret === 'whsec_...' || secret.includes('...')) {
      // Demo mode — parse body as JSON and return as-is
      try {
        const event = JSON.parse(rawBody.toString());
        event._demoMode = true;
        return event;
      } catch {
        return null;
      }
    }

    try {
      return stripeClient.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      console.error('[StripeService] Webhook signature verification failed:', err.message);
      return null;
    }
  }

  /**
   * Retrieve a PaymentIntent from Stripe
   */
  async getPaymentIntent(paymentIntentId) {
    const stripeClient = getStripe();
    if (!stripeClient || paymentIntentId.startsWith('pi_demo_')) {
      return { id: paymentIntentId, status: 'succeeded', amount_received: 0 };
    }
    try {
      return await stripeClient.paymentIntents.retrieve(paymentIntentId);
    } catch (err) {
      console.error('[StripeService] Failed to retrieve PaymentIntent:', err.message);
      return null;
    }
  }

  /**
   * Check if Stripe is configured
   */
  isConfigured() {
    return Boolean(getStripe());
  }
}

module.exports = new StripeService();
