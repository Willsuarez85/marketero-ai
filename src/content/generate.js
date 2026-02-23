// ---------------------------------------------------------------------------
// src/content/generate.js  --  Content pipeline: caption + image generation
// ---------------------------------------------------------------------------

import { getRestaurantWithBrain } from '../db/queries/restaurants.js';
import { createContentItem, updateContentStatus } from '../db/queries/content.js';
import { generateCaption, generateImagePrompt } from '../services/claude.js';
import { generateImage } from '../services/fal.js';

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Generates a social media post (caption + image) for a restaurant.
 *
 * Pipeline:
 *   1. Load restaurant + brain
 *   2. Create content item (status = 'generating')
 *   3. Generate caption & image prompt in parallel (Claude)
 *   4. Generate image (fal.ai)
 *   5. Transition content item to 'human_review'
 *
 * @param {string} restaurantId - UUID of the restaurant.
 * @param {string} [contentType='dish'] - The type of content to generate.
 * @returns {Promise<object>} Result object with success flag and content details.
 */
export async function generateContent(restaurantId, contentType = 'dish') {
  let contentItem = null;

  try {
    // ------------------------------------------------------------------
    // 1. Load restaurant + brain
    // ------------------------------------------------------------------
    console.log(`[content:generate] Starting content generation for restaurant ${restaurantId} (type: ${contentType})`);

    let restaurant;
    try {
      restaurant = await getRestaurantWithBrain(restaurantId);
    } catch (err) {
      console.error(`[content:generate] Failed to load restaurant ${restaurantId}:`, err.message);
      throw new Error(`Failed to load restaurant: ${err.message}`);
    }

    if (!restaurant) {
      console.error(`[content:generate] Restaurant ${restaurantId} not found`);
      throw new Error(`Restaurant ${restaurantId} not found`);
    }

    console.log(`[content:generate] Loaded restaurant: ${restaurant.name || restaurantId}`);

    // ------------------------------------------------------------------
    // 2. Create content item (status = 'generating')
    // ------------------------------------------------------------------
    try {
      contentItem = await createContentItem({
        restaurant_id: restaurantId,
        content_type: contentType,
      });
    } catch (err) {
      console.error(`[content:generate] Failed to create content item:`, err.message);
      throw new Error(`Failed to create content item: ${err.message}`);
    }

    if (!contentItem) {
      console.error(`[content:generate] createContentItem returned null for restaurant ${restaurantId}`);
      throw new Error('Failed to create content item — database returned null');
    }

    console.log(`[content:generate] Created content item ${contentItem.id}`);

    // ------------------------------------------------------------------
    // 3. Generate caption & image prompt in parallel
    // ------------------------------------------------------------------
    let caption = null;
    let imagePrompt = null;

    try {
      console.log(`[content:generate] Generating caption and image prompt in parallel...`);

      [caption, imagePrompt] = await Promise.all([
        generateCaption(restaurant, contentType, restaurant.brain),
        generateImagePrompt(restaurant, contentType, restaurant.brain),
      ]);
    } catch (err) {
      console.error(`[content:generate] Error during parallel generation:`, err.message);
    }

    console.log(`[content:generate] Caption: ${caption ? 'OK' : 'FAILED'}, Image prompt: ${imagePrompt ? 'OK' : 'FAILED'}`);

    // ------------------------------------------------------------------
    // 4. If caption failed, mark as failed and bail
    // ------------------------------------------------------------------
    if (!caption) {
      console.error(`[content:generate] Caption generation failed for content ${contentItem.id}`);
      try {
        await updateContentStatus(contentItem.id, 'failed');
      } catch (statusErr) {
        console.error(`[content:generate] Failed to update status to 'failed':`, statusErr.message);
      }
      return { success: false, error: 'caption_failed' };
    }

    // ------------------------------------------------------------------
    // 5. Generate image (fal.ai)
    // ------------------------------------------------------------------
    let imageUrl = null;

    if (imagePrompt) {
      try {
        console.log(`[content:generate] Generating image with fal.ai...`);
        const imageResult = await generateImage(imagePrompt);

        if (imageResult && imageResult.imageUrl) {
          imageUrl = imageResult.imageUrl;
          console.log(`[content:generate] Image generated: ${imageUrl}`);
        } else {
          console.warn(`[content:generate] Image generation returned no URL — proceeding without image`);
        }
      } catch (err) {
        console.error(`[content:generate] Image generation failed:`, err.message);
        console.warn(`[content:generate] Proceeding without image for content ${contentItem.id}`);
      }
    } else {
      console.warn(`[content:generate] No image prompt available — skipping image generation`);
    }

    // ------------------------------------------------------------------
    // 6. Update content item -> 'human_review'
    // ------------------------------------------------------------------
    try {
      await updateContentStatus(contentItem.id, 'human_review', {
        caption,
        image_url: imageUrl,
        image_prompt: imagePrompt,
      });
      console.log(`[content:generate] Content ${contentItem.id} moved to 'human_review'`);
    } catch (err) {
      console.error(`[content:generate] Failed to update content to 'human_review':`, err.message);
      // Attempt to mark as failed since we couldn't transition properly
      try {
        await updateContentStatus(contentItem.id, 'failed');
      } catch (failErr) {
        console.error(`[content:generate] Also failed to mark as 'failed':`, failErr.message);
      }
      return { success: false, error: 'update_failed' };
    }

    // ------------------------------------------------------------------
    // 7. Return success
    // ------------------------------------------------------------------
    console.log(`[content:generate] Content generation complete for ${contentItem.id}`);

    return {
      success: true,
      contentId: contentItem.id,
      caption,
      imageUrl,
      imagePrompt,
    };
  } catch (err) {
    // ------------------------------------------------------------------
    // Total failure — update content status if we have an item
    // ------------------------------------------------------------------
    console.error(`[content:generate] Total failure for restaurant ${restaurantId}:`, err.message);

    if (contentItem?.id) {
      try {
        await updateContentStatus(contentItem.id, 'failed');
        console.log(`[content:generate] Marked content ${contentItem.id} as 'failed'`);
      } catch (statusErr) {
        console.error(`[content:generate] Failed to mark content as 'failed':`, statusErr.message);
      }
    }

    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Daily content wrapper (used by scheduler)
// ---------------------------------------------------------------------------

/**
 * Generates daily dish content for a restaurant.
 * Convenience wrapper around generateContent used by the daily scheduler.
 *
 * @param {string} restaurantId - UUID of the restaurant.
 * @returns {Promise<object>} Result from generateContent.
 */
export async function generateDailyContent(restaurantId) {
  console.log(`[content:generate] Daily content generation triggered for restaurant ${restaurantId}`);
  return generateContent(restaurantId, 'dish');
}
