// ---------------------------------------------------------------------------
// src/webhooks/stripe.js  --  Stripe webhook handler
// ---------------------------------------------------------------------------
// Handles subscription lifecycle events from Stripe:
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_succeeded
//   - invoice.payment_failed
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { constructWebhookEvent } from '../services/stripe.js';
import {
  upsertSubscription,
  getSubscriptionByStripeId,
  getSubscriptionByCustomerId,
  updateSubscriptionStatus,
} from '../db/queries/subscriptions.js';
import { updateRestaurantStatus } from '../db/queries/restaurants.js';
import { sendWhatsAppMessage } from '../services/ghl.js';
import { supabase } from '../db/client.js';

export const stripeWebhookRouter = Router();

// ---------------------------------------------------------------------------
// Main webhook endpoint
// ---------------------------------------------------------------------------

stripeWebhookRouter.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    console.error('[webhooks:stripe] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Verify signature and construct event
  const result = constructWebhookEvent(req.body, signature);

  if (!result) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { event } = result;

  // Respond 200 immediately — process async
  res.status(200).json({ received: true });

  // Process event
  try {
    console.log(`[webhooks:stripe] Processing event: ${event.type} (${event.id})`);

    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        console.log(`[webhooks:stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[webhooks:stripe] Error processing ${event.type}:`, err.message);
  }
});

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * customer.subscription.created — New subscription activated.
 */
async function handleSubscriptionCreated(subscription) {
  const restaurantId = subscription.metadata?.restaurant_id;

  if (!restaurantId) {
    console.error('[webhooks:stripe] subscription.created missing restaurant_id in metadata');
    return;
  }

  // Upsert subscription record
  await upsertSubscription({
    restaurant_id: restaurantId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    status: 'active',
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  // Activate restaurant
  await updateRestaurantStatus(restaurantId, 'active');

  // Send WhatsApp confirmation
  const contactId = await resolveContactId(restaurantId);
  if (contactId) {
    await sendWhatsAppMessage(
      contactId,
      'Gracias! Tu suscripcion esta activa. Empezamos a publicar manana. Si tienes problemas en los primeros 30 dias, te devolvemos el dinero.'
    );
  }

  console.log(`[webhooks:stripe] Subscription created for restaurant ${restaurantId}`);
}

/**
 * customer.subscription.updated — Subscription changed (cancel scheduled, plan change, etc.)
 */
async function handleSubscriptionUpdated(subscription) {
  const sub = await getSubscriptionByStripeId(subscription.id);
  if (!sub) {
    console.warn(`[webhooks:stripe] subscription.updated — no local record for ${subscription.id}`);
    return;
  }

  const updates = {
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  };

  // Check if cancellation is scheduled
  if (subscription.cancel_at_period_end) {
    updates.cancel_at = new Date(subscription.current_period_end * 1000).toISOString();

    const contactId = await resolveContactId(sub.restaurant_id);
    if (contactId) {
      const endDate = new Date(subscription.current_period_end * 1000).toLocaleDateString('es-MX');
      await sendWhatsAppMessage(
        contactId,
        `Tu suscripcion terminara el ${endDate}. Si quieres continuar, dinos antes de esa fecha.`
      );
    }
  }

  await updateSubscriptionStatus(sub.id, subscription.status === 'active' ? 'active' : sub.status, updates);
  console.log(`[webhooks:stripe] Subscription updated: ${subscription.id}`);
}

/**
 * customer.subscription.deleted — Subscription canceled/expired.
 */
async function handleSubscriptionDeleted(subscription) {
  const sub = await getSubscriptionByStripeId(subscription.id);
  if (!sub) {
    console.warn(`[webhooks:stripe] subscription.deleted — no local record for ${subscription.id}`);
    return;
  }

  // Update subscription
  await updateSubscriptionStatus(sub.id, 'canceled', {
    canceled_at: new Date().toISOString(),
  });

  // Update restaurant status
  await updateRestaurantStatus(sub.restaurant_id, 'churned');

  // Send exit survey
  const contactId = await resolveContactId(sub.restaurant_id);
  if (contactId) {
    await sendWhatsAppMessage(
      contactId,
      'Sentimos que se vaya. Cual fue el problema?\nA) No vi resultados\nB) Muy caro\nC) Otra razon'
    );
  }

  console.log(`[webhooks:stripe] Subscription deleted for restaurant ${sub.restaurant_id}`);
}

/**
 * invoice.payment_succeeded — Monthly charge collected.
 */
async function handlePaymentSucceeded(invoice) {
  if (!invoice.subscription) return;

  const sub = await getSubscriptionByStripeId(invoice.subscription);
  if (!sub) return;

  // Update period end
  if (invoice.lines?.data?.[0]?.period?.end) {
    await updateSubscriptionStatus(sub.id, 'active', {
      current_period_end: new Date(invoice.lines.data[0].period.end * 1000).toISOString(),
    });
  }

  console.log(`[webhooks:stripe] Payment succeeded for subscription ${invoice.subscription}`);
}

/**
 * invoice.payment_failed — Monthly charge failed.
 */
async function handlePaymentFailed(invoice) {
  if (!invoice.subscription) return;

  const sub = await getSubscriptionByStripeId(invoice.subscription);
  if (!sub) return;

  // Mark as past_due and pause content
  await updateSubscriptionStatus(sub.id, 'past_due');
  await updateRestaurantStatus(sub.restaurant_id, 'paused');

  // Notify client
  const contactId = await resolveContactId(sub.restaurant_id);
  if (contactId) {
    await sendWhatsAppMessage(
      contactId,
      'Hubo un problema con tu pago. Por favor actualiza tu tarjeta. Reintentaremos automaticamente en unos dias.'
    );
  }

  // Notify operator
  const OPERATOR_CONTACT_ID = process.env.OPERATOR_GHL_CONTACT_ID;
  if (OPERATOR_CONTACT_ID) {
    await sendWhatsAppMessage(
      OPERATOR_CONTACT_ID,
      `⚠️ PAGO FALLIDO: Restaurant ${sub.restaurant_id}. Subscription ${invoice.subscription}.`
    );
  }

  console.log(`[webhooks:stripe] Payment failed for subscription ${invoice.subscription}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the GHL contact ID for a restaurant's primary contact.
 */
async function resolveContactId(restaurantId) {
  try {
    const { lookupContactByPhone } = await import('../services/ghl.js');

    const { data: contact } = await supabase
      .from('authorized_contacts')
      .select('phone')
      .eq('restaurant_id', restaurantId)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle();

    if (!contact?.phone) return null;

    const ghlContact = await lookupContactByPhone(contact.phone);
    return ghlContact?.id || null;
  } catch {
    return null;
  }
}
