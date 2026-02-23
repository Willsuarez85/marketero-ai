// ---------------------------------------------------------------------------
// src/content/publish.js  --  Publish pipeline: approval delivery + publishing
// ---------------------------------------------------------------------------

import { supabase } from '../db/client.js';
import { getRestaurantWithBrain } from '../db/queries/restaurants.js';
import { updateContentStatus } from '../db/queries/content.js';
import { createJob } from '../db/queries/jobs.js';
import {
  sendWhatsAppMessage,
  sendWhatsAppImage,
  lookupContactByPhone,
  publishSocialPost,
} from '../services/ghl.js';

const PUBLISH_BUFFER_MINUTES = parseInt(process.env.PUBLISH_BUFFER_MINUTES, 10) || 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads a single content item by ID directly from Supabase.
 * @param {string} contentId - UUID of the content item.
 * @returns {Promise<object|null>} The content item, or null on failure.
 */
async function loadContentItem(contentId) {
  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error) {
    console.error(`[content:publish] Failed to load content item ${contentId}:`, error.message);
    return null;
  }

  return data;
}

/**
 * Looks up the GHL contact ID for a restaurant by finding the primary
 * authorized contact phone and resolving it through GHL.
 * @param {string} restaurantId - UUID of the restaurant.
 * @returns {Promise<string|null>} The GHL contact ID, or null if not found.
 */
async function resolveContactId(restaurantId) {
  // Get primary phone from authorized_contacts
  const { data: contact, error } = await supabase
    .from('authorized_contacts')
    .select('phone')
    .eq('restaurant_id', restaurantId)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[content:publish] Failed to look up authorized contact for restaurant ${restaurantId}:`, error.message);
    return null;
  }

  if (!contact?.phone) {
    console.error(`[content:publish] No primary authorized contact found for restaurant ${restaurantId}`);
    return null;
  }

  // Resolve phone to GHL contact
  const ghlContact = await lookupContactByPhone(contact.phone);

  if (!ghlContact?.id) {
    console.error(`[content:publish] GHL contact not found for phone ${contact.phone}`);
    return null;
  }

  return ghlContact.id;
}

// ---------------------------------------------------------------------------
// sendContentForApproval
// ---------------------------------------------------------------------------

/**
 * Sends a content item to the restaurant owner via WhatsApp for approval.
 *
 * Steps:
 *   1. Load the content item from DB
 *   2. Load the restaurant with brain data
 *   3. Resolve the GHL contact ID from the primary authorized contact
 *   4. Send the image + caption (or text-only if no image)
 *   5. Send the approval prompt
 *   6. Update content status to 'pending_client'
 *
 * @param {string} contentId - UUID of the content item to send for approval.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendContentForApproval(contentId) {
  try {
    // 1. Load content item
    const content = await loadContentItem(contentId);

    if (!content) {
      console.error(`[content:publish] Content item ${contentId} not found`);
      return { success: false, error: 'content_not_found' };
    }

    console.log(`[content:publish] Sending content ${contentId} for approval`);

    // 2. Load restaurant with brain
    const restaurant = await getRestaurantWithBrain(content.restaurant_id);

    if (!restaurant) {
      console.error(`[content:publish] Restaurant ${content.restaurant_id} not found`);
      return { success: false, error: 'restaurant_not_found' };
    }

    // 3. Resolve GHL contact ID
    const contactId = await resolveContactId(restaurant.id);

    if (!contactId) {
      console.error(`[content:publish] Could not resolve GHL contact for restaurant ${restaurant.id}`);
      return { success: false, error: 'contact_not_found' };
    }

    // 4. Send content via WhatsApp
    const caption = content.caption || '';

    if (content.image_url) {
      const sendResult = await sendWhatsAppImage(contactId, content.image_url, caption);

      if (!sendResult) {
        console.error(`[content:publish] Failed to send WhatsApp image for content ${contentId}`);
        return { success: false, error: 'whatsapp_image_send_failed' };
      }
    } else {
      const sendResult = await sendWhatsAppMessage(contactId, caption);

      if (!sendResult) {
        console.error(`[content:publish] Failed to send WhatsApp message for content ${contentId}`);
        return { success: false, error: 'whatsapp_message_send_failed' };
      }
    }

    // 5. Send follow-up approval prompt
    const approvalPrompt = '¿Te gusta este post? Responde SI para publicar o NO si quieres otro.';
    await sendWhatsAppMessage(contactId, approvalPrompt);

    // 6. Update content status to 'pending_client'
    const updated = await updateContentStatus(contentId, 'pending_client');

    if (!updated) {
      console.error(`[content:publish] Failed to update content ${contentId} to 'pending_client'`);
      return { success: false, error: 'status_update_failed' };
    }

    console.log(`[content:publish] Content ${contentId} sent for approval successfully`);
    return { success: true };
  } catch (err) {
    console.error(`[content:publish] Error in sendContentForApproval for ${contentId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// publishContent
// ---------------------------------------------------------------------------

/**
 * Publishes an approved content item to social media via GHL.
 *
 * Steps:
 *   1. Load the content item
 *   2. Load the restaurant
 *   3. Verify status is 'approved'
 *   4. Publish via GHL social media API
 *   5. Update status to 'published' with metadata
 *   6. Send WhatsApp confirmation
 *   7. On failure, update status to 'publish_failed'
 *
 * @param {string} contentId - UUID of the content item to publish.
 * @returns {Promise<{ success: boolean, error?: string, ghlPostId?: string }>}
 */
export async function publishContent(contentId) {
  try {
    // 1. Load content item
    const content = await loadContentItem(contentId);

    if (!content) {
      console.error(`[content:publish] Content item ${contentId} not found`);
      return { success: false, error: 'content_not_found' };
    }

    // 2. Load restaurant
    const restaurant = await getRestaurantWithBrain(content.restaurant_id);

    if (!restaurant) {
      console.error(`[content:publish] Restaurant ${content.restaurant_id} not found`);
      return { success: false, error: 'restaurant_not_found' };
    }

    // 3. Verify status is 'approved'
    if (content.status !== 'approved') {
      console.error(`[content:publish] Content ${contentId} is not approved (status: ${content.status})`);
      return { success: false, error: `invalid_status: expected 'approved', got '${content.status}'` };
    }

    console.log(`[content:publish] Publishing content ${contentId} for restaurant ${restaurant.name || restaurant.id}`);

    // 4. Publish via GHL
    const platforms = restaurant.platforms || ['facebook', 'instagram'];
    const postResult = await publishSocialPost(
      restaurant.ghl_sub_account_id,
      platforms,
      content.caption,
      content.image_url,
    );

    if (!postResult) {
      console.error(`[content:publish] GHL publishSocialPost failed for content ${contentId}`);

      // 7. Mark as publish_failed
      try {
        await updateContentStatus(contentId, 'publish_failed');
      } catch (statusErr) {
        console.error(`[content:publish] Failed to update status to 'publish_failed':`, statusErr.message);
      }

      return { success: false, error: 'ghl_publish_failed' };
    }

    const ghlPostId = postResult.id || postResult.postId || null;

    // 5. Update status to 'published'
    try {
      await updateContentStatus(contentId, 'published', {
        published_at: new Date().toISOString(),
        ghl_post_id: ghlPostId,
      });
    } catch (statusErr) {
      console.error(`[content:publish] Failed to update status to 'published':`, statusErr.message);
      return { success: false, error: 'status_update_failed' };
    }

    // 6. Send WhatsApp confirmation
    try {
      const contactId = await resolveContactId(restaurant.id);

      if (contactId) {
        await sendWhatsAppMessage(contactId, '✅ Tu post fue publicado exitosamente!');
      } else {
        console.warn(`[content:publish] Could not resolve contact for confirmation message`);
      }
    } catch (msgErr) {
      // Non-fatal: the post is already published
      console.error(`[content:publish] Failed to send confirmation message:`, msgErr.message);
    }

    console.log(`[content:publish] Content ${contentId} published successfully (ghlPostId: ${ghlPostId})`);

    return { success: true, ghlPostId };
  } catch (err) {
    console.error(`[content:publish] Error in publishContent for ${contentId}:`, err.message);

    // Attempt to mark as publish_failed
    try {
      await updateContentStatus(contentId, 'publish_failed');
    } catch (statusErr) {
      console.error(`[content:publish] Failed to mark as 'publish_failed':`, statusErr.message);
    }

    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// schedulePublishBuffer
// ---------------------------------------------------------------------------

/**
 * Creates a delayed publish job that fires after a configurable buffer period,
 * giving the client time to cancel before the post goes live.
 *
 * Steps:
 *   1. Calculate scheduledFor = now + PUBLISH_BUFFER_MINUTES
 *   2. Update the content item with the publish_deadline
 *   3. Create a 'publish_buffer' scheduled job
 *
 * @param {string} contentId    - UUID of the content item.
 * @param {string} restaurantId - UUID of the restaurant.
 * @returns {Promise<object|null>} The created job, or null on failure.
 */
export async function schedulePublishBuffer(contentId, restaurantId) {
  try {
    // 1. Calculate scheduled time
    const scheduledFor = new Date(Date.now() + PUBLISH_BUFFER_MINUTES * 60 * 1000).toISOString();
    const publishDeadline = scheduledFor;

    console.log(
      `[content:publish] Scheduling publish buffer for content ${contentId} — ` +
      `fires at ${scheduledFor} (${PUBLISH_BUFFER_MINUTES} min from now)`,
    );

    // 2. Update content item with publish deadline
    const { error: updateError } = await supabase
      .from('content_items')
      .update({ publish_deadline: publishDeadline })
      .eq('id', contentId);

    if (updateError) {
      console.error(`[content:publish] Failed to set publish_deadline on content ${contentId}:`, updateError.message);
      return null;
    }

    // 3. Create scheduled job
    const job = await createJob(restaurantId, 'publish_buffer', scheduledFor, {
      content_id: contentId,
    });

    if (!job) {
      console.error(`[content:publish] Failed to create publish_buffer job for content ${contentId}`);
      return null;
    }

    console.log(`[content:publish] Publish buffer job ${job.id} created for content ${contentId}`);
    return job;
  } catch (err) {
    console.error(`[content:publish] Error in schedulePublishBuffer for ${contentId}:`, err.message);
    return null;
  }
}
