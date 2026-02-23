// ---------------------------------------------------------------------------
// src/db/queries/subscriptions.js  --  Subscription table queries
// ---------------------------------------------------------------------------

import { supabase } from '../client.js';

/**
 * Upserts a subscription record (insert or update on restaurant_id conflict).
 *
 * @param {object} data - Subscription fields to upsert.
 * @param {string} data.restaurant_id - UUID of the restaurant.
 * @param {string} data.stripe_customer_id - Stripe customer ID.
 * @param {string} data.stripe_subscription_id - Stripe subscription ID.
 * @param {string} [data.status='active'] - Subscription status.
 * @param {string} [data.current_period_start] - ISO timestamp.
 * @param {string} [data.current_period_end] - ISO timestamp.
 * @returns {Promise<object|null>} The upserted record, or null on failure.
 */
export async function upsertSubscription(data) {
  try {
    const { data: upserted, error } = await supabase
      .from('subscriptions')
      .upsert(
        {
          ...data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[db:subscriptions] Error in upsertSubscription:', error.message);
      return null;
    }

    return upserted;
  } catch (err) {
    console.error('[db:subscriptions] Exception in upsertSubscription:', err.message);
    return null;
  }
}

/**
 * Gets the subscription for a restaurant.
 *
 * @param {string} restaurantId - UUID of the restaurant.
 * @returns {Promise<object|null>}
 */
export async function getSubscriptionByRestaurant(restaurantId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (error) {
      console.error('[db:subscriptions] Error in getSubscriptionByRestaurant:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:subscriptions] Exception in getSubscriptionByRestaurant:', err.message);
    return null;
  }
}

/**
 * Finds a subscription by its Stripe subscription ID.
 *
 * @param {string} stripeSubscriptionId - Stripe subscription ID.
 * @returns {Promise<object|null>}
 */
export async function getSubscriptionByStripeId(stripeSubscriptionId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle();

    if (error) {
      console.error('[db:subscriptions] Error in getSubscriptionByStripeId:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:subscriptions] Exception in getSubscriptionByStripeId:', err.message);
    return null;
  }
}

/**
 * Finds a subscription by its Stripe customer ID.
 *
 * @param {string} stripeCustomerId - Stripe customer ID.
 * @returns {Promise<object|null>}
 */
export async function getSubscriptionByCustomerId(stripeCustomerId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();

    if (error) {
      console.error('[db:subscriptions] Error in getSubscriptionByCustomerId:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:subscriptions] Exception in getSubscriptionByCustomerId:', err.message);
    return null;
  }
}

/**
 * Updates a subscription's status and optional extra fields.
 *
 * @param {string} id - UUID of the subscription record.
 * @param {string} status - New status value.
 * @param {object} [extraFields={}] - Additional fields to update.
 * @returns {Promise<object|null>}
 */
export async function updateSubscriptionStatus(id, status, extraFields = {}) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        status,
        ...extraFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:subscriptions] Error in updateSubscriptionStatus:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:subscriptions] Exception in updateSubscriptionStatus:', err.message);
    return null;
  }
}
