import { supabase } from '../client.js';

/**
 * Valid status transitions for content items.
 * Maps each status to an array of statuses it can transition to.
 * @type {Map<string, string[]>}
 */
export const TRANSITIONS = new Map([
  ['generating',      ['human_review', 'failed']],
  ['human_review',    ['pending_client', 'generating']],
  ['pending_client',  ['approved', 'generating']],
  ['approved',        ['published', 'publish_failed', 'cancelled']],
  ['published',       []],
  ['failed',          ['generating']],
  ['publish_failed',  ['approved']],
  ['cancelled',       ['pending_client']],
]);

/**
 * Creates a new content item with an initial status of 'generating'.
 * @param {object} data - The fields for the new content item (must include restaurant_id at minimum).
 * @returns {Promise<object|null>} The created content item record, or null on failure.
 */
export async function createContentItem(data) {
  try {
    const { data: created, error } = await supabase
      .from('content_items')
      .insert({ ...data, status: 'generating' })
      .select()
      .single();

    if (error) {
      console.error('[db:content_items] Error in createContentItem:', error.message);
      return null;
    }

    return created;
  } catch (err) {
    console.error('[db:content_items] Exception in createContentItem:', err.message);
    return null;
  }
}

/**
 * Retrieves content items by status, joined with restaurant name.
 * @param {string} status - The status to filter by.
 * @param {number} [limit=20] - Maximum number of records to return.
 * @returns {Promise<object[]>} An array of content items with restaurant name, or empty array on failure.
 */
export async function getContentByStatus(status, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('content_items')
      .select('*, restaurants(name)')
      .eq('status', status)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[db:content_items] Error in getContentByStatus:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:content_items] Exception in getContentByStatus:', err.message);
    return [];
  }
}

/**
 * Gets the most recent content item with status 'pending_client' for a given restaurant.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @returns {Promise<object|null>} The most recent pending content item, or null if none found.
 */
export async function getPendingApproval(restaurantId) {
  try {
    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'pending_client')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[db:content_items] Error in getPendingApproval:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:content_items] Exception in getPendingApproval:', err.message);
    return null;
  }
}

/**
 * Updates the status of a content item, validating the transition against the TRANSITIONS map.
 * @param {string} id - The UUID of the content item.
 * @param {string} newStatus - The desired new status.
 * @param {object} [extraFields={}] - Additional fields to update alongside the status.
 * @returns {Promise<object|null>} The updated content item, or null on failure.
 * @throws {Error} If the status transition is not allowed.
 */
export async function updateContentStatus(id, newStatus, extraFields = {}) {
  try {
    // Fetch current status
    const { data: current, error: fetchError } = await supabase
      .from('content_items')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('[db:content_items] Error fetching current status:', fetchError.message);
      return null;
    }

    if (!current) {
      throw new Error(`Content item ${id} not found`);
    }

    // Validate transition
    const allowedTransitions = TRANSITIONS.get(current.status);
    if (!allowedTransitions) {
      throw new Error(`Unknown current status "${current.status}" for content item ${id}`);
    }

    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: "${current.status}" -> "${newStatus}" for content item ${id}. ` +
        `Allowed transitions from "${current.status}": [${allowedTransitions.join(', ')}]`
      );
    }

    // Perform update
    const { data: updated, error: updateError } = await supabase
      .from('content_items')
      .update({ status: newStatus, ...extraFields })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[db:content_items] Error in updateContentStatus:', updateError.message);
      return null;
    }

    return updated;
  } catch (err) {
    if (err.message.includes('Invalid status transition') || err.message.includes('not found') || err.message.includes('Unknown current status')) {
      throw err;
    }
    console.error('[db:content_items] Exception in updateContentStatus:', err.message);
    return null;
  }
}

/**
 * Gets the oldest content item with status 'human_review' across all restaurants.
 * Used by the operator to approve/reject the next item in the queue.
 * @returns {Promise<object|null>} The oldest human_review content item, or null if none found.
 */
export async function getOldestHumanReview() {
  try {
    const { data, error } = await supabase
      .from('content_items')
      .select('*, restaurants(name)')
      .eq('status', 'human_review')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[db:content_items] Error in getOldestHumanReview:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:content_items] Exception in getOldestHumanReview:', err.message);
    return null;
  }
}

/**
 * Counts content items with a given status.
 * @param {string} status - The status to count.
 * @returns {Promise<number>} The count, or 0 on failure.
 */
export async function countByStatus(status) {
  try {
    const { count, error } = await supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);

    if (error) {
      console.error('[db:content_items] Error in countByStatus:', error.message);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('[db:content_items] Exception in countByStatus:', err.message);
    return 0;
  }
}

/**
 * Gets recent content items for a restaurant, ordered newest first.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @param {number} [limit=10] - Maximum number of records to return.
 * @returns {Promise<object[]>} An array of content items, or empty array on failure.
 */
export async function getRecentContent(restaurantId, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[db:content_items] Error in getRecentContent:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:content_items] Exception in getRecentContent:', err.message);
    return [];
  }
}
