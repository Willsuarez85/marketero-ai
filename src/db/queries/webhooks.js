import { supabase } from '../client.js';

/**
 * Saves a raw webhook payload to the webhook_raw_log table.
 * Handles duplicate ghlEventId gracefully by catching unique constraint violations (code 23505).
 * @param {string} ghlEventId - The unique event ID from GoHighLevel.
 * @param {object} payload - The raw webhook payload to store.
 * @returns {Promise<{id: string, duplicate?: boolean}|null>} The record ID and duplicate flag, or null on failure.
 */
export async function saveRawWebhook(ghlEventId, payload) {
  try {
    const { data, error } = await supabase
      .from('webhook_raw_log')
      .insert({ ghl_event_id: ghlEventId, payload })
      .select('id')
      .single();

    if (error) {
      // Handle unique constraint violation (duplicate ghlEventId)
      if (error.code === '23505') {
        const { data: existing, error: fetchError } = await supabase
          .from('webhook_raw_log')
          .select('id')
          .eq('ghl_event_id', ghlEventId)
          .single();

        if (fetchError) {
          console.error('[db:webhook_raw_log] Error fetching duplicate webhook:', fetchError.message);
          return null;
        }

        return { id: existing.id, duplicate: true };
      }

      console.error('[db:webhook_raw_log] Error in saveRawWebhook:', error.message);
      return null;
    }

    return { id: data.id };
  } catch (err) {
    console.error('[db:webhook_raw_log] Exception in saveRawWebhook:', err.message);
    return null;
  }
}

/**
 * Retrieves webhooks that have not yet been processed (status='received').
 * @param {number} [limit=10] - Maximum number of records to return.
 * @returns {Promise<object[]>} An array of pending webhook records, or empty array on failure.
 */
export async function getPendingWebhooks(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('webhook_raw_log')
      .select('*')
      .eq('status', 'received')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[db:webhook_raw_log] Error in getPendingWebhooks:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:webhook_raw_log] Exception in getPendingWebhooks:', err.message);
    return [];
  }
}

/**
 * Marks a webhook as successfully processed.
 * @param {string} id - The UUID of the webhook_raw_log record.
 * @returns {Promise<object|null>} The updated record, or null on failure.
 */
export async function markWebhookProcessed(id) {
  try {
    const { data, error } = await supabase
      .from('webhook_raw_log')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:webhook_raw_log] Error in markWebhookProcessed:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:webhook_raw_log] Exception in markWebhookProcessed:', err.message);
    return null;
  }
}

/**
 * Marks a webhook as failed with an error message and attempt count.
 * @param {string} id - The UUID of the webhook_raw_log record.
 * @param {string} errorMessage - A description of the error that occurred.
 * @param {number} attempts - The current number of processing attempts.
 * @returns {Promise<object|null>} The updated record, or null on failure.
 */
export async function markWebhookFailed(id, errorMessage, attempts) {
  try {
    const { data, error } = await supabase
      .from('webhook_raw_log')
      .update({
        status: 'failed',
        error_message: errorMessage,
        attempts,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:webhook_raw_log] Error in markWebhookFailed:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:webhook_raw_log] Exception in markWebhookFailed:', err.message);
    return null;
  }
}
