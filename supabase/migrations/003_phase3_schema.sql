-- Marketero AI — Phase 3 Schema Changes
-- Migration 003: Autopilot, emergency, FAQ, Stripe, escalation support
-- Date: 2026-02-23

-- ============================================================
-- 1. ALTER restaurants — add churn tracking
-- ============================================================
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS churn_reason TEXT;

-- ============================================================
-- 2. ALTER subscriptions — add cancellation tracking
-- ============================================================
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 3. ALTER content_items — change request + cancel tracking
-- ============================================================
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS change_request_text TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ============================================================
-- 4. ALTER scheduled_jobs — expand job_type CHECK for Phase 3
-- ============================================================
ALTER TABLE scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_job_type_check;
ALTER TABLE scheduled_jobs ADD CONSTRAINT scheduled_jobs_job_type_check
    CHECK (job_type IN (
        'daily_content', 'autopilot_publish', 'autopilot_reminder',
        'reminder', 'bridge_nurture', 'publish_buffer',
        'consolidate_brain', 'agent_self_review', 'emergency_post'
    ));

-- ============================================================
-- 5. New indexes for Phase 3 queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_content_pending_client
    ON content_items(restaurant_id, created_at DESC)
    WHERE status = 'pending_client';

CREATE INDEX IF NOT EXISTS idx_subscriptions_active
    ON subscriptions(status)
    WHERE status != 'canceled';

CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant
    ON subscriptions(restaurant_id);
