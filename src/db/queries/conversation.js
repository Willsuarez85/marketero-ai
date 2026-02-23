import { supabase } from '../client.js';

/**
 * Retrieves the current conversation state for a restaurant.
 * Returns null if there is no active flow or if the conversation has expired.
 * Automatically clears expired conversation states.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @returns {Promise<object|null>} The conversation state record, or null if none/expired.
 */
export async function getConversationState(restaurantId) {
  try {
    const { data, error } = await supabase
      .from('conversation_state')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (error) {
      console.error('[db:conversation_state] Error in getConversationState:', error.message);
      return null;
    }

    if (!data) return null;

    // No active flow
    if (!data.current_flow) return null;

    // Check expiry
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      await clearConversationState(restaurantId);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:conversation_state] Exception in getConversationState:', err.message);
    return null;
  }
}

/**
 * Sets (upserts) the conversation state for a restaurant.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @param {string} flow - The name of the current conversation flow.
 * @param {number} step - The current step number within the flow.
 * @param {object} data - Arbitrary data associated with the current conversation state.
 * @param {number} [expiresInMinutes=30] - Number of minutes until this conversation state expires.
 * @returns {Promise<object|null>} The upserted conversation state record, or null on failure.
 */
export async function setConversationState(restaurantId, flow, step, data, expiresInMinutes = 30) {
  try {
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

    const { data: upserted, error } = await supabase
      .from('conversation_state')
      .upsert(
        {
          restaurant_id: restaurantId,
          current_flow: flow,
          flow_step: step,
          flow_data: data,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[db:conversation_state] Error in setConversationState:', error.message);
      return null;
    }

    return upserted;
  } catch (err) {
    console.error('[db:conversation_state] Exception in setConversationState:', err.message);
    return null;
  }
}

/**
 * Clears the conversation state for a restaurant by resetting flow, step, and data.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @returns {Promise<object|null>} The cleared conversation state record, or null on failure.
 */
export async function clearConversationState(restaurantId) {
  try {
    const { data, error } = await supabase
      .from('conversation_state')
      .upsert(
        {
          restaurant_id: restaurantId,
          current_flow: null,
          flow_step: 0,
          flow_data: {},
          expires_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[db:conversation_state] Error in clearConversationState:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:conversation_state] Exception in clearConversationState:', err.message);
    return null;
  }
}

/**
 * Advances the conversation to a new step, merging additional data into the existing state
 * and resetting the expiry timer.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @param {number} newStep - The step number to advance to.
 * @param {object} [additionalData={}] - Additional data to merge into the current conversation data.
 * @returns {Promise<object|null>} The updated conversation state record, or null on failure.
 */
export async function advanceConversationStep(restaurantId, newStep, additionalData = {}) {
  try {
    // Fetch current state
    const { data: current, error: fetchError } = await supabase
      .from('conversation_state')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (fetchError) {
      console.error('[db:conversation_state] Error fetching current state:', fetchError.message);
      return null;
    }

    if (!current) {
      console.error('[db:conversation_state] No conversation state found for restaurant:', restaurantId);
      return null;
    }

    // Merge data
    const mergedData = { ...(current.flow_data || {}), ...additionalData };
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('conversation_state')
      .update({
        flow_step: newStep,
        flow_data: mergedData,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (updateError) {
      console.error('[db:conversation_state] Error in advanceConversationStep:', updateError.message);
      return null;
    }

    return updated;
  } catch (err) {
    console.error('[db:conversation_state] Exception in advanceConversationStep:', err.message);
    return null;
  }
}
