// ---------------------------------------------------------------------------
// src/bot/handlers/autopilot.js  --  Autopilot mode handler
// ---------------------------------------------------------------------------
// When a client has autopilot=true and doesn't respond to a post within
// 90 minutes, we send a reminder. If still no response after 30 more
// minutes (120 total), we auto-publish.
// ---------------------------------------------------------------------------

import { supabase } from '../../db/client.js';
import { updateContentStatus } from '../../db/queries/content.js';
import { createJob, hasPendingJob } from '../../db/queries/jobs.js';
import { publishContent } from '../../content/publish.js';
import { sendWhatsAppMessage } from '../../services/ghl.js';
import { lookupContactByPhone } from '../../services/ghl.js';

const AUTOPILOT_REMINDER_MINUTES = parseInt(process.env.AUTOPILOT_REMINDER_MINUTES, 10) || 90;
const AUTOPILOT_PUBLISH_MINUTES = parseInt(process.env.AUTOPILOT_PUBLISH_MINUTES, 10) || 120;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the GHL contact ID for a restaurant's primary contact.
 * @param {string} restaurantId
 * @returns {Promise<string|null>}
 */
async function resolveContactId(restaurantId) {
  try {
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

// ---------------------------------------------------------------------------
// checkAutopilotReminders
// ---------------------------------------------------------------------------

/**
 * Scans for content items that have been waiting for client approval longer
 * than AUTOPILOT_REMINDER_MINUTES. For restaurants with autopilot=true,
 * sends a reminder and schedules the auto-publish job.
 *
 * Called by the scheduler every 15 minutes.
 *
 * @returns {Promise<{ reminded: number, skipped: number }>}
 */
export async function checkAutopilotReminders() {
  try {
    const cutoff = new Date(Date.now() - AUTOPILOT_REMINDER_MINUTES * 60 * 1000).toISOString();

    // Find content items waiting for client approval past the cutoff
    const { data: pendingItems, error } = await supabase
      .from('content_items')
      .select('id, restaurant_id, caption, created_at')
      .eq('status', 'pending_client')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[autopilot] Error fetching pending items:', error.message);
      return { reminded: 0, skipped: 0 };
    }

    if (!pendingItems || pendingItems.length === 0) {
      return { reminded: 0, skipped: 0 };
    }

    let reminded = 0;
    let skipped = 0;

    for (const item of pendingItems) {
      try {
        // Check if restaurant has autopilot enabled
        const { data: restaurant } = await supabase
          .from('restaurants')
          .select('id, name, autopilot')
          .eq('id', item.restaurant_id)
          .single();

        if (!restaurant?.autopilot) {
          skipped++;
          continue;
        }

        // Check if we already sent a reminder (avoid duplicates)
        const hasReminder = await hasPendingJob(item.restaurant_id, 'autopilot_publish');
        if (hasReminder) {
          skipped++;
          continue;
        }

        // Send reminder to client
        const contactId = await resolveContactId(item.restaurant_id);
        if (contactId) {
          await sendWhatsAppMessage(
            contactId,
            'Tu post se publicara automaticamente en 30 minutos. Si quieres hacer cambios, responde ahora.'
          );
        }

        // Schedule the autopilot publish for 30 minutes from now
        const publishAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await createJob(item.restaurant_id, 'autopilot_publish', publishAt, {
          content_id: item.id,
        });

        reminded++;
        console.log(`[autopilot] Reminder sent for content ${item.id} (restaurant: ${restaurant.name || restaurant.id})`);
      } catch (itemErr) {
        console.error(`[autopilot] Error processing item ${item.id}:`, itemErr.message);
        skipped++;
      }
    }

    if (reminded > 0 || skipped > 0) {
      console.log(`[autopilot] Check complete: ${reminded} reminded, ${skipped} skipped`);
    }

    return { reminded, skipped };
  } catch (err) {
    console.error('[autopilot] Error in checkAutopilotReminders:', err.message);
    return { reminded: 0, skipped: 0 };
  }
}

// ---------------------------------------------------------------------------
// handleAutopilotPublish
// ---------------------------------------------------------------------------

/**
 * Handles an autopilot_publish job: auto-approves the content and publishes
 * immediately (no 15-min buffer).
 *
 * @param {object} job - The scheduled_job record with metadata.content_id.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function handleAutopilotPublish(job) {
  const contentId = job.metadata?.content_id;

  if (!contentId) {
    console.error(`[autopilot] Job ${job.id} missing content_id in metadata`);
    return { success: false, error: 'missing_content_id' };
  }

  try {
    // Re-check: content must still be pending_client (client may have responded)
    const { data: content } = await supabase
      .from('content_items')
      .select('id, status, restaurant_id')
      .eq('id', contentId)
      .single();

    if (!content) {
      return { success: false, error: 'content_not_found' };
    }

    if (content.status !== 'pending_client') {
      console.log(`[autopilot] Content ${contentId} is no longer pending_client (status: ${content.status}), skipping auto-publish`);
      return { success: true }; // Not an error — client already responded
    }

    // Auto-approve
    await updateContentStatus(contentId, 'approved', {
      client_approved_at: new Date().toISOString(),
    });

    // Publish immediately (no buffer)
    const result = await publishContent(contentId);

    if (result.success) {
      // Send autopilot confirmation
      const contactId = await resolveContactId(content.restaurant_id);
      if (contactId) {
        await sendWhatsAppMessage(contactId, 'Tu post se publico en piloto automatico ✅');
      }
      console.log(`[autopilot] Content ${contentId} auto-published successfully`);
    } else {
      console.error(`[autopilot] Failed to auto-publish content ${contentId}:`, result.error);
    }

    return result;
  } catch (err) {
    console.error(`[autopilot] Error in handleAutopilotPublish for content ${contentId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// activateAutopilot / deactivateAutopilot
// ---------------------------------------------------------------------------

/**
 * Enables autopilot mode for a restaurant.
 * @param {string} restaurantId
 * @returns {Promise<boolean>} True if successful.
 */
export async function activateAutopilot(restaurantId) {
  try {
    const { error } = await supabase
      .from('restaurants')
      .update({ autopilot: true })
      .eq('id', restaurantId);

    if (error) {
      console.error('[autopilot] Error activating autopilot:', error.message);
      return false;
    }

    console.log(`[autopilot] Autopilot activated for restaurant ${restaurantId}`);
    return true;
  } catch (err) {
    console.error('[autopilot] Exception activating autopilot:', err.message);
    return false;
  }
}

/**
 * Disables autopilot mode for a restaurant.
 * @param {string} restaurantId
 * @returns {Promise<boolean>} True if successful.
 */
export async function deactivateAutopilot(restaurantId) {
  try {
    const { error } = await supabase
      .from('restaurants')
      .update({ autopilot: false })
      .eq('id', restaurantId);

    if (error) {
      console.error('[autopilot] Error deactivating autopilot:', error.message);
      return false;
    }

    console.log(`[autopilot] Autopilot deactivated for restaurant ${restaurantId}`);
    return true;
  } catch (err) {
    console.error('[autopilot] Exception deactivating autopilot:', err.message);
    return false;
  }
}
