// ---------------------------------------------------------------------------
// src/db/queries/memory.js  --  Client memory log queries
// ---------------------------------------------------------------------------

import { supabase } from '../client.js';

/**
 * Logs a memory event for a restaurant (approval, rejection, feedback, etc.).
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {string} memoryType - One of: approval, rejection, feedback, preference, interaction.
 * @param {string} content - Description of the memory event.
 * @param {object} [context={}] - Additional context (contentId, etc.).
 * @returns {Promise<object|null>} The created memory log record, or null on failure.
 */
export async function logMemory(restaurantId, memoryType, content, context = {}) {
  try {
    const { data, error } = await supabase
      .from('client_memory_log')
      .insert({
        restaurant_id: restaurantId,
        memory_type: memoryType,
        content,
        context,
      })
      .select()
      .single();

    if (error) {
      console.error('[db:memory] Error in logMemory:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:memory] Exception in logMemory:', err.message);
    return null;
  }
}

/**
 * Gets recent memories for a restaurant, ordered newest first.
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {number} [limit=20] - Maximum number of records to return.
 * @returns {Promise<object[]>} An array of memory log records, or empty array on failure.
 */
export async function getRecentMemories(restaurantId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('client_memory_log')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[db:memory] Error in getRecentMemories:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:memory] Exception in getRecentMemories:', err.message);
    return [];
  }
}
