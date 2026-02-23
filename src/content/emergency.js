// ---------------------------------------------------------------------------
// src/content/emergency.js  --  Emergency post content generation
// ---------------------------------------------------------------------------
// Generates urgent/time-sensitive content for emergency posts.
// Uses the same pipeline as regular content but with urgency-focused prompts
// and no 15-min buffer on publish.
// ---------------------------------------------------------------------------

import { getRestaurantWithBrain } from '../db/queries/restaurants.js';
import { createContentItem, updateContentStatus } from '../db/queries/content.js';
import { generateCaption, generateImagePrompt } from '../services/claude.js';
import { generateImage } from '../services/fal.js';
import { notifyOperatorNewContent } from '../bot/operator.js';
import { sendContentForApproval } from './publish.js';

// ---------------------------------------------------------------------------
// Emergency content generation
// ---------------------------------------------------------------------------

/**
 * Generates an emergency social media post for a restaurant.
 *
 * Differences from regular generateContent:
 *   - Uses contentType='emergency'
 *   - Injects the client's description into the prompt for urgency
 *   - After generation, sends directly for client approval (skips operator queue)
 *   - On approval, publishes immediately (no 15-min buffer)
 *
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {object} details - Emergency details from the conversation flow.
 * @param {string} details.topic - What the emergency post is about.
 * @param {string} [details.priceOrSchedule] - Price, hours, or other details.
 * @param {string} [details.photoUrl] - Client-provided photo URL.
 * @returns {Promise<{ success: boolean, contentId?: string, error?: string }>}
 */
export async function generateEmergencyContent(restaurantId, details) {
  let contentItem = null;

  try {
    // 1. Load restaurant + brain
    const restaurant = await getRestaurantWithBrain(restaurantId);

    if (!restaurant) {
      return { success: false, error: 'restaurant_not_found' };
    }

    console.log(`[content:emergency] Generating emergency post for ${restaurant.name || restaurantId}`);
    console.log(`[content:emergency] Topic: ${details.topic}`);

    const brain = restaurant.brain;

    // 2. Create content item
    contentItem = await createContentItem({
      restaurant_id: restaurantId,
      content_type: 'emergency',
    });

    if (!contentItem) {
      return { success: false, error: 'content_item_creation_failed' };
    }

    // 3. Build emergency context for Claude
    const emergencyContext = buildEmergencyContext(details);

    // 4. Generate caption with emergency urgency
    let caption = null;
    try {
      caption = await generateCaption(restaurant, 'emergency', brain, emergencyContext);
    } catch (err) {
      console.error('[content:emergency] Caption generation failed:', err.message);
    }

    if (!caption) {
      await updateContentStatus(contentItem.id, 'failed');
      return { success: false, error: 'caption_failed' };
    }

    // 5. Generate image (use client photo if provided, else generate)
    let imageUrl = details.photoUrl || null;

    if (!imageUrl) {
      try {
        const imagePromptText = await generateImagePrompt(restaurant, 'emergency', brain, false);
        if (imagePromptText) {
          const imageResult = await generateImage(imagePromptText);
          imageUrl = imageResult?.imageUrl || null;
        }
      } catch (err) {
        console.warn('[content:emergency] Image generation failed, proceeding without image:', err.message);
      }
    }

    // 6. Update content item → human_review (operator still approves emergency posts)
    await updateContentStatus(contentItem.id, 'human_review', {
      caption,
      image_url: imageUrl,
      image_prompt: `EMERGENCY: ${details.topic}`,
    });

    // 7. Notify operator with priority flag
    try {
      await notifyOperatorNewContent(contentItem.id);
    } catch (notifyErr) {
      console.error('[content:emergency] Failed to notify operator:', notifyErr.message);
    }

    console.log(`[content:emergency] Emergency content ${contentItem.id} ready for review`);

    return {
      success: true,
      contentId: contentItem.id,
      caption,
      imageUrl,
    };
  } catch (err) {
    console.error(`[content:emergency] Error generating emergency content:`, err.message);

    if (contentItem?.id) {
      try {
        await updateContentStatus(contentItem.id, 'failed');
      } catch (statusErr) {
        console.error('[content:emergency] Failed to mark as failed:', statusErr.message);
      }
    }

    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a context string for Claude's emergency caption generation.
 * This replaces the industry_insight parameter used in regular content.
 *
 * @param {object} details - Emergency details from conversation flow.
 * @returns {string} Formatted context string.
 */
function buildEmergencyContext(details) {
  const parts = [`URGENTE - POST DE EMERGENCIA`];

  if (details.topic) {
    parts.push(`Tema: ${details.topic}`);
  }

  if (details.priceOrSchedule) {
    parts.push(`Detalles: ${details.priceOrSchedule}`);
  }

  parts.push('Tono: URGENCIA, call to action fuerte, publicar YA.');
  parts.push('Maximo 150 caracteres + 5 hashtags relevantes.');

  return parts.join('\n');
}
