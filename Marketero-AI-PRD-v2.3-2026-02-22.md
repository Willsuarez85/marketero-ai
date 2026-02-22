# Marketero AI — PRD v2.3

> **Version:** 2.3 (MVP — Merged from v2.2 structure + Swarm ADR findings)
> **Date:** 2026-02-22
> **Status:** OFFICIAL
> **Authors:** StarLord + Jarvis — Refined by Claude — Swarm-validated
> **Replaces:** v2.2, v2.1, v2.0, v1.1, v1.0
> **Companion doc:** `architecture/SWARM-ADR-2026-02-22.md`

---

## TL;DR

A $99/month service that handles social media content for Latino restaurants in the USA, delivered and approved entirely via WhatsApp.

MVP = 3 systems:

1. **Acquisition System** — MIFGE → Direct sale (first 5 clients) / Funnel (scale)
2. **Fulfillment System** — Daily content via WhatsApp + publishing via GHL
3. **AI Bot FAQ** — WhatsApp bot answering client questions (text + voice notes)

**Operating model:** Human-in-the-loop. A human (StarLord or VA) reviews content before it reaches the client. Automation increases progressively as quality is validated.

**MVP target:** 3-5 restaurants paying $99/month within 30 days.

**Key architectural decisions (from Swarm ADR):**
- Async webhook processing with idempotency (no duplicate messages)
- Persistent job scheduling (survives server restarts)
- Hybrid intent classification (regex first, Claude for complex)
- Voice note transcription via Whisper (required for Latino market)
- Daily-only delivery mode in MVP (no weekly batch)
- 15-minute pre-publication buffer with cancel option
- Micro-session onboarding (4 sessions x 5 min over 3-4 days)

---

## 0. Confirmed Decisions (Swarm-Validated — Do Not Reopen in MVP)

### Technical (implement Day 1)
| Decision | Detail |
|----------|--------|
| **Async webhooks + idempotency** | Respond HTTP 200 in <100ms. Save raw payload to `webhook_raw_log`. Process async in background worker. Reject duplicates via `ghl_event_id`. |
| **Persistent jobs in DB** | All scheduled jobs live in `scheduled_jobs` table. node-cron is only a poller. Server restarts never lose work. |
| **Regex classifier before Claude** | Detect approval/rejection/escalation with regex first (<100ms). Only call Claude for ambiguous messages. |
| **15-minute publish buffer** | After client approval, wait 15 min before GHL publishes. Client can reply CANCELAR to stop. Prevents accidental approvals. |
| **Whisper API for voice notes** | Implement in Phase 2 (Day 8). Latinos send 3x more voice than text. Without this, ~60% of communication is lost. |
| **Database-as-queue** | PostgreSQL as job queue via `webhook_raw_log` + `scheduled_jobs`. No Redis in MVP. Migrate to BullMQ when >1000 events/day. |

### Product
| Decision | Detail |
|----------|--------|
| **Daily mode only in MVP** | No weekly batch. One post per morning, Mon-Sat. Simpler UX, cleaner validation. Weekly mode is Phase 2. |
| **Onboarding: async micro-sessions** | 4 sessions of ~5 min over 3-4 days via WhatsApp. Owner responds when they can. Not 60 consecutive minutes. |
| **Pilots 1-2: free with conditions** | La Unica + El Patron get 30 days free. Conditions: weekly feedback + video testimonial. No exceptions. |
| **Clients 3-5: paid with guarantee** | $99/month with 30-day money-back guarantee. Validates willingness to pay. |

### Go-to-Market
| Decision | Detail |
|----------|--------|
| **First 5 clients: face-to-face** | StarLord sells in person with before/after photos. Automated funnel is Month 3+. |
| **60/40 split** | Build mornings, sell afternoons. Non-negotiable during 30-day sprint. |

---

## 1. Problem Statement

There are over 67,000 Latino restaurants in the USA, representing an estimated TAM of ~$600M/year for marketing services. These restaurants face a specific content problem: they need a consistent social media presence to compete, but owners typically lack the time, skills, or budget to produce quality content — and every existing solution (Owner.com at $499/month, BentoBox, Popmenu, Toast) operates exclusively in English, ignores WhatsApp (the primary communication channel for 54% of Hispanic adults), and offers no culturally relevant content.

The result is that Latino restaurant owners either post inconsistently, hire expensive agencies, or do nothing — losing foot traffic to competitors with stronger digital presence.

Marketero AI solves this by delivering done-for-you social media content in Spanish/Spanglish, approved and managed through WhatsApp, at a price point ($99/month) that is 5x cheaper than the nearest alternative.

**Evidence:**

- 54% of Hispanic adults use WhatsApp vs. 23% of non-Hispanic whites — no competitor integrates this channel
- 43% of restaurant calls go unanswered, costing up to $292K/year — these owners are overwhelmed
- 83% of Latino business owners sought outside technical assistance last year — demand exists
- Google Pomelli (launched Feb 19, 2026) uses the same Nano Banana model, validating AI food photography
- Two pilot restaurants confirmed: La Unica Supermarket + El Patron Restaurant (Charlotte, NC)

**Critical insight from Swarm debate:** The pitch must be "we bring you more customers," not "we make social media content." Content is the vehicle, not the destination. Restaurant owners care about foot traffic, not Instagram posts.

---

## 2. Goals

### User Goals

| # | Goal | How We Measure It |
|---|------|--------------------|
| U1 | Restaurant owner gets professional social media content without doing the work | % of clients who approve posts without requesting changes |
| U2 | Owner can manage everything from WhatsApp — including voice notes (no new apps, no dashboards) | 100% of client interactions happen via WhatsApp in MVP |
| U3 | Content reflects the restaurant's real food, culture, and voice | Client satisfaction score (qualitative in MVP, NPS by Phase 2) |
| U4 | Owner sees posts going live on their IG/FB without effort | % of approved posts published within 5 minutes |
| U5 | Owner never feels uncertain about what happened with their post | 100% of client actions receive explicit confirmation |

### Business Goals

| # | Goal | Target |
|---|------|--------|
| B1 | Validate willingness to pay $99/month | 3-5 paying clients within 30 days |
| B2 | Prove direct sales convert for first 5 clients | >30% conversion from in-person demo to $99 subscriber |
| B3 | Achieve sustainable content production cost | <$15/client/month in AI + API costs |
| B4 | Validate human-in-the-loop is viable at 5 clients | <25 minutes/day of human review time per client |
| B5 | Validate the MIFGE creates a strong first impression | >50% of demo recipients say "wow" or equivalent |

---

## 3. Non-Goals

| # | Non-Goal | Why |
|---|----------|-----|
| N1 | Video/Reels content | Separate initiative for $199 tier (Phase 2). Image + copy is enough to validate |
| N2 | Client-facing dashboard or web portal | WhatsApp is the interface for MVP. Dashboard adds scope without proving demand |
| N3 | Fully automated content (no human review) | Quality must be validated before removing the human. Premature automation risks bad content |
| N4 | Multi-language support beyond Spanish/Spanglish | Latino restaurants in USA is the niche. English support is Phase 3+ |
| N5 | Direct Meta API integration (bypassing GHL) | GHL handles OAuth complexity. Building our own is Phase 3 |
| N6 | Self-serve onboarding | Onboarding is human-assisted for MVP. Builds trust and ensures quality setup |
| N7 | Outreach to more than 50 restaurants | Focus on converting 3-5 from warm/pilot leads. Scaled outreach is Phase 2 |
| N8 | Weekly batch delivery mode | Daily mode (1 post at a time) is simpler, avoids confusion about which post is being approved, and reduces WhatsApp message overload. Weekly mode is Phase 2 |
| N9 | Automated cold WhatsApp outreach funnel | First 5 clients are acquired through in-person visits, referrals, and direct sales. The MIFGE->Tripwire->Bridge funnel is built for scaling in month 2-3 |
| N10 | Redis / BullMQ / external queue system | Database-as-queue pattern is sufficient for MVP volume (<500 events/day). Migrate when needed |

---

## 4. User Stories

### Restaurant Owner (Primary Persona)

**Profile:** Maria, 48, owns a Mexican restaurant in Charlotte, NC. Uses iPhone, WhatsApp daily (mostly voice notes), posts on Instagram inconsistently. Speaks Spanish primarily, some English. Hands are often covered in flour or salsa. Gets interrupted constantly by staff and suppliers.

| Priority | User Story |
|----------|------------|
| P0 | As a restaurant owner, I want to receive a ready-to-post image and caption on WhatsApp so that I can approve content without learning new tools |
| P0 | As a restaurant owner, I want to reply "si", "ok", "dale", "va", thumbs up, or checkmark to publish a post so that approving content takes less than 5 seconds and works however I naturally respond |
| P0 | As a restaurant owner, I want to send a voice note with my change requests so that I don't have to type on a small screen with busy hands |
| P0 | As a restaurant owner, I want my posts published on both Instagram and Facebook automatically so that I don't have to post manually |
| P0 | As a restaurant owner, I want confirmation after every action (approved, published, error) so that I always know what happened |
| P1 | As a restaurant owner, I want a 15-minute window after approving to cancel publication so that accidental approvals don't go live |
| P1 | As a restaurant owner, I want to request an emergency post via WhatsApp (text or voice) so that I can promote last-minute specials |
| P1 | As a restaurant owner, I want autopilot mode so that posts publish automatically without waiting for my approval |
| P1 | As a restaurant owner, I want to ask the bot about my account so that I feel informed without checking dashboards |
| P2 | As a restaurant owner, I want to see basic engagement metrics via WhatsApp so that I know my investment is working |
| P2 | As a restaurant owner, I want to pause the service for a week so that I can take a break without canceling |

### Marketero Operator (StarLord / VA)

| Priority | User Story |
|----------|------------|
| P0 | As an operator, I want a review queue showing pending posts (image + caption) so that I can approve or reject content before it reaches the client |
| P0 | As an operator, I want to provide feedback on rejected content so that the AI regenerates with corrections |
| P0 | As an operator, I want the onboarding workflow to be a structured micro-session checklist so that I don't overwhelm the client or miss setup steps |
| P1 | As an operator, I want to see which clients have unanswered posts so that I can follow up on approvals |
| P1 | As an operator, I want alerts when a service fails (GHL down, image generation error) so that I can intervene before the client notices |
| P2 | As an operator, I want to see content generation costs per client so that I can track unit economics |

### Prospective Client (Acquisition)

| Priority | User Story |
|----------|------------|
| P0 | As a prospective client, I want to see AI-enhanced photos of MY restaurant so that I can judge quality with something personal, not generic |
| P1 | As a prospective client, I want to buy a campaign kit for $19.99 so that I can test the value with low risk |
| P1 | As a prospective client, I want a free week of content after the tripwire so that I experience the full service before subscribing |

---

## 5. Requirements

### Must-Have (P0) — Cannot Ship Without These

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| R1 | **Async webhook handler with idempotency** | Given a GHL webhook arrives, when the handler fires, then it responds HTTP 200 in <100ms, saves the raw payload to `webhook_raw_log`, and a background worker processes it. Duplicate webhooks (same `ghl_event_id`) are ignored. |
| R2 | **Restaurant identification by phone** | Given a WhatsApp message from a registered phone, when the system looks it up, then it finds the restaurant via `authorized_contacts` table (supports multiple phones per restaurant) and loads the client brain within 2 seconds |
| R3 | **Hybrid intent classification (regex + Claude)** | Given a client message, when intent is classified, then simple intents (approval: 20+ Spanish variants + emojis, rejection, escalation) resolve via regex in <100ms. Complex intents fall through to Claude API with 10s timeout. If Claude fails, regex fallback handles it. |
| R4 | **Voice note transcription** | Given a client sends a WhatsApp voice note, when the system receives it, then Whisper API transcribes it to text and the transcription is processed through the same intent classification pipeline as text messages |
| R5 | **Content generation pipeline (image + caption)** | Given a restaurant's client brain and a content prompt, when generation runs, then fal.ai Nano Banana Pro produces an image (with concurrency limit of 3) and Claude generates a Spanish caption with hashtags and CTA. Failures are caught, logged, and the operator is notified. |
| R6 | **Human review queue** | Given a post is generated, when it enters the queue, then the operator can view the image and caption, approve (sends to client via WhatsApp), or reject with feedback (triggers regeneration) |
| R7 | **WhatsApp delivery with explicit confirmation** | Given a post is approved by the operator, when it is sent to the client, then the client receives the image and caption with clear instructions. Every client response receives an explicit confirmation message. |
| R8 | **Approval triggers GHL publish with 15-min buffer** | Given the client approves a post, when the system processes the response, then it confirms ("Post aprobado. Se publicara en 15 min. Responde CANCELAR para detener.") and after 15 minutes GHL publishes to IG + FB. If client sends CANCELAR within 15 min, publication is stopped. |
| R9 | **Change request handling** | Given the client replies with a change request (text or voice note), when the system processes it, then the AI regenerates the content, a human reviews it, and the revised post is resent |
| R10 | **Persistent job scheduling** | Given content needs to be generated daily at 8am per client's timezone, when the scheduler runs, then jobs are stored in `scheduled_jobs` table (survives server restarts). node-cron acts only as a poller checking for pending jobs every minute. Missed jobs are executed on recovery. |
| R11 | **Client onboarding via micro-sessions** | Given a new paying client, when onboarding starts, then the operator follows 4 micro-sessions over 3-4 days (5 min each) that configure the client brain, GHL sub-account, social connections, photo library, and first posts — without requiring 60 consecutive minutes of the client's attention |
| R12 | **Restaurant database with client brain** | Given a restaurant is onboarded, when the brain is created, then it stores brand_voice, menu_items, visual_profile, photo_library, and monthly_goals in Supabase |
| R13 | **Stripe payment for $99/month subscription** | Given a client is ready to pay, when they click the payment link, then Stripe processes $99/month recurring and the subscription status is tracked in the `subscriptions` table |
| R14 | **Conversation state management** | Given a client is in the middle of a multi-step flow (emergency post, onboarding, etc.), when they send a message, then the system continues the active flow. If the flow expires (30 min timeout) or the client says "cancelar", the state resets. |
| R15 | **Error handling with client communication** | Given any external service fails (GHL, fal.ai, Claude), when the error occurs, then the system logs it, notifies the operator, and sends the client a human-readable message ("Estamos teniendo un problema tecnico, te contactamos pronto") instead of failing silently |

### Nice-to-Have (P1) — Ship Soon After Launch

| ID | Requirement | Notes |
|----|-------------|-------|
| R16 | **Autopilot mode with reminder** | If client doesn't respond within 90 minutes and autopilot is enabled, send reminder ("Tu post se publicara automaticamente en 30 minutos"). At 2 hours, GHL publishes automatically. |
| R17 | **Emergency post flow** | Client requests via WhatsApp (text or voice) → bot collects details → generation → human review → delivery in <30 min |
| R18 | **AI Bot FAQ responses** | Bot answers common questions: next post date, published posts this week, engagement metrics, pause service, escalate to human |
| R19 | **MIFGE pipeline: GMB scrape → AI photoshoot** | Given a restaurant's Google Maps place ID, when MIFGE runs, then system scrapes photos, enhances with Nano Banana Pro, and delivers enhanced photos (for in-person demos or WhatsApp delivery) |
| R20 | **Bridge nurture sequence** | Automated D+1 to D+7 follow-up messages after tripwire, ending with $99/month offer |
| R21 | **Tripwire kit generation ($19.99)** | 3-piece campaign kit generated from WhatsApp conversation with template selection |
| R22 | **Health check endpoint + uptime monitoring** | GET /health verifies Supabase connectivity. External service (UptimeRobot) pings every 5 minutes. |

### Future Considerations (P2) — Design For, Don't Build

| ID | Requirement | Architectural Impact |
|----|-------------|---------------------|
| R23 | $199/month tier with Reels, email, Google Reviews | DB schema supports `tier` field; content_items supports `content_type` beyond static images |
| R24 | Direct Meta API (replace GHL for publishing) | Isolate GHL publishing behind a service interface so it can be swapped |
| R25 | Client-facing web dashboard | Keep engagement data in structured JSONB so it can be queried by a future frontend |
| R26 | Fully automated content (remove human-in-the-loop) | Review queue status flow supports skipping `human_review` when confidence thresholds are met |
| R27 | Multi-restaurant accounts (owners with 2+ locations) | `authorized_contacts` table already decouples phone from restaurant. Future `owners` table links multiple restaurants. |
| R28 | Weekly batch delivery mode | Once daily mode is validated, add weekly with numbered posts and batch approval UX |
| R29 | BullMQ migration | When database-as-queue bottlenecks (>1000 events/day), migrate to Redis + BullMQ |

---

## 6. Success Metrics

### Leading Indicators (Days 1-14 Post-Launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Onboarding completion time | <25 min total (across 4 micro-sessions over 3-4 days) | Timestamps from first to last micro-session |
| Content generation latency | <2 hours from trigger to client delivery | Timestamp from `generating` to `pending_client` |
| Client approval rate (first attempt) | >70% of posts approved without changes | Count of approvals vs change requests in whatsapp_log |
| Post publication latency | <20 minutes from approval to live on IG/FB (includes 15-min buffer) | Timestamp from `client_approved_at` to `published_at` |
| Emergency post delivery time | <30 minutes | Timestamp from request to client delivery |
| Bot FAQ accuracy | >80% correct responses | Manual review of bot responses (sample weekly) |
| Voice note processing success | >90% transcribed and correctly understood | Compare Whisper output vs actual intent |
| Webhook processing reliability | 0 duplicate messages sent to clients | Count of duplicate ghl_event_ids in webhook_raw_log |

### Lagging Indicators (Days 15-30)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Paying clients | 3-5 at $99/month | Stripe active subscriptions |
| Demo → Sale conversion (in-person) | >30% | Demos given vs payments received |
| Referral rate from pilots | 2+ referrals per pilot | Names received from La Unica + El Patron |
| Monthly churn | 0% in first 30 days | Stripe cancellations |
| Human review time per client per day | <25 minutes | Operator time tracking (manual) |
| AI + API cost per client per month | <$15 | Sum of fal.ai + Claude + Whisper costs per restaurant_id |
| Server uptime | >99% | Health check monitoring |
| Missed scheduled jobs | 0 | Count of `failed` status in scheduled_jobs |

### Stretch Targets

| Metric | Stretch |
|--------|---------|
| Paying clients in 30 days | 7+ |
| Client refers another restaurant | 1+ organic referral |
| Client activates autopilot mode | 2+ clients on autopilot within 30 days |
| First-attempt approval rate | >85% |

---

## 7. Open Questions

| # | Question | Owner | Blocking? | Status |
|---|----------|-------|-----------|--------|
| Q1 | What happens when a restaurant owner changes phone number? | Engineering | No — rare, handle manually in MVP. `authorized_contacts` table supports adding new phone. | Open |
| Q2 | What is the GHL API rate limit for WhatsApp messaging and posting? | Engineering | **Yes** — test in Week 1 before onboarding client #3 | Open |
| Q3 | Does GHL webhook include a unique message ID for idempotency? | Engineering | **Yes** — inspect first real webhook payload on Day 2 | Open |
| Q4 | What is Nano Banana Pro failure rate with low-quality iPhone photos? | Engineering | **Yes** — test with 10 real photos from pilots on Day 4 | Open |
| Q5 | Does Whisper handle Spanish with kitchen background noise? | Engineering | **Yes** — test with real recordings from pilot restaurants | Open |
| Q6 | How do we handle content for holidays (Cinco de Mayo, Christmas)? | Product | No — manually curate for MVP | Open |
| Q7 | What legal authorization do we need for posting on client's behalf? | Legal/StarLord | **Yes** — get clause in onboarding agreement | Open |
| Q8 | Should the tripwire $19.99 include a money-back guarantee? | Growth | No — decide before first outreach | Open |
| Q9 | Can the single developer split time 60/40 (build/sell) or is there someone else for sales? | StarLord | **Yes** — determines GTM execution speed | Open |
| Q10 | What are GHL's WhatsApp template message requirements for cold outreach? | Engineering | No — cold WhatsApp is deferred to Phase 2 | Open |

---

## 8. The Product — $99/month

### What the Client Receives

- **Daily content** for Instagram and Facebook: realistic AI-generated images (from the restaurant's own photos), copy in Spanish/Spanglish matching the restaurant's voice, covering dishes, offers, specials, and cultural content
- **Easy WhatsApp approval** — reply with any natural affirmation (si, ok, dale, checkmark, thumbs up, voice note saying "publícalo") and it publishes
- **Voice note support** — send change requests, questions, or approvals as voice notes instead of typing
- **15-minute safety buffer** — after approving, you have 15 minutes to cancel before it goes live
- **On-demand emergency posts** — request via WhatsApp, delivered in <30 minutes
- **AI Bot FAQ** — ask about account, posts, metrics anytime (text or voice)
- **Automatic publishing** on IG + FB via GHL (each client has their own sub-account)
- **Explicit confirmation** of every action — you always know what happened

### Delivery Mode (MVP)

**Daily Mode only** — 1 post delivered each morning (Mon-Sat, ~24 posts/month). Each post is a single interaction: one image, one caption, approve or change. No confusion about which post is which.

> Weekly batch mode is deferred to Phase 2 after validating the daily flow. Sending 6 posts at once creates UX problems: message overload, ambiguous approvals, and partial approval parsing complexity.

### What is NOT Included in $99 (Phase 2+)

| Feature | Tier | Phase |
|---------|------|-------|
| Weekly batch delivery mode | $99/month | Phase 2 |
| Reels / video content | $199/month | Phase 2 |
| Email marketing | $199/month | Phase 2 |
| Google Reviews automation | $199/month | Phase 2 |
| AI Receptionist | $299/month | Phase 3 |
| Web dashboard | $199/month | Phase 2 |

---

## 9. Core Loop

```
[DAILY — 8am client timezone]
Scheduler triggers → content generation for this client
        ↓
[CONTENT PIPELINE]
Claude API → generates copy (caption + hashtags + CTA)
fal.ai Nano Banana Pro → generates image (from restaurant's photos)
        ↓
[HUMAN REVIEW — StarLord or VA]
Reviews image + copy, adjusts if necessary
Approve → sends to client | Reject with feedback → regenerates
        ↓
[WHATSAPP → client]
"Buenos dias Maria 👋 Aqui esta tu post de hoy:
 [image] 'Los mejores tacos al pastor de Charlotte 🌮
  Ven hoy de 11am a 10pm. Te esperamos!'
  Responde SI para publicar, o dime que cambiar"
        ↓
Client replies "si" / "ok" / "dale" / ✅ / 👍 / [voice note: "publícalo"]
        → "Post aprobado! Se publicara en 15 min.
           Responde CANCELAR si quieres detenerlo."
        → [15 min buffer] → GHL publishes to IG + FB
        → "Listo! Tu post ya esta en vivo en Instagram y Facebook ✅"

Client replies "cambia el texto" / [voice note with changes]
        → Whisper transcribes (if voice) → AI regenerates
        → Human reviews → resend to client

Client doesn't respond in 90 min (autopilot enabled)
        → "Tu post se publicara automaticamente en 30 min"
        → [30 min] → GHL publishes
        → "Tu post se publico en piloto automatico ✅"
```

---

## 10. System 1 — Client Acquisition

### Strategy: Two Phases

**Phase A (Days 1-30, MVP): Direct Sales**
The first 3-5 clients are acquired through in-person visits, pilot referrals, and concierge selling. No automated funnel needed.

**Phase B (Days 30-90, Scale): Automated Funnel**
The MIFGE → Tripwire → Bridge → $99 funnel is built for scaling when there are 50+ leads per week.

### Phase A — Direct Sales Playbook (First 5 Clients)

**Pilots (La Unica + El Patron) — Free with conditions:**
- First month free in exchange for: case study permission, 60-second video testimonial, transition to $99/month in month 2, respond to WhatsApp within 24h for feedback
- Start delivering value (MIFGE photoshoot) within Week 1 before product is complete

**Clients 3-5 — $99/month with 30-day money-back guarantee:**

```
Day 1: In-person visit (2-4pm, after lunch rush)
       Show AI-enhanced photos of THEIR restaurant on tablet
       "Quiere que sus redes se vean asi TODOS LOS DIAS?"

Day 2-3: Send 2-3 sample posts via WhatsApp
         Made specifically for their restaurant

Day 3-5: Close: "$99/mes, sin contrato, si no le gusta
         en 30 dias le devuelvo cada centavo"

Day 5-7: First real post published on their IG/FB
```

**Acquisition channels ranked by speed:**

| # | Channel | Expected result | Effort |
|---|---------|----------------|--------|
| 1 | Referrals from pilots (week 2-3) | 1-2 clients | 2-3 hrs |
| 2 | Door-to-door Charlotte (Central Ave, South Blvd) | 1-2 clients | 15-20 hrs over 3 weeks |
| 3 | Local Facebook groups | 0-1 client | 3-4 hrs/week |
| 4 | Distributor partnerships | 0-1 (medium term) | 5-10 hrs networking |

**The pitch that closes (60 seconds):**
> "Don Carlos, mire estas fotos de su restaurante [show before/after]. Nosotros hacemos que sus redes se vean asi TODOS LOS DIAS. Solo me manda fotos por WhatsApp y nosotros creamos todo, lo publicamos, y le mandamos reporte cada semana. $99 al mes, sin contrato, y si no le gusta en el primer mes le devuelvo cada centavo. Empezamos esta semana?"

**Emotional triggers that work:**
1. Competitive shame: "Mire el Instagram de [competitor]. 3,000 seguidores, publica todos los dias. Su comida es mejor pero nadie lo sabe."
2. Visual demo: Their OWN food looking like magazine photography
3. Effort elimination: "Nosotros nos encargamos de TODO"

### Phase B — Automated Funnel (Month 2-3, for scale)

```
COLD OUTREACH (in-person first, then digital)
Visit restaurant → show AI photos on tablet → get WhatsApp permission
        OR (after 10+ testimonials)
GMB scrape → AI photoshoot → WhatsApp with permission
              ↓
        [MIFGE — FREE]
   AI Food Photoshoot — restaurant photos transformed
   into professional photography in <15 minutes
              ↓
      [TRIPWIRE — $19.99]
   Campaign kit (e.g. Cinco de Mayo):
   Post + Poster with QR + Story — 3 branded pieces
              ↓
     [BRIDGE — D+1 to D+7]
   WhatsApp nurturing
   → D+5: "1 free week of content"
   → D+7: $99/month offer
              ↓
        [$99/month — SIGNUP]
   Onboarding → fulfillment begins
```

### MIFGE — AI Food Photoshoot

- **Tech:** `fal-ai/nano-banana-pro/edit` endpoint
- **Prompt:** "Professional food photography: warm golden lighting, appetizing styling, magazine quality, shallow depth of field. Keep exact same dish. Make food look delicious."
- **Cost:** ~$0.15/image
- **Delivery:** <15 minutes
- **Primary use in MVP:** In-person demos on tablet (not cold WhatsApp)

### Tripwire $19.99 — Campaign Kit (Phase B)

3 pieces: post graphic (1:1 or 4:5), poster/flyer with QR code (leads to opt-in landing), story (9:16).

**WhatsApp creation flow:** 3 questions → template selection → generation → delivery <30 min → Stripe $19.99.

### Bridge — Post-Tripwire Nurture (Phase B)

```
D+1: "Ya publicaste tu kit? Necesitas ayuda?"
D+3: Pilot case study (La Unica / El Patron)
D+5: "Te regalamos 1 semana de contenido — gratis 🎁"
D+7: "Automatizamos esto por $99/mes? Sin contratos."
```

---

## 11. System 2 — Content Fulfillment

### Client Onboarding — Micro-Sessions (3-4 days)

Instead of a single 60-minute session that overwhelms busy restaurant owners, onboarding is split into 4 micro-sessions of ~5 minutes each, spread over 3-4 days.

**Session 1 — Basics (5 min, Day 1)**
Via WhatsApp:
- "Hola Maria! Bienvenida a Marketero AI. Solo necesito 3 cosas hoy:"
- Restaurant name, address, and hours
- A photo of the front of the restaurant
- Instagram handle + Facebook page URL
- "Listo! Manana te pido unas fotos de tu comida."

**Session 2 — Photos (5 min, Day 2)**
Via WhatsApp:
- "Buenos dias! Hoy necesito fotos de tus 5 platillos mas populares."
- "Tómalas con buena luz si puedes, pero cualquier foto sirve."
- Accept whatever quality they send — AI will enhance
- "Gracias! Manana te muestro como quedan con nuestra tecnologia."

**Session 3 — AI Photoshoot + Brand (5 min, Day 3)**
Via WhatsApp:
- Run photos through Nano Banana Pro /edit
- Send before/after comparisons: "Mira como quedaron tus fotos!"
- Ask: "De que color es el letrero de tu restaurante?" (extract brand colors naturally)
- "Tienes logo? Si no, no te preocupes, nosotros creamos uno sencillo."
- Save to photo library in client brain

**Session 4 — First Post + Activation (10 min, Day 3 or 4)**
Via WhatsApp:
- GHL sub-account created, FB/IG connected
- Generate 2-3 sample posts using client brain
- "Aqui esta tu primer post! Que te parece?"
- Client approves → first post published
- "CLIENTE ACTIVADO — a partir de manana recibiras tu post diario a las 8am"

**Operator checklist (internal, accumulated across sessions):**
```
□ Session 1: name, address, hours, social handles, front photo
□ Session 2: 5-10 dish photos received
□ Session 3: AI photoshoot done, brand colors extracted, logo saved
□ Session 4: GHL sub-account created, FB/IG connected, phone registered
□ Session 4: Client brain complete (brand_voice, menu_items, visual_profile, photo_library)
□ Session 4: First post approved and published
□ CLIENTE ACTIVADO
```

**Key design decisions:**
- Never ask technical questions ("brand colors", "tone of voice") — infer from photos and conversation
- Accept imperfect inputs — blurry photos get enhanced, no logo gets generated
- Show results in every session — client sees value immediately
- If client stops responding, send a gentle reminder next day, not 5 follow-ups

### Content Generation Pipeline

```
[SCHEDULER — Daily, 8am client timezone]
  scheduled_jobs table → poller finds pending job
        ↓
INDUSTRY BRAIN → seasonal trends, what's working
        +
CLIENT BRAIN → menu, photos, goals, history
        ↓
Claude API → generates copy (caption + hashtags + CTA)
  - Max 150 chars caption + 5 hashtags
  - Tone matches client's brand_voice
  - CTA included
        +
fal.ai Nano Banana Pro → generates image
  - Uses restaurant's own photos from photo_library
  - Concurrency limit: max 3 simultaneous generations
  - On failure: retry once, then notify operator
        ↓
content_items status: 'generating' → 'human_review'
        ↓
[HUMAN REVIEW — StarLord or VA]
  GET /review-queue → see image + caption
  POST /review-queue/:id/approve → status: 'pending_client'
  POST /review-queue/:id/reject → { feedback } → status: 'generating'
        ↓
[WHATSAPP → client]
  Send image + caption + "Responde SI para publicar"
  content_items status: 'pending_client'
        ↓
Client approves → status: 'approved' → [15 min buffer] → GHL publish
  → status: 'published' → confirm to client
Client requests change → status: 'generating' (loop back)
Client silence + autopilot → status: 'approved' → [reminder at 90m] → publish at 2h
```

**Content status machine (valid transitions):**
```
generating     → human_review | failed
human_review   → pending_client | generating (rejected)
pending_client → approved | generating (client change request)
approved       → published | publish_failed | cancelled (CANCELAR within 15m)
published      → published (terminal)
failed         → generating (retry)
publish_failed → approved (retry publish)
cancelled      → pending_client (resend to client)
```

### Emergency On-Demand Posts

```
Client: "Necesito un post de specials del fin de semana"
  OR: [voice note with the same request]
        ↓
[Whisper transcribes if voice note]
[Intent classified as 'emergency_post']
[conversation_state set to emergency flow]
        ↓
Bot: "Claro! Cual es el especial? Precio? Tienes foto?"
        ↓
Client responds (text or voice) with details
[conversation_state tracks collected info]
        ↓
Generation → Human review → delivery in <30 min
        ↓
Client approves → [15 min buffer] → publishes
```

### Base Prompts (Templates by Type)

**Dish post (image):**
```
Professional food photography of [dish] from [restaurant name].
Warm golden lighting, appetizing styling, magazine quality,
shallow depth of field. Brand colors: [colors]. Style: [style].
Keep the exact same dish. Make it look delicious.
```

**Offer post (image):**
```
Promotional graphic for [restaurant name]. Offer: [promo].
Colors: [palette]. Clean, bold typography. Festive but professional.
Spanish text: [copy]. Restaurant name prominent.
```

**Copy (Claude):**
```
Eres el community manager de [name], un restaurante [type] en [city].
Brand voice: [warm/vibrant/elegant].
Escribe un caption en español para Instagram sobre: [topic].
Maximo 150 caracteres + 5 hashtags relevantes. Incluye un CTA.
El tono debe sonar humano y autentico, no corporativo ni generico.
```

---

## 12. System 3 — AI Bot FAQ (WhatsApp)

The restaurant owner can ask the bot anything, anytime — via text or voice note.

### MVP Bot Capabilities

| Client Question | Bot Response |
|-----------------|--------------|
| "Que se publico esta semana?" | Lists published posts with dates |
| "Cuando sale mi proximo post?" | Date and preview of next post |
| "Necesito un post de emergencia" | Initiates emergency generation flow |
| "Puedo cambiar el post de manana?" | "Si, que quieres cambiar? Puedo ajustar imagen, texto o ambos" |
| "Quiero activar piloto automatico" | Activates autopilot on their profile |
| "Como estuvo el engagement esta semana?" | Basic GHL metrics (likes, comments, reach) |
| "Quiero pausar el servicio" | Pauses the schedule |
| "Necesito hablar con alguien" | Escalates to human (notifies StarLord) |
| [any voice note] | Transcribes → classifies intent → responds appropriately |
| [2 failed interactions in a row] | "No entendi bien. Quieres que te comunique con una persona?" |

### Bot Routing

```
Owner messages Marketero AI number (text or voice note)
        ↓
GHL webhook → backend (async, idempotent)
        ↓
[If voice note] → Whisper API transcription → text
        ↓
authorized_contacts lookup → identifies restaurant
        ↓
[Check conversation_state] → active flow? continue it
        ↓
[If no active flow] → Classify intent:
  Regex first (approval, rejection, escalation, cancel)
  Claude if regex doesn't match (FAQ, content request, complex)
        ↓
Execute action → Respond via GHL WhatsApp API
        ↓
[Always confirm] → Client knows what happened
```

### Escalation Rules

- Client says "humano", "persona", "hablar con alguien", "ayuda" → immediate escalation
- 2 consecutive bot responses that don't resolve the issue → offer escalation
- Any message the system cannot classify → offer escalation
- Escalation = notify StarLord via WhatsApp with client name + context

---

## 13. Technical Architecture

### GHL Multi-Tenant Structure

```
MARKETERO AI (GHL Agency Account)
│  WhatsApp Business: Already activated
│  One number for all clients
│
├── Sub-account: La Unica Supermarket
│   ├── FB page connected
│   ├── IG account connected
│   └── Workflows: approval → publication
│
├── Sub-account: El Patron Restaurant
│   └── (same structure)
│
└── Sub-account: [new client]
    └── (created during onboarding Session 4)
```

**Why GHL:** Manages OAuth with each restaurant's FB/IG. Without it, we'd manage tokens manually.

**Rate limiting mitigation:** Throttle outbound messages at 1 per 2 seconds. Never send more than 30 messages per minute. Serialize morning content deliveries with delay between clients.

### MVP Tech Stack

| Component | Technology | Status |
|-----------|-----------|--------|
| WhatsApp Business | GHL — already activated | Ready |
| Social publishing | GHL API (schedule + post) | Ready |
| AI images | fal.ai — Nano Banana Pro | Ready |
| AI copy + bot | Claude API (Haiku for classification, Sonnet for generation) | Ready |
| Voice transcription | OpenAI Whisper API | Ready |
| GMB photo scraping | Google Places API | Activate |
| Database | Supabase (Postgres) | Setup |
| Backend / webhook server | Node.js + Express | Build |
| Scheduler | node-cron (as poller only) | Build |
| Payments | Stripe | Integrate |
| Uptime monitoring | UptimeRobot (free) | Configure |

### Webhook Processing (Async + Idempotent)

```
POST /webhooks/ghl
  │
  ├─ 1. Respond HTTP 200 immediately (<100ms)
  ├─ 2. Save raw payload to webhook_raw_log
  │     (with ghl_event_id for deduplication)
  └─ 3. Return

Background worker (every 5 seconds):
  │
  ├─ 1. Query webhook_raw_log WHERE status = 'received'
  ├─ 2. For each event:
  │     ├─ Check ghl_event_id not already processed (idempotent)
  │     ├─ Try-catch isolated per event (one failure doesn't block others)
  │     ├─ Identify restaurant by phone (authorized_contacts)
  │     ├─ Load client brain
  │     ├─ Check conversation_state for active flow
  │     ├─ Classify intent (regex → Claude fallback)
  │     ├─ Execute action
  │     ├─ Respond via GHL API (with throttling)
  │     └─ Update webhook_raw_log status to 'processed'
  └─ On error: status = 'failed', increment attempts, log error
```

### Scheduled Job Processing

```
node-cron runs every minute (* * * * *)
  │
  ├─ Query scheduled_jobs WHERE status = 'pending'
  │   AND scheduled_for <= NOW()
  │   ORDER BY scheduled_for LIMIT 10
  │
  └─ For each job:
      ├─ Set status = 'processing'
      ├─ Execute (content generation, delivery, etc.)
      ├─ On success: status = 'completed'
      └─ On failure: status = 'failed', increment attempts
          (retry on next poller cycle if attempts < 3)
```

---

## 14. Database Schema

### Original Tables (from v2.1, with modifications)

```sql
-- Restaurants
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone_owner TEXT UNIQUE NOT NULL,   -- primary identifier (kept for backwards compat)
  email_owner TEXT,
  city TEXT,
  cuisine_type TEXT,                  -- mexican | colombian | peruvian | etc.
  timezone TEXT DEFAULT 'America/New_York',  -- NEW: for scheduled_jobs
  gmb_place_id TEXT,
  instagram_handle TEXT,
  facebook_page_id TEXT,
  ghl_sub_account_id TEXT,            -- nullable until onboarding Session 4
  status TEXT DEFAULT 'onboarding',   -- onboarding | active | paused | churned
  delivery_mode TEXT DEFAULT 'daily', -- CHANGED: daily only in MVP
  autopilot BOOLEAN DEFAULT FALSE,
  tier TEXT DEFAULT '$99',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client brain
CREATE TABLE client_brains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
  brand_voice TEXT,
  menu_items JSONB DEFAULT '[]',
  visual_profile JSONB DEFAULT '{}',
  photo_library JSONB DEFAULT '[]',
  monthly_goals TEXT,
  performance_notes TEXT,
  onboarding_session INTEGER DEFAULT 0,  -- NEW: tracks micro-session progress (0-4)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content (generated posts)
CREATE TABLE content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id),
  caption TEXT,
  image_url TEXT,                      -- nullable during generation
  image_prompt TEXT,                   -- NEW: store the prompt used
  platform TEXT[] DEFAULT '{instagram,facebook}',  -- CHANGED: array instead of CSV
  content_type TEXT DEFAULT 'dish',    -- NEW: dish | offer | cultural | emergency
  status TEXT DEFAULT 'generating',
  -- generating → human_review → pending_client → approved → published
  -- also: failed, publish_failed, cancelled
  human_feedback TEXT,                 -- NEW: feedback from operator on rejection
  human_approved_at TIMESTAMPTZ,
  client_approved_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  publish_deadline TIMESTAMPTZ,       -- NEW: 15 min after approval (cancel window)
  ghl_post_id TEXT,
  engagement JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp conversation log
CREATE TABLE whatsapp_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id),
  ghl_event_id TEXT UNIQUE,           -- NEW: idempotency key
  content_item_id UUID REFERENCES content_items(id),  -- NEW: links response to post
  direction TEXT NOT NULL,            -- inbound | outbound
  message TEXT,
  media_url TEXT,
  media_type TEXT,                    -- NEW: text | image | audio | document
  transcription TEXT,                 -- NEW: Whisper transcription for voice notes
  intent TEXT,                        -- approval | faq | emergency | escalation | change_request
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads (acquisition pipeline)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_name TEXT,
  phone TEXT,
  email TEXT,                         -- NEW
  source TEXT DEFAULT 'manual',       -- NEW: manual | referral | door_to_door | facebook_group
  referred_by UUID REFERENCES restaurants(id),  -- NEW: referral tracking
  gmb_place_id TEXT,
  gmb_photos JSONB DEFAULT '[]',
  enhanced_photos JSONB DEFAULT '[]',
  stage TEXT DEFAULT 'new',
  -- new → contacted → demo_given → photoshoot_sent → tripwire_sent → bridge → converted | dead
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Industry brain (shared knowledge)
CREATE TABLE industry_brain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT,                      -- promotion | content | seasonal | trend
  insight TEXT NOT NULL,
  cuisine_type TEXT DEFAULT 'mexican',
  season TEXT DEFAULT 'all',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New Tables (from Swarm ADR)

```sql
-- Authorized contacts per restaurant (supports multiple phones)
CREATE TABLE authorized_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,                          -- contact name
  role TEXT DEFAULT 'owner',          -- owner | manager | staff
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone)                       -- one phone = one restaurant
);

-- Conversation state (active flows)
CREATE TABLE conversation_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
  current_flow TEXT,                  -- emergency_post | onboarding | tripwire | null
  flow_step INTEGER DEFAULT 0,
  flow_data JSONB DEFAULT '{}',       -- data collected so far in the flow
  expires_at TIMESTAMPTZ,             -- 30 min timeout for active flows
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Persistent scheduled jobs (survives restarts)
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id),
  job_type TEXT NOT NULL,             -- daily_content | autopilot_publish | reminder | bridge_nurture
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',      -- pending | processing | completed | failed
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  metadata JSONB DEFAULT '{}',        -- job-specific data (e.g. content_item_id)
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw webhook log (idempotency + dead letter queue)
CREATE TABLE webhook_raw_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_event_id TEXT UNIQUE,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'received',     -- received | processed | failed
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions (payment tracking)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',       -- active | past_due | canceled | paused
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Critical Indexes

```sql
CREATE INDEX idx_content_restaurant_status ON content_items(restaurant_id, status);
CREATE INDEX idx_content_scheduled ON content_items(scheduled_at) WHERE status = 'approved';
CREATE INDEX idx_content_publish_deadline ON content_items(publish_deadline) WHERE status = 'approved';
CREATE INDEX idx_whatsapp_restaurant ON whatsapp_log(restaurant_id, created_at DESC);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_restaurants_status ON restaurants(status);
CREATE INDEX idx_jobs_pending ON scheduled_jobs(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_webhook_raw_status ON webhook_raw_log(status, created_at);
CREATE INDEX idx_authorized_phone ON authorized_contacts(phone);
```

---

## 15. 30-Day MVP Roadmap

### Time Split: 60% Build (mornings) / 40% Sell + Serve (afternoons)

### Week 1 — Foundation + Pilot Value

**Build (mornings):**
- [ ] Day 1: Node.js + Express setup, Supabase project + full schema (12 tables), .env config, health endpoint, ngrok
- [ ] Day 2: Webhook handler (async + idempotent), webhook_raw_log, worker loop, restaurant lookup via authorized_contacts
- [ ] Day 3: Hybrid intent classifier (regex + Claude), conversation state management, GHL WhatsApp signature verification
- [ ] Day 4: Content pipeline (Claude copy + fal.ai image), status machine, concurrency limiter, error handling
- [ ] Day 5: WhatsApp delivery + approval flow (20+ variants), 15-min buffer, GHL publish to IG/FB

**Sell (afternoons):**
- [ ] Day 1: Visit La Unica — photos, interview, access to social accounts
- [ ] Day 2: Visit El Patron — photos, interview, access to social accounts
- [ ] Day 3-5: Manually create 5 posts for each pilot using AI tools, publish

**Exit criteria:** Can receive a WhatsApp message, classify intent, and respond. Can generate a post and publish to a test IG/FB account.

### Week 2 — Scheduler + Review Queue + Pilot Launch

**Build (mornings):**
- [ ] Day 6: Scheduled jobs system (persistent, timezone-aware), node-cron poller
- [ ] Day 7: Review queue (HTML interface: view, approve, reject with feedback)
- [ ] Day 8: Whisper API integration for voice notes
- [ ] Day 9: Onboarding micro-session flow (4 sessions tracked in client_brain)
- [ ] Day 10: End-to-end testing, bug fixes, error handling for all external services

**Sell (afternoons):**
- [ ] Day 6: Review pilot results with La Unica, ask for referrals
- [ ] Day 7: Review pilot results with El Patron, ask for referrals
- [ ] Day 8-10: Prepare AI photos for 5-8 target restaurants, door-to-door visits

**Exit criteria:** La Unica receives a generated post via WhatsApp, approves via voice note, and it publishes to their Instagram after 15-min buffer.

### Week 3 — Fulfillment Complete + Close Sales

**Build (mornings):**
- [ ] Day 11: Autopilot mode with 90-min reminder
- [ ] Day 12: Emergency post flow (full conversation)
- [ ] Day 13: Bot FAQ (top 8 questions)
- [ ] Day 14: Stripe integration ($99/month subscription + subscriptions table)
- [ ] Day 15: Escalation flow, operator alerts for errors

**Sell (afternoons):**
- [ ] Day 11-12: Follow up with leads from week 2, close sales
- [ ] Day 13: Onboard new paying clients (micro-session 1)
- [ ] Day 14-15: Continue onboarding + create content for all active clients

**Exit criteria:** Complete fulfillment loop working for pilots. 1-3 new paying clients in onboarding.

### Week 4 — Polish + Scale to 5 Clients

**Build (mornings):**
- [ ] Day 16-17: MIFGE pipeline (Google Places scrape + AI enhance) for demos
- [ ] Day 18: QR landing page for future tripwire
- [ ] Day 19-20: Bug fixes, prompt tuning, performance optimization

**Sell (afternoons):**
- [ ] Day 16-18: Last round of outreach, close remaining pipeline
- [ ] Day 19: Complete all onboardings
- [ ] Day 20: Document processes for scaling in month 2

**Exit criteria:** 3-5 clients paying $99/month. Content publishing daily to their social accounts. All systems operational.

---

## 16. Phases 2 and 3 (Out of MVP Scope)

### Phase 2 — Days 30-90 (Scale + New Features)

- Weekly batch delivery mode (with numbered post UX)
- $199/month: Reels + email marketing + Google Reviews automation + web dashboard
- Automated MIFGE → Tripwire → Bridge funnel
- Progressive automation: reduce human-in-the-loop with quality validation
- Industry brain: weekly update system with Apify
- Semi-automated outreach (50-100 restaurants/day)
- Proactive agent v1: weekly campaign proposals via WhatsApp
- Target: 10-15 paying clients

### Phase 3 — Days 90-180 (Full Product)

- $299/month: AI Receptionist + Online Ordering
- Direct Meta API (migration from GHL)
- Advanced dashboard with per-client analytics
- Fully automated cold outreach
- Client avatars/personas for video
- BullMQ migration (if database-as-queue bottlenecks)
- Target: 35-50 clients = $10K MRR

---

## 17. Timeline Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Single developer (StarLord) building + selling | 30 days is aggressive for 3 systems | Prioritize fulfillment (System 2) — it's the revenue engine. Acquisition can be manual. |
| GHL WhatsApp rate limits unknown | Could block scaling past 5 clients | Test limits in Week 1. Implement 2s throttle. Contingency: Twilio. |
| Nano Banana Pro with low-quality photos | Poor output = bad first impression | Test with real pilot photos Day 4. Fallback: use best original photo. |
| Whisper accuracy with kitchen noise | Misunderstood voice notes = wrong actions | Test with real recordings. Fallback: "No entendi tu nota de voz, me lo puedes escribir?" |
| Pilot patience (La Unica + El Patron) | They're confirmed but waiting | Deliver MIFGE photoshoot value within Week 1. |
| Cinco de Mayo (May 5) | Natural campaign opportunity | If timeline aligns, use as first tripwire theme. |
| Cold WhatsApp could get number banned | Lose the only WhatsApp number | Do NOT cold-message in MVP. In-person first, WhatsApp only after permission. |
| Human review bottleneck at 5+ clients | >2 hrs/day of review kills unit economics | Track review time per client. Target <25 min/client/day. |

---

## 18. Folder Structure

```
marketero-ai/
├── src/
│   ├── server.js              # Express app + health check
│   ├── worker.js              # Background workers (webhook processor, job poller)
│   ├── webhooks/
│   │   └── ghl.js             # Async webhook handler (save + respond 200)
│   ├── bot/
│   │   ├── classifier.js      # Hybrid: regex + Claude intent classification
│   │   ├── conversation.js    # Conversation state management
│   │   └── handlers/          # One handler per intent type
│   │       ├── approval.js
│   │       ├── change-request.js
│   │       ├── emergency.js
│   │       ├── faq.js
│   │       └── escalation.js
│   ├── content/
│   │   ├── generate.js        # Claude copy + Nano Banana image
│   │   ├── scheduler.js       # Job creation + poller
│   │   ├── emergency.js       # On-demand post flow
│   │   └── publish.js         # GHL publish with buffer + cancel
│   ├── onboarding/
│   │   └── sessions.js        # 4 micro-sessions workflow
│   ├── acquisition/
│   │   ├── mifge.js           # AI Photoshoot pipeline
│   │   ├── tripwire.js        # $19.99 kit generation (Phase B)
│   │   └── bridge.js          # Nurture sequence (Phase B)
│   ├── services/
│   │   ├── ghl.js             # GHL API client (WhatsApp + publishing + throttle)
│   │   ├── fal.js             # Nano Banana Pro client (with concurrency limit)
│   │   ├── claude.js          # Claude API client (Haiku + Sonnet)
│   │   ├── whisper.js         # OpenAI Whisper transcription
│   │   ├── google.js          # Places API
│   │   └── stripe.js          # Payments + subscription tracking
│   ├── db/
│   │   ├── client.js          # Supabase client
│   │   └── queries/           # Queries per table
│   └── brain/
│       ├── client.js          # Load/update client brain
│       └── industry.js        # Industry brain queries
├── review-queue/              # Simple HTML interface for operator
├── scripts/
│   ├── seed-industry-brain.js
│   └── create-test-restaurant.js
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # All 12 tables + indexes
├── .env.example
├── package.json
└── README.md
```

---

## 19. Human Review Queue

During MVP, every post passes through human review before reaching the client.

```
GET /review-queue
→ Lists posts in 'human_review' status with image + caption + restaurant name
→ Shows count of pending reviews
→ Ordered by created_at (oldest first)

POST /review-queue/:id/approve
→ Status: 'pending_client' → sends via WhatsApp to client
→ Links content_item_id to whatsapp_log

POST /review-queue/:id/reject
→ body: { feedback: "La imagen no se ve apetitosa, regenerar con mas luz" }
→ Saves feedback in content_items.human_feedback
→ Status: 'generating' → regenerates with feedback context
```

Simple HTML page. Does not need to be pretty — it is internal. Shows: restaurant name, image preview, caption text, approve/reject buttons, feedback text area.

---

## 20. Environment Variables

```env
# fal.ai
FAL_KEY=

# Anthropic (Claude)
ANTHROPIC_API_KEY=

# OpenAI (Whisper)
OPENAI_API_KEY=

# GHL
GHL_API_KEY=
GHL_LOCATION_ID=
GHL_WEBHOOK_SECRET=

# Google
GOOGLE_PLACES_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=price_xxx    # $99/month recurring

# App
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000
WEBHOOK_PATH=/webhooks/ghl

# Operational
MESSAGE_THROTTLE_MS=2000           # 2s between outbound WhatsApp messages
FAL_CONCURRENCY_LIMIT=3            # Max simultaneous image generations
PUBLISH_BUFFER_MINUTES=15          # Cancel window after approval
AUTOPILOT_REMINDER_MINUTES=90      # Reminder before autopilot publishes
AUTOPILOT_PUBLISH_MINUTES=120      # Auto-publish after no response
JOB_POLLER_INTERVAL_MS=60000       # Check for pending jobs every 60s
WEBHOOK_WORKER_INTERVAL_MS=5000    # Process webhooks every 5s
```

---

## Appendix A: Architecture Decisions Summary

Full details in `architecture/SWARM-ADR-2026-02-22.md`

| ADR | Decision | Key Reason |
|-----|----------|------------|
| 001 | Async webhook processing | GHL retries after 5s, Claude takes 2-5s = duplicates without async |
| 002 | Persistent job scheduling | node-cron is in-memory, restart = lost jobs = silent failure |
| 003 | Hybrid intent classification | 60% of messages are simple approvals, regex is 100x faster than LLM |
| 004 | Whisper for voice notes | Latino users send 3x more voice than text. Non-negotiable. |
| 005 | Daily-only mode in MVP | Weekly batch = message overload + ambiguous approvals + parsing complexity |
| 006 | Micro-session onboarding | 60 consecutive minutes is unrealistic for a busy restaurant owner |
| 007 | 15-minute publish buffer | Prevents accidental approvals from going live immediately |
| 008 | Database-as-queue | PostgreSQL is sufficient for <500 events/day, avoids Redis dependency |
| 009 | Pilots free, clients 3-5 paid | Need tolerance for iteration + need to validate willingness to pay |
| 010 | Direct sales for first 5 | Automated funnel takes 10-14 days/lead, direct sales takes 5-7 days |

---

## Appendix B: Cost Model (Per Client Per Month)

| Service | Usage | Cost |
|---------|-------|------|
| Claude Haiku (intent classification) | ~150 calls/month | ~$0.15 |
| Claude Sonnet (copy generation) | ~30 calls/month | ~$0.30 |
| fal.ai Nano Banana Pro (images) | ~30 images/month | ~$4.50 |
| Whisper (voice transcription) | ~60 notes/month (~30 min total) | ~$0.18 |
| GHL (per sub-account) | 1 sub-account | ~$5-10 |
| Supabase (shared) | Prorated | ~$1-2 |
| **Total AI + API cost** | | **~$6-17/client/month** |
| **Revenue** | | **$99/month** |
| **Gross margin (before human time)** | | **~83-94%** |

Human review time (the real cost): target <25 min/client/day. At $15/hr for a VA, that's ~$187/month per client. This is why progressive automation (Phase 2) is critical for unit economics. At 5 clients with the founder doing review, human cost is "free" (founder time).

---

*PRD v2.3 — Marketero AI — 2026-02-22*
*MVP = One product ($99/month) + Three systems (Acquisition + Fulfillment + Bot FAQ)*
*Validated by Swarm Agent debate (4 agents: Architect, Product Skeptic, UX Designer, GTM Strategist)*
*Architecture decisions documented in companion ADR*
