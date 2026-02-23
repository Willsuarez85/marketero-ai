import 'dotenv/config';
import express from 'express';
import { healthCheck } from './db/client.js';
import { ghlWebhookRouter } from './webhooks/ghl.js';
import { stripeWebhookRouter } from './webhooks/stripe.js';
import { startScheduler } from './content/scheduler.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Raw body parsing for webhook routes that need signature verification.
// This MUST be registered before express.json() so it captures the raw Buffer.
app.use('/webhooks/ghl', express.raw({ type: 'application/json' }));
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes.
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — verifies Supabase connectivity
app.get('/health', async (_req, res) => {
  try {
    const supabaseOk = await healthCheck();
    res.json({
      status: supabaseOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      supabase: supabaseOk,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      supabase: false,
      error: err.message,
    });
  }
});

// GoHighLevel webhook receiver (signature-verified, saves to DB)
app.use('/webhooks/ghl', ghlWebhookRouter);

// Stripe webhook receiver (signature-verified, processes subscription events)
app.use('/webhooks/stripe', stripeWebhookRouter);

// Review queue — replaced by operator review via WhatsApp (src/bot/operator.js)

// ---------------------------------------------------------------------------
// Error handling middleware
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] Marketero AI running on port ${PORT}`);
  console.log(`[server] Health:        ${BASE_URL}/health`);
  console.log(`[server] GHL webhook:   ${BASE_URL}/webhooks/ghl`);
  console.log(`[server] Stripe webhook:${BASE_URL}/webhooks/stripe`);

  // Start the daily content scheduler
  startScheduler();
  console.log('[server] Scheduler started');
});

export default app;
