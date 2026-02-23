import { supabase } from '../client.js';

/**
 * Logs a WhatsApp message to the whatsapp_log table.
 * Intentionally does not throw on error -- logging should never break the main flow.
 * @param {object} data - The message data to log (should include restaurant_id, direction, body, etc.).
 * @returns {Promise<object|null>} The created log record, or null on failure.
 */
export async function logMessage(data) {
  try {
    const { data: created, error } = await supabase
      .from('whatsapp_log')
      .insert(data)
      .select()
      .single();

    if (error) {
      console.error('[db:whatsapp_log] Error in logMessage:', error.message);
      return null;
    }

    return created;
  } catch (err) {
    console.error('[db:whatsapp_log] Exception in logMessage:', err.message);
    return null;
  }
}

/**
 * Checks whether a GoHighLevel event has already been processed.
 * @param {string} ghlEventId - The unique event ID from GoHighLevel.
 * @returns {Promise<boolean>} True if the event has been processed, false otherwise.
 */
export async function isEventProcessed(ghlEventId) {
  try {
    const { data, error } = await supabase
      .from('whatsapp_log')
      .select('id')
      .eq('ghl_event_id', ghlEventId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[db:whatsapp_log] Error in isEventProcessed:', error.message);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('[db:whatsapp_log] Exception in isEventProcessed:', err.message);
    return false;
  }
}

/**
 * Retrieves recent WhatsApp messages for a restaurant, ordered newest first.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @param {number} [limit=20] - Maximum number of records to return.
 * @returns {Promise<object[]>} An array of message log records, or empty array on failure.
 */
export async function getRecentMessages(restaurantId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('whatsapp_log')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[db:whatsapp_log] Error in getRecentMessages:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:whatsapp_log] Exception in getRecentMessages:', err.message);
    return [];
  }
}
