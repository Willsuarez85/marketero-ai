import 'dotenv/config';
import { getPendingWebhooks, markWebhookProcessed, markWebhookFailed } from './db/queries/webhooks.js';
import { findRestaurantByPhone } from './db/queries/restaurants.js';
import { logMessage } from './db/queries/whatsapp.js';
import { getPendingJobs, claimJob, completeJob, failJob } from './db/queries/jobs.js';
import { classifyIntent } from './bot/classifier.js';
import { routeMessage } from './bot/conversation.js';
import { sendWhatsAppMessage } from './services/ghl.js';
import { generateDailyContent } from './content/generate.js';
import { publishContent } from './content/publish.js';

const WEBHOOK_INTERVAL = parseInt(process.env.WEBHOOK_WORKER_INTERVAL_MS, 10) || 5000;
const JOB_INTERVAL = parseInt(process.env.JOB_POLLER_INTERVAL_MS, 10) || 60000;

let running = true;

// ---------------------------------------------------------------------------
// Helpers — extract message fields from GHL webhook payload
// ---------------------------------------------------------------------------

/**
 * Extracts a normalized message object from a GHL webhook payload.
 * GHL sends data in various shapes depending on event type; this function
 * tries multiple known field names for each piece of data.
 */
function extractMessageData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { phone: null, message: null, mediaUrl: null, mediaType: 'text', contactId: null };
  }

  const phone = payload.phone || payload.contactPhone || payload.from || null;
  const message = payload.body || payload.message || payload.text || null;
  const mediaUrl = payload.mediaUrl || payload.attachmentUrl || null;

  // Determine media type from explicit payload hints or from the URL
  let mediaType = 'text';
  if (mediaUrl) {
    if (
      payload.type === 'audio' ||
      payload.messageType === 'audio' ||
      payload.contentType?.startsWith('audio/')
    ) {
      mediaType = 'audio';
    } else if (
      payload.type === 'image' ||
      payload.messageType === 'image' ||
      payload.contentType?.startsWith('image/')
    ) {
      mediaType = 'image';
    } else {
      // Fallback: guess from URL extension
      const lower = mediaUrl.toLowerCase();
      if (lower.match(/\.(ogg|opus|mp3|m4a|wav|aac)(\?|$)/)) {
        mediaType = 'audio';
      } else if (lower.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/)) {
        mediaType = 'image';
      }
    }
  }

  const contactId = payload.contactId || payload.contact_id || null;

  return { phone, message, mediaUrl, mediaType, contactId };
}

// ---------------------------------------------------------------------------
// Webhook processor
// ---------------------------------------------------------------------------
async function processWebhooks() {
  if (!running) return;

  try {
    const events = await getPendingWebhooks(20);

    if (!events || events.length === 0) return;

    console.log(`[worker/webhooks] processing ${events.length} event(s)`);

    for (const event of events) {
      try {
        const payload = event.payload || {};
        const { phone, message, mediaUrl, mediaType, contactId } = extractMessageData(payload);

        console.log(
          `[worker/webhooks] event ${event.id} — type: ${event.event_type || 'unknown'}, phone: ${phone || 'none'}`,
        );

        if (phone) {
          // Look up which restaurant owns this phone number
          const restaurant = await findRestaurantByPhone(phone);

          if (restaurant) {
            // Log the inbound message
            const inboundLog = await logMessage({
              restaurant_id: restaurant.id,
              ghl_event_id: event.ghl_event_id || null,
              direction: 'inbound',
              message: message || null,
              media_url: mediaUrl || null,
              media_type: mediaType,
            });

            console.log(
              `[worker/webhooks] logged inbound message for restaurant ${restaurant.id} (${restaurant.name || restaurant.id})`,
            );

            // Classify the intent
            const intent = await classifyIntent(message || '');

            console.log(
              `[worker/webhooks] classified intent: ${intent.intent} (confidence: ${intent.confidence}, method: ${intent.method})`,
            );

            // Update the whatsapp_log entry with the classified intent
            if (inboundLog?.id) {
              try {
                const { supabase } = await import('./db/client.js');
                if (supabase) {
                  await supabase
                    .from('whatsapp_log')
                    .update({ intent: intent.intent })
                    .eq('id', inboundLog.id);
                }
              } catch (intentLogErr) {
                console.error('[worker/webhooks] failed to update log with intent:', intentLogErr.message);
              }
            }

            // Route the message
            const result = await routeMessage(
              restaurant,
              { message, mediaUrl, mediaType, contactId, ghlEventId: event.ghl_event_id },
              intent,
            );

            console.log(
              `[worker/webhooks] route result: action=${result.action}`,
            );

            // Send the response back via WhatsApp
            if (result.response && contactId) {
              await sendWhatsAppMessage(contactId, result.response);

              // Log the outbound message
              await logMessage({
                restaurant_id: restaurant.id,
                ghl_event_id: event.ghl_event_id || null,
                direction: 'outbound',
                message: result.response,
                media_url: null,
                media_type: 'text',
              });

              console.log(
                `[worker/webhooks] sent outbound reply for restaurant ${restaurant.id}: action=${result.action}`,
              );
            }
          } else {
            console.warn(
              `[worker/webhooks] no restaurant found for phone ${phone} — event ${event.id} will be marked processed without routing`,
            );
          }
        } else {
          console.warn(
            `[worker/webhooks] event ${event.id} has no phone number in payload — skipping routing`,
          );
        }

        // Always mark as processed, even when no restaurant matched
        await markWebhookProcessed(event.id);
      } catch (err) {
        console.error(`[worker/webhooks] error processing event ${event.id}:`, err.message);

        try {
          await markWebhookFailed(event.id, err.message, (event.attempts || 0) + 1);
        } catch (markErr) {
          console.error(`[worker/webhooks] failed to mark event ${event.id} as failed:`, markErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[worker/webhooks] unexpected error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Scheduled job processor
// ---------------------------------------------------------------------------
async function processJobs() {
  if (!running) return;

  try {
    const jobs = await getPendingJobs(10);

    if (!jobs || jobs.length === 0) return;

    console.log(`[worker/jobs] found ${jobs.length} pending job(s)`);

    for (const job of jobs) {
      try {
        // Optimistic lock — claim the job; returns null if another worker got it first
        const claimed = await claimJob(job.id);

        if (!claimed) {
          console.log(`[worker/jobs] job ${job.id} already claimed by another worker`);
          continue;
        }

        console.log(`[worker/jobs] executing job ${job.id} — type: ${job.job_type || 'unknown'}`);

        switch (job.job_type) {
          case 'daily_content': {
            const result = await generateDailyContent(job.restaurant_id);
            console.log(
              `[worker/jobs] daily_content job ${job.id} result: success=${result.success}` +
              (result.contentId ? `, contentId=${result.contentId}` : '') +
              (result.error ? `, error=${result.error}` : ''),
            );
            break;
          }

          case 'publish_buffer': {
            const { content_id } = job.metadata || {};

            if (!content_id) {
              console.error(`[worker/jobs] publish_buffer job ${job.id} missing content_id in metadata`);
              break;
            }

            const publishResult = await publishContent(content_id);
            console.log(
              `[worker/jobs] publish_buffer job ${job.id} result: success=${publishResult.success}` +
              (publishResult.ghlPostId ? `, ghlPostId=${publishResult.ghlPostId}` : '') +
              (publishResult.error ? `, error=${publishResult.error}` : ''),
            );
            break;
          }

          default:
            console.warn(`[worker/jobs] unknown job type "${job.job_type}" for job ${job.id} — completing without action`);
            break;
        }

        await completeJob(job.id);
      } catch (err) {
        console.error(`[worker/jobs] error executing job ${job.id}:`, err.message);

        try {
          await failJob(job.id, err.message, (job.attempts || 0) + 1);
        } catch (markErr) {
          console.error(`[worker/jobs] failed to mark job ${job.id} as failed:`, markErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[worker/jobs] unexpected error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Interval loops
// ---------------------------------------------------------------------------
const webhookTimer = setInterval(processWebhooks, WEBHOOK_INTERVAL);
const jobTimer = setInterval(processJobs, JOB_INTERVAL);

// Run once immediately on startup
processWebhooks();
processJobs();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`[worker] received ${signal}, shutting down gracefully…`);
  running = false;
  clearInterval(webhookTimer);
  clearInterval(jobTimer);
  // Allow in-flight work a moment to finish
  setTimeout(() => {
    console.log('[worker] shutdown complete');
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Startup log
// ---------------------------------------------------------------------------
console.log('[worker] Marketero AI background worker started');
console.log(`[worker] Webhook poll interval: ${WEBHOOK_INTERVAL}ms`);
console.log(`[worker] Job poll interval:     ${JOB_INTERVAL}ms`);
