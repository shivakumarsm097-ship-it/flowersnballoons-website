-- Flowers 'N' Balloons — agent backend schema (Supabase / Postgres)
-- Apply in Supabase SQL editor or via migration.

create extension if not exists pgcrypto;

-- ── leads ────────────────────────────────────────────────────────────
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('whatsapp','web','instagram','phone')),
  name          text,
  phone         text,                       -- +91XXXXXXXXXX
  email         text,
  event_type    text,                       -- birthday | wedding | babyshower | ...
  event_date    date,                       -- date the customer asked for
  budget_range  text,
  raw_message   text,
  status        text not null default 'new'
                check (status in ('new','engaged','quoted','converted','cold','lost','escalated')),
  last_contact_at timestamptz not null default now(),  -- last message either direction
  followup_sent boolean not null default false,        -- one 24h nudge max
  created_at    timestamptz not null default now()
);
create index if not exists leads_phone_idx  on leads (phone);
create index if not exists leads_status_idx on leads (status);

-- ── conversations ────────────────────────────────────────────────────
-- Full message history per lead — the Lead & Quote agent's memory.
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id),
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists conversations_lead_idx on conversations (lead_id, created_at);

-- ── vendors ──────────────────────────────────────────────────────────
create table if not exists vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  role          text not null check (role in ('decorator','photographer','caterer','activity-staff')),
  contact       text not null,              -- WhatsApp number, +91XXXXXXXXXX
  service_areas text[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists vendors_role_idx on vendors (role) where active;

-- ── calendar_holds ───────────────────────────────────────────────────
-- Provisional slot reservation created the moment a quote is sent.
-- TTL-expired rows are ignored by every capacity query and swept by cron.
create table if not exists calendar_holds (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  event_type        text not null,
  lead_id           uuid not null references leads(id),
  quoted_price      integer,                -- full quote total (₹)
  advance_price     integer,                -- advance asked to lock in (₹)
  razorpay_link_id  text,                   -- payment link tied to this hold
  status            text not null default 'active'
                    check (status in ('active','converted','expired')),
  expires_at        timestamptz not null,   -- now() + HOLD_TTL_HOURS at creation
  created_at        timestamptz not null default now()
);
create index if not exists holds_date_idx    on calendar_holds (date);
create index if not exists holds_link_idx    on calendar_holds (razorpay_link_id);
create index if not exists holds_expires_idx on calendar_holds (expires_at);

-- ── bookings ─────────────────────────────────────────────────────────
-- Created ONLY by the Razorpay webhook converting a hold after payment.
-- confirmed_at stays null until every required vendor role has an
-- accepted assignment; customer gets "fully confirmed" only then.
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references leads(id),
  date            date not null,
  event_type      text not null,
  package         text,
  price           integer,                  -- ₹ advance actually paid
  total_price     integer,                  -- ₹ full quote (balance = total - price)
  balance_reminder_sent boolean not null default false,
  at_risk_at      timestamptz,              -- when escalation flipped it at_risk
  payment_status  text not null default 'paid'
                  check (payment_status in ('paid','refund_initiated','refunded')),
  razorpay_payment_id text,
  status          text not null default 'pending_vendors'
                  check (status in ('pending_vendors','confirmed','at_risk','rescheduling','refunded','cancelled','done')),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists bookings_date_idx   on bookings (date);
create index if not exists bookings_status_idx on bookings (status);

-- ── vendor_assignments ───────────────────────────────────────────────
-- Junction table: which vendor was asked to cover which role on which
-- booking. (This is the "vendor_assignments FK" on bookings — modelled
-- as a child table since one booking needs multiple roles.)
create table if not exists vendor_assignments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id),
  vendor_id     uuid not null references vendors(id),
  role          text not null,
  status        text not null default 'requested'
                check (status in ('requested','accepted','declined','no_response')),
  requested_at  timestamptz not null default now(),
  responded_at  timestamptz
);
create index if not exists assignments_booking_idx on vendor_assignments (booking_id);
create index if not exists assignments_vendor_idx  on vendor_assignments (vendor_id, status);
