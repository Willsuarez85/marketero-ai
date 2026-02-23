# Marketero AI

> $99/month social media content service for Latino restaurants in the USA, delivered and approved 100% via WhatsApp.

## Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js 20+ / Express (ES modules) |
| Database | Supabase (PostgreSQL) |
| WhatsApp + Social Publishing | GoHighLevel (GHL) API |
| AI Images | fal.ai Nano Banana Pro |
| AI Copy + Classification | Claude API (Anthropic) |
| Voice Notes | OpenAI Whisper |
| Payments | Stripe |

## Architecture

```
WhatsApp message
    ↓
GHL Webhook → POST /webhooks/ghl
    ↓
Signature verification + raw save (webhook_raw_log)
    ↓ (async)
Background Worker (every 5s)
    ↓
Extract phone → Find restaurant → Log message
    ↓
Hybrid Intent Classifier (regex first, Claude fallback)
    ↓
Conversation Router → Intent Handler
    ↓
Response via WhatsApp
```

**Content Pipeline:**
```
Scheduled Job (daily_content)
    ↓
Claude generates caption + image prompt (parallel)
    ↓
fal.ai generates image
    ↓
Status: generating → human_review → pending_client → approved → published
    ↓
15-min buffer after approval (cancel window)
    ↓
GHL publishes to Instagram + Facebook
```

## Project Structure

```
src/
├── server.js                  # Express server + routes
├── worker.js                  # Background worker (webhooks + jobs)
├── bot/
│   ├── classifier.js          # Hybrid intent classifier (regex + Claude)
│   ├── conversation.js        # Conversation router + state management
│   └── handlers/
│       └── approval.js        # Post-approval handler
├── content/
│   ├── generate.js            # Content pipeline (Claude + fal.ai)
│   └── publish.js             # Publish pipeline (WhatsApp + GHL social)
├── db/
│   ├── client.js              # Supabase client
│   └── queries/
│       ├── content.js         # Content items + status machine
│       ├── conversation.js    # Conversation state (30-min expiry)
│       ├── jobs.js            # Scheduled jobs (optimistic locking)
│       ├── restaurants.js     # Restaurant + brain lookup
│       ├── webhooks.js        # Webhook raw log (idempotent)
│       └── whatsapp.js        # WhatsApp message log
├── services/
│   ├── claude.js              # Claude API (classify, caption, image prompt)
│   ├── fal.js                 # fal.ai image generation (queue + poll)
│   └── ghl.js                 # GHL API (WhatsApp, contacts, social)
└── webhooks/
    └── ghl.js                 # GHL webhook router (signature + save)

supabase/
└── migrations/
    └── 001_initial_schema.sql # 11 tables + 16 indexes
```

## Database Schema (11 tables)

| Table | Purpose |
|-------|---------|
| `restaurants` | Core restaurant profiles |
| `authorized_contacts` | Multiple phones per restaurant |
| `client_brains` | Brand voice, menu, visual profile |
| `content_items` | Generated posts + status machine |
| `whatsapp_log` | All inbound/outbound messages |
| `conversation_state` | Active flows (30-min expiry) |
| `scheduled_jobs` | Persistent job queue (survives restarts) |
| `webhook_raw_log` | Raw webhook payloads (idempotency) |
| `subscriptions` | Stripe payment tracking |
| `leads` | Acquisition pipeline (MIFGE) |
| `industry_brain` | Shared knowledge base |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Fill in your API keys

# 3. Run the Supabase migration
# Apply supabase/migrations/001_initial_schema.sql to your Supabase project

# 4. Start the server
npm run dev

# 5. Start the background worker (separate terminal)
npm run dev:worker
```

## Environment Variables

See `.env.example` for the full list. Key ones:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GHL_API_KEY` | GoHighLevel API key |
| `GHL_WEBHOOK_SECRET` | GHL webhook signature secret |
| `ANTHROPIC_API_KEY` | Claude API key |
| `FAL_KEY` | fal.ai API key |
| `OPENAI_API_KEY` | OpenAI API key (Whisper) |

## Intent Classification

The classifier recognizes 35+ Spanish/Spanglish approval patterns:

- **Text**: si, ok, dale, va, sale, listo, perfecto, publicalo, adelante, orale, andale, jalo, me gusta, me encanta...
- **Emoji**: ✅ ✔️ 👍 👌 🙌 💯 🔥 (with all skin tones)
- **Rejection**: no, nel, nah, cambialo, otra vez, feo, horrible, ❌ 👎
- **Cancel**: cancelar, stop, detener, no publiques
- **Escalation**: hablar con alguien, persona real, humano, soporte

Regex handles ~90% of messages in <1ms. Claude API fallback for ambiguous messages (10s timeout).

## Content Status Machine

```
generating → human_review → pending_client → approved → published
     ↓            ↓              ↓              ↓
   failed    generating     generating      cancelled
                                           publish_failed
```

## Build Progress

- [x] **Phase 1** — Foundation (Days 1-5): Webhook handler, intent classifier, content pipeline, publish flow
- [ ] **Phase 2** — Operations (Days 6-10): Scheduler, review queue, Whisper, onboarding
- [ ] **Phase 3** — Bot + Payments (Days 11-15): Autopilot, emergency posts, FAQ, Stripe
- [ ] **Phase 4** — Acquisition + Scale (Days 16-20): MIFGE pipeline, QR landing, polish

## Documentation

| Document | Description |
|----------|-------------|
| `CLAUDE.md` | Build instructions + architecture rules |
| `Marketero-AI-PRD-v2.3-2026-02-22.md` | Full PRD (official) |
| `architecture/SWARM-ADR-2026-02-22.md` | Architecture Decision Record |
| `Marketero-AI-Research-2026-02-22.md` | Market research |

## Target Market

- 67,000+ Latino restaurants in the USA
- 54% of Hispanic adults use WhatsApp (vs 23% of non-Hispanic whites)
- No competitor offers: Spanish + WhatsApp + AI food photography + cultural content
- Pilots: La Unica Supermarket + El Patron Restaurant (Charlotte, NC)

---

*Built with Claude Code + Swarm Agent Architecture*
