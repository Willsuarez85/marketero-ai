import { Router } from 'express';
import crypto from 'node:crypto';
import { saveRawWebhook } from '../db/queries/webhooks.js';

const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET;

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify GHL webhook signature (HMAC SHA256).
 * Compares the computed HMAC of the raw body against the `x-ghl-signature` header.
 * @param {Buffer} rawBody - The raw request body as a Buffer.
 * @param {string} signature - The signature from the x-ghl-signature header.
 * @returns {boolean} True if the signature is valid.
 */
function verifySignature(rawBody, signature) {
  if (!GHL_WEBHOOK_SECRET) {
    console.warn('[webhook/ghl] GHL_WEBHOOK_SECRET not set — skipping signature verification');
    return true; // Allow in dev; in production this env var must be set
  }

  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', GHL_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  } catch {
    // Lengths differ — signatures don't match
    return false;
  }
}

// ---------------------------------------------------------------------------
// Extract a unique event ID from the GHL payload
// ---------------------------------------------------------------------------

/**
 * Extracts the GHL event ID from the webhook payload.
 * GHL sends different shapes depending on the event type.
 * @param {object} body - The parsed JSON payload.
 * @returns {string|null} The event ID, or null if none found.
 */
function extractEventId(body) {
  return body.id || body.messageId || body.eventId || null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ghlWebhookRouter = Router();

// Use express.raw() so we receive the body as a Buffer for signature verification.
// JSON is parsed manually after the signature check.
ghlWebhookRouter.post(
  '/',
  // No additional middleware needed — express.raw() is applied at the mount
  // point in server.js so req.body is already a Buffer.
  async (req, res) => {
    try {
      // -----------------------------------------------------------------------
      // 1. Verify signature
      // -----------------------------------------------------------------------
      const rawBody = req.body; // Buffer from express.raw()
      const signature = req.headers['x-ghl-signature'];

      if (!verifySignature(rawBody, signature)) {
        console.warn('[webhook/ghl] invalid signature — rejecting request');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // -----------------------------------------------------------------------
      // 2. Parse JSON from raw body
      // -----------------------------------------------------------------------
      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch (parseErr) {
        console.error('[webhook/ghl] malformed JSON body:', parseErr.message);
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      // -----------------------------------------------------------------------
      // 3. Extract event ID for idempotency
      // -----------------------------------------------------------------------
      const ghlEventId = extractEventId(payload);
      if (!ghlEventId) {
        console.warn('[webhook/ghl] no event ID found in payload — saving with generated ID');
      }

      // Use a deterministic fallback so duplicate payloads without an ID still
      // get deduplicated (hash of the payload).
      const effectiveId =
        ghlEventId ||
        crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 36);

      // -----------------------------------------------------------------------
      // 4. Respond 200 immediately — GHL will retry on non-2xx
      // -----------------------------------------------------------------------
      res.status(200).json({ received: true });

      // -----------------------------------------------------------------------
      // 5. Save raw payload (async, after response)
      // -----------------------------------------------------------------------
      const result = await saveRawWebhook(effectiveId, payload);

      if (result?.duplicate) {
        console.log(`[webhook/ghl] duplicate event ${effectiveId} — skipped`);
        return;
      }

      if (!result) {
        console.error(`[webhook/ghl] failed to save event ${effectiveId}`);
        return;
      }

      // -----------------------------------------------------------------------
      // 6. Log for visibility (truncated)
      // -----------------------------------------------------------------------
      const truncated = JSON.stringify(payload).slice(0, 200);
      console.log(`[webhook/ghl] saved event ${effectiveId} (row ${result.id}): ${truncated}`);
    } catch (err) {
      // Never fail silently — log the error. The 200 may already have been sent,
      // so we cannot change the status code here.
      console.error('[webhook/ghl] unexpected error:', err);

      // If the response hasn't been sent yet, return 500
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);
