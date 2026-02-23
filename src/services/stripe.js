// ---------------------------------------------------------------------------
// src/services/stripe.js  --  Thin Stripe API client
// ---------------------------------------------------------------------------
// Handles customer creation, checkout sessions, cancellations, and refunds.
// Follows the same pattern as services/ghl.js: try-catch + logging.
// ---------------------------------------------------------------------------

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Initialize Stripe client (resilient when env vars missing)
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function ensureStripe() {
  if (!stripe) {
    throw new Error('Stripe not configured — STRIPE_SECRET_KEY is missing');
  }
}

// ---------------------------------------------------------------------------
// Create customer
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe customer linked to a restaurant.
 *
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {string} name - Customer/restaurant name.
 * @param {string} [email] - Owner email.
 * @param {string} [phone] - Owner phone.
 * @returns {Promise<{ customerId: string }|null>}
 */
export async function createCustomer(restaurantId, name, email, phone) {
  try {
    ensureStripe();

    const customer = await stripe.customers.create({
      name,
      email: email || undefined,
      phone: phone || undefined,
      metadata: {
        restaurant_id: restaurantId,
      },
    });

    console.log(`[stripe] Customer created: ${customer.id} for restaurant ${restaurantId}`);
    return { customerId: customer.id };
  } catch (err) {
    console.error('[stripe] Error creating customer:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create checkout session
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Checkout Session for $99/month subscription.
 * Returns the checkout URL to send to the client via WhatsApp.
 *
 * @param {string} customerId - Stripe customer ID.
 * @param {string} restaurantId - UUID for tracking.
 * @returns {Promise<{ checkoutUrl: string, sessionId: string }|null>}
 */
export async function createCheckoutSession(customerId, restaurantId) {
  try {
    ensureStripe();

    if (!STRIPE_PRICE_MONTHLY) {
      throw new Error('STRIPE_PRICE_MONTHLY not configured');
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_MONTHLY, quantity: 1 }],
      mode: 'subscription',
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel`,
      metadata: {
        restaurant_id: restaurantId,
      },
    });

    console.log(`[stripe] Checkout session created: ${session.id} for customer ${customerId}`);
    return { checkoutUrl: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[stripe] Error creating checkout session:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cancel subscription
// ---------------------------------------------------------------------------

/**
 * Cancels a subscription at the end of the current billing period.
 *
 * @param {string} subscriptionId - Stripe subscription ID.
 * @returns {Promise<boolean>} True if successful.
 */
export async function cancelSubscription(subscriptionId) {
  try {
    ensureStripe();

    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    console.log(`[stripe] Subscription ${subscriptionId} set to cancel at period end`);
    return true;
  } catch (err) {
    console.error('[stripe] Error cancelling subscription:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Create refund (30-day guarantee)
// ---------------------------------------------------------------------------

/**
 * Creates a full refund for a payment intent (30-day guarantee).
 *
 * @param {string} paymentIntentId - Stripe payment intent ID.
 * @returns {Promise<{ refundId: string }|null>}
 */
export async function createRefund(paymentIntentId) {
  try {
    ensureStripe();

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
    });

    console.log(`[stripe] Refund created: ${refund.id} for payment ${paymentIntentId}`);
    return { refundId: refund.id };
  } catch (err) {
    console.error('[stripe] Error creating refund:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Construct webhook event (signature verification)
// ---------------------------------------------------------------------------

/**
 * Verifies and constructs a Stripe webhook event from raw body + signature.
 *
 * @param {Buffer} rawBody - The raw request body.
 * @param {string} signature - The Stripe-Signature header.
 * @returns {{ event: object }|null}
 */
export function constructWebhookEvent(rawBody, signature) {
  try {
    ensureStripe();

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    return { event };
  } catch (err) {
    console.error('[stripe] Webhook verification failed:', err.message);
    return null;
  }
}
