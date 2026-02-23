import 'dotenv/config';
import express from 'express';
import { healthCheck } from './db/client.js';
import { ghlWebhookRouter } from './webhooks/ghl.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Raw body parsing for webhook routes that need signature verification.
// This MUST be registered before express.json() so it captures the raw Buffer.
app.use('/webhooks/ghl', express.raw({ type: 'application/json' }));

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

// Stripe webhook receiver — placeholder
app.post('/webhooks/stripe', (_req, res) => {
  // TODO: verify Stripe signature and process events
  res.status(200).json({ received: true });
});

// Review queue — minimal UI placeholder
app.get('/review-queue', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="utf-8"><title>Marketero — Review Queue</title></head>
    <body style="font-family:system-ui,sans-serif;padding:2rem;">
      <h1>Review Queue</h1>
      <p>Coming Day 7</p>
    </body>
    </html>
  `);
});

// Approve / reject — not implemented yet
app.post('/review-queue/:id/approve', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — coming Day 7' });
});

app.post('/review-queue/:id/reject', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — coming Day 7' });
});

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
  console.log(`[server] Review queue:  ${BASE_URL}/review-queue`);
});

export default app;
