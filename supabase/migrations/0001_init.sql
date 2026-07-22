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
