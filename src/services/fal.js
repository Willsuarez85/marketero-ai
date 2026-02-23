// ---------------------------------------------------------------------------
// src/services/fal.js  --  Thin fal.ai REST client (image generation)
// ---------------------------------------------------------------------------

import pLimit from 'p-limit';

const FAL_KEY             = process.env.FAL_KEY;
const CONCURRENCY_LIMIT   = Number(process.env.FAL_CONCURRENCY_LIMIT) || 3;
const QUEUE_URL           = 'https://queue.fal.run/fal-ai/nano-banana-pro';
const POLL_INTERVAL_MS    = 3_000;
const POLL_TIMEOUT_MS     = 120_000;

const limit = pLimit(CONCURRENCY_LIMIT);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const authHeaders = () => ({
  Authorization:  `Key ${FAL_KEY}`,
  'Content-Type': 'application/json',
});

// ---------------------------------------------------------------------------
// Internal: submit a generation request to the fal.ai queue
// ---------------------------------------------------------------------------

async function submitToQueue(prompt, options = {}) {
  const res = await fetch(QUEUE_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      prompt,
      image_size:            options.imageSize || 'landscape_4_3',
      num_images:            1,
      enable_safety_checker: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Queue submit failed – ${res.status} ${res.statusText}: ${text}`);
  }

  return res.json(); // { request_id, response_url, status_url }
}

// ---------------------------------------------------------------------------
// Internal: poll status_url until COMPLETED or FAILED (max 120 s)
// ---------------------------------------------------------------------------

async function pollUntilDone(statusUrl) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(statusUrl, { headers: authHeaders() });

    if (!res.ok) {
      throw new Error(`Status poll failed – ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (data.status === 'COMPLETED') return data;
    if (data.status === 'FAILED') {
      throw new Error(`Generation failed: ${data.error || 'unknown error'}`);
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Generation timed out after 120 s');
}

// ---------------------------------------------------------------------------
// Internal: fetch the final result from response_url
// ---------------------------------------------------------------------------

async function fetchResult(responseUrl) {
  const res = await fetch(responseUrl, { headers: authHeaders() });

  if (!res.ok) {
    throw new Error(`Result fetch failed – ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Internal: single attempt (submit → poll → fetch result)
// ---------------------------------------------------------------------------

async function attemptGeneration(prompt, options) {
  const queued = await submitToQueue(prompt, options);
  await pollUntilDone(queued.status_url);
  const result = await fetchResult(queued.response_url);

  const imageUrl = result?.images?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL in response');

  return { imageUrl, requestId: queued.request_id };
}

// ---------------------------------------------------------------------------
// 1. generateImage – public, concurrency-limited, retries once on failure
// ---------------------------------------------------------------------------

export async function generateImage(prompt, options = {}) {
  try {
    return await limit(async () => {
      try {
        return await attemptGeneration(prompt, options);
      } catch (firstErr) {
        console.error('[services:fal] generateImage first attempt failed:', firstErr.message || firstErr);

        // Retry once
        try {
          return await attemptGeneration(prompt, options);
        } catch (retryErr) {
          console.error('[services:fal] generateImage retry failed:', retryErr.message || retryErr);
          return null;
        }
      }
    });
  } catch (err) {
    console.error('[services:fal] generateImage error:', err.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. checkImageStatus – lookup status for an existing request
// ---------------------------------------------------------------------------

export async function checkImageStatus(requestId) {
  try {
    const statusUrl = `${QUEUE_URL}/requests/${requestId}/status`;
    const res = await fetch(statusUrl, { headers: authHeaders() });

    if (!res.ok) {
      console.error(`[services:fal] checkImageStatus failed – ${res.status} ${res.statusText}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error('[services:fal] checkImageStatus error:', err.message || err);
    return null;
  }
}
