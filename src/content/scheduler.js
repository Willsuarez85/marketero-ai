// ---------------------------------------------------------------------------
// src/content/scheduler.js  --  Daily content job scheduler (node-cron)
// ---------------------------------------------------------------------------
// Runs hourly to create daily_content jobs for active restaurants.
// Respects each restaurant's timezone for scheduling.
// ---------------------------------------------------------------------------

import cron from 'node-cron';
import { getActiveRestaurants } from '../db/queries/restaurants.js';
import { createJob, hasPendingJob } from '../db/queries/jobs.js';

const DEFAULT_DELIVERY_HOUR = 9; // 9 AM local time

// ---------------------------------------------------------------------------
// Compute next delivery time for a restaurant based on its timezone
// ---------------------------------------------------------------------------

function getNextDeliveryTime(timezone = 'America/New_York', hour = DEFAULT_DELIVERY_HOUR) {
  const now = new Date();

  // Get the current time in the restaurant's timezone
  const localStr = now.toLocaleString('en-US', { timeZone: timezone });
  const localNow = new Date(localStr);

  // Build target date: today at `hour`:00 in the restaurant's TZ
  const target = new Date(localNow);
  target.setHours(hour, 0, 0, 0);

  // If that time has already passed today, schedule for tomorrow
  if (target <= localNow) {
    target.setDate(target.getDate() + 1);
  }

  // Convert back to UTC by computing the offset
  const utcTarget = new Date(
    target.getTime() + (target.getTime() - new Date(target.toLocaleString('en-US', { timeZone: timezone })).getTime())
  );

  // Fallback: if timezone math fails, just use tomorrow 9 AM UTC
  if (isNaN(utcTarget.getTime())) {
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(hour, 0, 0, 0);
    return fallback.toISOString();
  }

  return utcTarget.toISOString();
}

// ---------------------------------------------------------------------------
// Create daily_content jobs for all active restaurants (skip if pending)
// ---------------------------------------------------------------------------

export async function scheduleDailyContent() {
  try {
    const restaurants = await getActiveRestaurants();

    if (restaurants.length === 0) {
      return { created: 0, skipped: 0 };
    }

    let created = 0;
    let skipped = 0;

    for (const restaurant of restaurants) {
      const hasPending = await hasPendingJob(restaurant.id, 'daily_content');

      if (hasPending) {
        skipped++;
        continue;
      }

      const scheduledFor = getNextDeliveryTime(restaurant.timezone || 'America/New_York');
      const job = await createJob(restaurant.id, 'daily_content', scheduledFor, {
        source: 'scheduler',
      });

      if (job) {
        created++;
        console.log(`[scheduler] Created daily_content job for ${restaurant.name || restaurant.id} at ${scheduledFor}`);
      }
    }

    console.log(`[scheduler] Daily content: ${created} created, ${skipped} skipped (already pending)`);
    return { created, skipped };
  } catch (err) {
    console.error('[scheduler] Error in scheduleDailyContent:', err.message);
    return { created: 0, skipped: 0 };
  }
}

// ---------------------------------------------------------------------------
// Start the cron scheduler
// ---------------------------------------------------------------------------

export function startScheduler() {
  // Every hour — check and create missing jobs
  cron.schedule('0 * * * *', async () => {
    console.log('[scheduler] Hourly check — scheduling daily content');
    await scheduleDailyContent();
  });

  // Midnight UTC — generate jobs for the next day
  cron.schedule('0 0 * * *', async () => {
    console.log('[scheduler] Midnight UTC — scheduling next-day content');
    await scheduleDailyContent();
  });

  // Run once on startup
  scheduleDailyContent();

  console.log('[scheduler] Cron scheduler started (hourly + midnight UTC)');
}
