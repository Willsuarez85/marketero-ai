-- Marketero AI — Initial Schema
-- 11 tables + 16 indexes
-- Date: 2026-02-22

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE 1: restaurants
-- Core table — no foreign-key dependencies
-- ============================================================
CREATE TABLE restaurants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL,
    phone_owner         TEXT UNIQUE NOT NULL,
    email_owner         TEXT,
    city                TEXT,
    cuisine_type        TEXT,
    timezone            TEXT DEFAULT 'America/New_York',
    gmb_place_id        TEXT,
    instagram_handle    TEXT,
    facebook_page_id    TEXT,
    ghl_sub_account_id  TEXT,
    status              TEXT DEFAULT 'onboarding'
                        CHECK (status IN ('onboarding','active','paused','churned')),
    delivery_mode       TEXT DEFAULT 'daily'
                        CHECK (delivery_mode IN ('daily','weekly')),
    autopilot           BOOLEAN DEFAULT FALSE,
    tier                TEXT DEFAULT '$99',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: authorized_contacts
-- Depends on: restaurants
-- ============================================================
CREATE TABLE authorized_contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    phone           TEXT NOT NULL,
    name            TEXT,
    role            TEXT DEFAULT 'owner'
                    CHECK (role IN ('owner','manager','staff')),
    is_primary      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (phone)
);

-- ============================================================
-- TABLE 3: client_brains
-- Depends on: restaurants (one-to-one)
-- ============================================================
CREATE TABLE client_brains (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id       UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    brand_voice         TEXT,
    menu_items          JSONB DEFAULT '[]',
    visual_profile      JSONB DEFAULT '{}',
    photo_library       JSONB DEFAULT '[]',
    monthly_goals       TEXT,
    performance_notes   TEXT,
    onboarding_session  INTEGER DEFAULT 0,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 4: content_items
-- Depends on: restaurants
-- ============================================================
CREATE TABLE content_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id       UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    caption             TEXT,
    image_url           TEXT,
    image_prompt        TEXT,
    platform            TEXT[] DEFAULT '{instagram,facebook}',
    content_type        TEXT DEFAULT 'dish'
                        CHECK (content_type IN ('dish','offer','cultural','emergency')),
    status              TEXT DEFAULT 'generating'
                        CHECK (status IN ('generating','human_review','pending_client',
                                          'approved','published','failed',
                                          'publish_failed','cancelled')),
    human_feedback      TEXT,
    human_approved_at   TIMESTAMPTZ,
    client_approved_at  TIMESTAMPTZ,
    scheduled_at        TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    publish_deadline    TIMESTAMPTZ,
    ghl_post_id         TEXT,
    engagement          JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 5: whatsapp_log
-- Depends on: restaurants, content_items
-- ============================================================
CREATE TABLE whatsapp_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    ghl_event_id    TEXT UNIQUE,
    content_item_id UUID REFERENCES content_items(id),
    direction       TEXT NOT NULL
                    CHECK (direction IN ('inbound','outbound')),
    message         TEXT,
    media_url       TEXT,
    media_type      TEXT
                    CHECK (media_type IN ('text','image','audio','document')),
    transcription   TEXT,
    intent          TEXT
                    CHECK (intent IN ('approval','rejection','faq','emergency',
                                      'escalation','change_request','cancel','other')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 6: conversation_state
-- Depends on: restaurants (one-to-one)
-- ============================================================
CREATE TABLE conversation_state (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    current_flow    TEXT,
    flow_step       INTEGER DEFAULT 0,
    flow_data       JSONB DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: scheduled_jobs
-- Depends on: restaurants
-- ============================================================
CREATE TABLE scheduled_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    job_type        TEXT NOT NULL
                    CHECK (job_type IN ('daily_content','autopilot_publish',
                                        'reminder','bridge_nurture','publish_buffer')),
    scheduled_for   TIMESTAMPTZ NOT NULL,
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
    attempts        INTEGER DEFAULT 0,
    last_error      TEXT,
    metadata        JSONB DEFAULT '{}',
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 8: webhook_raw_log
-- No foreign-key dependencies
-- ============================================================
CREATE TABLE webhook_raw_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ghl_event_id    TEXT UNIQUE,
    payload         JSONB NOT NULL,
    status          TEXT DEFAULT 'received'
                    CHECK (status IN ('received','processed','failed')),
    error_message   TEXT,
    attempts        INTEGER DEFAULT 0,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 9: subscriptions
-- Depends on: restaurants (one-to-one)
-- ============================================================
CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id           UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    status                  TEXT DEFAULT 'active'
                            CHECK (status IN ('active','past_due','canceled','paused')),
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 10: leads
-- Depends on: restaurants (optional FK via referred_by)
-- ============================================================
CREATE TABLE leads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_name     TEXT,
    phone               TEXT,
    email               TEXT,
    source              TEXT DEFAULT 'manual'
                        CHECK (source IN ('manual','referral','door_to_door',
                                          'facebook_group','cold_whatsapp')),
    referred_by         UUID REFERENCES restaurants(id),
    gmb_place_id        TEXT,
    gmb_photos          JSONB DEFAULT '[]',
    enhanced_photos     JSONB DEFAULT '[]',
    stage               TEXT DEFAULT 'new'
                        CHECK (stage IN ('new','contacted','demo_given',
                                         'photoshoot_sent','tripwire_sent',
                                         'bridge','converted','dead')),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 11: industry_brain
-- No foreign-key dependencies
-- ============================================================
CREATE TABLE industry_brain (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category        TEXT
                    CHECK (category IN ('promotion','content','seasonal','trend')),
    insight         TEXT NOT NULL,
    cuisine_type    TEXT DEFAULT 'mexican',
    season          TEXT DEFAULT 'all',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES (16 total)
-- ============================================================

-- restaurants
CREATE INDEX idx_restaurants_status       ON restaurants(status);
CREATE INDEX idx_restaurants_phone        ON restaurants(phone_owner);

-- authorized_contacts
CREATE INDEX idx_authorized_phone         ON authorized_contacts(phone);
CREATE INDEX idx_authorized_restaurant    ON authorized_contacts(restaurant_id);

-- content_items
CREATE INDEX idx_content_restaurant_status  ON content_items(restaurant_id, status);
CREATE INDEX idx_content_scheduled          ON content_items(scheduled_at)
    WHERE status = 'approved';
CREATE INDEX idx_content_publish_deadline   ON content_items(publish_deadline)
    WHERE status = 'approved';

-- whatsapp_log
CREATE INDEX idx_whatsapp_restaurant      ON whatsapp_log(restaurant_id, created_at DESC);
CREATE INDEX idx_whatsapp_ghl_event       ON whatsapp_log(ghl_event_id);

-- leads
CREATE INDEX idx_leads_stage              ON leads(stage);
CREATE INDEX idx_leads_source             ON leads(source);

-- scheduled_jobs
CREATE INDEX idx_jobs_pending             ON scheduled_jobs(scheduled_for)
    WHERE status = 'pending';
CREATE INDEX idx_jobs_restaurant          ON scheduled_jobs(restaurant_id, status);

-- webhook_raw_log
CREATE INDEX idx_webhook_raw_status       ON webhook_raw_log(status, created_at);

-- conversation_state
CREATE INDEX idx_conversation_restaurant  ON conversation_state(restaurant_id);

-- subscriptions
CREATE INDEX idx_subscriptions_stripe     ON subscriptions(stripe_subscription_id);
