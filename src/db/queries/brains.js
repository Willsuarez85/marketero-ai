// ---------------------------------------------------------------------------
// src/db/queries/brains.js  --  Industry brain + client brain queries
// ---------------------------------------------------------------------------

import { supabase } from '../client.js';

/**
 * Gets a random active industry insight for a given cuisine type.
 * Falls back to insights with cuisine_type = 'mexican' if no match.
 * @param {string} [cuisineType='mexican'] - The cuisine type to filter by.
 * @returns {Promise<string|null>} The insight text, or null if none found.
 */
export async function getRandomIndustryInsight(cuisineType = 'mexican') {
  try {
    // Supabase doesn't support ORDER BY random() directly,
    // so we fetch a small set and pick one at random
    const { data, error } = await supabase
      .from('industry_brain')
      .select('insight')
      .eq('is_active', true)
      .or(`cuisine_type.eq.${cuisineType},cuisine_type.eq.all`)
      .limit(20);

    if (error) {
      console.error('[db:brains] Error in getRandomIndustryInsight:', error.message);
      return null;
    }

    if (!data || data.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * data.length);
    return data[randomIndex].insight;
  } catch (err) {
    console.error('[db:brains] Exception in getRandomIndustryInsight:', err.message);
    return null;
  }
}

/**
 * Updates a client brain with arbitrary fields.
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {object} fields - The fields to update.
 * @returns {Promise<object|null>} The updated brain record, or null on failure.
 */
export async function updateBrain(restaurantId, fields) {
  try {
    const { data, error } = await supabase
      .from('client_brains')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (error) {
      console.error('[db:brains] Error in updateBrain:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:brains] Exception in updateBrain:', err.message);
    return null;
  }
}

/**
 * Increments the onboarding_session counter for a restaurant's brain.
 * @param {string} restaurantId - UUID of the restaurant.
 * @returns {Promise<object|null>} The updated brain record, or null on failure.
 */
export async function incrementOnboardingSession(restaurantId) {
  try {
    // Fetch current value first
    const { data: current, error: fetchError } = await supabase
      .from('client_brains')
      .select('onboarding_session')
      .eq('restaurant_id', restaurantId)
      .single();

    if (fetchError) {
      console.error('[db:brains] Error fetching onboarding_session:', fetchError.message);
      return null;
    }

    const newSession = (current?.onboarding_session || 0) + 1;

    const { data, error } = await supabase
      .from('client_brains')
      .update({
        onboarding_session: newSession,
        updated_at: new Date().toISOString(),
      })
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (error) {
      console.error('[db:brains] Error in incrementOnboardingSession:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:brains] Exception in incrementOnboardingSession:', err.message);
    return null;
  }
}
