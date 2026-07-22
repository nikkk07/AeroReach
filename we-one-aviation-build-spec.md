# We One Aviation — Flying School Partnership Outreach System
### Build Specification (hand this file to Claude Code as project context)

---

## 0. What we are building

An internal tool that (1) sources flying schools worldwide from public data, (2) sends professional, personalized partnership-offer emails, (3) detects and classifies replies, (4) books meetings with interested schools, and (5) shows everything on a dashboard.

**Owner:** We One Aviation (weoneaviation.com)
**Primary target countries:** United States, Australia, Canada.

The AI writes and classifies text only. Sourcing and sending are non-AI infrastructure. Keep these layers separate.

---

## 1. Stack (all free tier)

| Concern | Tool |
|---|---|
| Database, Auth, cron, webhooks | Supabase (Postgres + `pg_cron` + Edge Functions) |
| LLM (email drafting + reply classification) | Groq (Llama 3.3 70B) |
| Outbound email | Resend (100/day, 3,000/mo free) |
| Inbound email (reply capture) | Cloudflare Email Routing → Worker → webhook |
| File hosting (partnership PDFs) | Cloudflare R2 (public bucket) |
| Backend API / jobs | Render free (note: sleeps when idle) |
| Scheduler (wakes Render, runs jobs) | GitHub Actions cron OR Supabase `pg_cron` |
| Dashboard frontend | Next.js on Vercel free |
| Meeting booking | Cal.com (free tier) |

**Architectural constraint:** free Render/Vercel cannot run an always-on worker. All recurring work (send batch, poll follow-ups) is triggered by cron hitting an endpoint. Design every job to be idempotent and short.

---

## 2. HARD COMPLIANCE RULES (encode these in code, do not leave to the user)

These are non-negotiable requirements, not suggestions.

1. **Only email addresses sourced from the school's own public website or an official aviation registry.** Store `source_url` for every email. No addresses from behind logins or from sites whose terms forbid scraping.
2. **Every outbound email must contain:** real sender identity (We One Aviation), a physical business address, an accurate subject line, and a working one-click unsubscribe link.
3. **Unsubscribe is automatic and permanent.** An unsubscribe writes to a `suppression` table; the send job must check `suppression` before every send and skip suppressed addresses.
4. **Canada (CASL):** only send to Canadian schools where the email was conspicuously published on their own site (implied consent) and the pitch is relevant to their business. Fines reach $10M per violation, so this check is mandatory, not optional.
5. **Bounces and spam-complaints** (from Resend webhooks) auto-set the lead to `bounced`/`suppressed` and stop all future sends to it.
6. **Volume cap:** never exceed 100 sends/day (Resend free limit AND good deliverability). Enforce in the send job.

> Not legal advice — We One Aviation should confirm CASL/Spam Act specifics before sending to CA/AU.

---

## 3. Database schema (Supabase / Postgres)

```sql
-- Schools / leads
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null,              -- 'US' | 'AU' | 'CA' | ...
  state_region text,
  city text,
  address text,
  lat double precision,
  lng double precision,
  phone text,
  email text,
  website text,
  source text,                        -- 'registry' | 'osm' | 'website' | 'places'
  source_url text,                    -- provenance for compliance audit
  certified boolean default false,    -- FAA Part 141 / CASA 141-142 / TC FTU
  lead_score int default 0,
  status text default 'new',          -- new|queued|contacted|replied|interested|not_interested|meeting_booked|unsubscribed|bounced
  timezone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (email)
);

-- Campaigns
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  from_email text not null,           -- outreach@... subdomain
  active boolean default true,
  created_at timestamptz default now()
);

-- One conversation per school+campaign (threading + running state)
create table conversations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),
  campaign_id uuid references campaigns(id),
  stage text default 'cold',          -- cold|contacted|replied|negotiating|meeting_booked|closed
  summary text,                       -- one-line AI summary, refreshed each turn
  last_activity_at timestamptz default now(),
  unique (school_id, campaign_id)
);

-- Every message, both directions
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  school_id uuid references schools(id),
  direction text not null,            -- 'outbound' | 'inbound'
  subject text,
  body text,
  ai_generated boolean default false,
  status text default 'draft',        -- draft|approved|sent|failed|received
  intent text,                        -- for inbound: interested|not_interested|question|auto_reply|unsubscribe
  resend_id text,
  created_at timestamptz default now(),
  sent_at timestamptz
);

-- Follow-up sequence steps
create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),
  step_number int not null,
  scheduled_for timestamptz not null,
  sent boolean default false
);

-- Suppression list (unsubscribes, bounces, complaints)
create table suppression (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text,                        -- unsubscribe|bounce|complaint|manual
  created_at timestamptz default now()
);

-- Meetings
create table meetings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),
  calcom_booking_id text,
  scheduled_at timestamptz,
  status text default 'booked',
  created_at timestamptz default now()
);

-- Activity log for the dashboard
create table events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),
  type text,                          -- sourced|drafted|approved|sent|replied|booked|unsubscribed|bounced
  detail text,
  created_at timestamptz default now()
);
```

---

## 4. The AI jobs (Groq)

**A. Draft outreach email.**
Input: school name, country, city, certified flag, a short snippet scraped from their site, tone = "professional, warm, concise."
Output: subject + body. The model personalizes ONLY the relevance hook. The compliance block (identity, address, unsubscribe, link to R2-hosted partnership deck) is appended by code as a fixed template, never generated.

**B. Classify inbound reply.**
Input: full thread history + the new inbound message.
Output: `intent` ∈ {interested, not_interested, question, auto_reply, unsubscribe} + a refreshed one-line `summary` for the conversation.

**C. Draft reply.**
- `interested` → warm reply + Cal.com booking link → queue for human approval.
- `question` → draft answer from a fixed FAQ/offer context → human approval.
- `not_interested` → mark, stop sequence, no reply.
- `unsubscribe` → add to suppression, stop everything.

Always pass full thread history so context is never lost. Keep the offer facts (courses, fee structure) in a fixed context block so the model never invents them.

---

## 5. Email deliverability setup (do before any sending)

- Send from a **subdomain**, e.g. `outreach.weoneaviation.com`, so complaints never damage the main domain.
- Configure **SPF, DKIM, DMARC** on that subdomain in Resend.
- **Warm up:** start ~10/day, ramp slowly toward 100.
- **Never attach PDFs.** Host the partnership deck / curriculum / fee structure on R2 and link to them.

---

## 6. Build order (do these in sequence in Claude Code)

**Phase 1 — Foundation & sourcing (US first)**
- Set up Supabase project, run the schema above.
- Sourcing script for the US: pull from FAA Part 141 data + OpenStreetMap (Overpass, `aeroway`/`flight_school`), then fetch each school's site and extract public email/phone. Record `source_url`. Dedup on email.
- Populate `schools`. Verify data quality before touching email.

**Phase 2 — Outreach + human approval + send**
- Groq email-drafting job (job A) → writes `messages` rows as `draft`.
- Dashboard approval queue: human clicks approve → status `approved`.
- Send job (cron): takes `approved`, checks `suppression`, enforces 100/day cap, sends via Resend, writes `sent_at` + `resend_id`, logs event.

**Phase 3 — Inbound + classification**
- Cloudflare Email Routing → Worker → webhook → insert inbound `messages`.
- Resend webhooks for bounce/complaint → suppression.
- Classification job (job B) sets `intent`, updates `conversations.stage` + `summary`.

**Phase 4 — Follow-ups + booking**
- `sequence_steps`: 2–3 follow-ups, auto-stopped the moment a reply arrives.
- Reply-drafting (job C) + Cal.com link injection + booking capture into `meetings`.

**Phase 5 — Dashboard (Next.js on Vercel)**
- Funnel (sourced → contacted → replied → interested → booked), per-lead thread view with AI summary, approval queue, daily quota gauge, open/reply rates, compliance panel (unsubscribes, suppression, per-lead `source_url`).

**Phase 6 — Scale**
- Add Australia (CASA 141/142) and Canada (Transport Canada FTU) sourcing.
- Add lead scoring, timezone-aware send windows, A/B subject lines.

---

## 7. Environment variables

```
GROQ_API_KEY=
RESEND_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
CALCOM_API_KEY=
SENDING_DOMAIN=outreach.weoneaviation.com
BUSINESS_PHYSICAL_ADDRESS=
UNSUBSCRIBE_BASE_URL=
```

---

## 8. Definition of done for v1

- Sources US flying schools with valid public emails + provenance.
- Drafts personalized emails; nothing sends without human approval.
- Sends within the 100/day cap; suppression + bounce handling work.
- Captures and classifies replies; routes interested → booking link.
- Dashboard shows the funnel and per-lead threads.
- Every outbound email is CASL/CAN-SPAM compliant by construction.