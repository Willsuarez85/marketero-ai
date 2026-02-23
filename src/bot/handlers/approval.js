// ---------------------------------------------------------------------------
// src/bot/handlers/approval.js  --  Approval flow handler
// ---------------------------------------------------------------------------
// Thin handler for post-approval actions. The heavy lifting lives in
// conversation.js (intent routing) and publish.js (scheduling + publishing).
// ---------------------------------------------------------------------------

import { schedulePublishBuffer } from '../../content/publish.js';

// ---------------------------------------------------------------------------
// handlePostApproval
// ---------------------------------------------------------------------------

/**
 * Called when a client approves a post (triggered from conversation.js).
 * Schedules the publish buffer so the post goes live after a configurable
 * delay, giving the client a window to cancel.
 *
 * @param {object} restaurant - The restaurant record.
 * @param {string} contentId  - UUID of the approved content item.
 * @param {string} contactId  - GHL contact ID of the approving user.
 * @returns {Promise<{ action: string, contentId: string }>}
 */
export async function handlePostApproval(restaurant, contentId, contactId) {
  try {
    console.log(
      `[bot:approval] Handling post approval for content ${contentId} ` +
      `(restaurant: ${restaurant.id}, contact: ${contactId})`,
    );

    const job = await schedulePublishBuffer(contentId, restaurant.id);

    if (!job) {
      console.error(`[bot:approval] Failed to schedule publish buffer for content ${contentId}`);
      return { action: 'approval_schedule_failed', contentId };
    }

    console.log(`[bot:approval] Publish buffer scheduled — job ${job.id} for content ${contentId}`);

    return { action: 'approval_scheduled', contentId };
  } catch (err) {
    console.error(`[bot:approval] Error in handlePostApproval for content ${contentId}:`, err.message);
    return { action: 'approval_error', contentId };
  }
}
