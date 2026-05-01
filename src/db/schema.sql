CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Dealers
CREATE TABLE IF NOT EXISTS dealers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  brand                 TEXT NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,
  ftp_host              TEXT,
  ftp_user              TEXT,
  ftp_pass              TEXT,
  ftp_path              TEXT DEFAULT '/feeds/vehicles/',
  ftp_schedule          TEXT DEFAULT '0 6 * * *',
  from_name             TEXT,
  from_email            TEXT,
  reply_to              TEXT,
  brand_color           TEXT DEFAULT '#1a6cff',
  logo_url              TEXT,
  phone                 TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  zip                   TEXT,
  website_url           TEXT,
  lat                   NUMERIC,
  lng                   NUMERIC,
  target_zips           TEXT[],
  google_merchant_id    TEXT,
  google_ads_customer_id TEXT,
  google_refresh_token  TEXT,
  google_store_code     TEXT,
  meta_ad_account_id    TEXT,
  meta_catalog_id       TEXT,
  meta_page_id          TEXT,
  meta_access_token     TEXT,
  tiktok_advertiser_id  TEXT,
  tiktok_access_token   TEXT,
  tiktok_location_id    TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id     UUID REFERENCES dealers(id) ON DELETE CASCADE,
  vin           TEXT NOT NULL,
  year          INT NOT NULL,
  make          TEXT NOT NULL,
  model         TEXT NOT NULL,
  trim          TEXT,
  color         TEXT,
  price         NUMERIC(10,2),
  miles         INT DEFAULT 0,
  status        TEXT CHECK (status IN ('new','used','cpo','sold','inactive')) DEFAULT 'new',
  stock_num     TEXT,
  vdp_url       TEXT NOT NULL,
  image_url     TEXT,
  body_style    TEXT,
  drivetrain    TEXT,
  fuel_type     TEXT,
  transmission  TEXT,
  imported_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dealer_id, vin)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_dealer ON vehicles(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicles_make   ON vehicles(make, model, status);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id             UUID REFERENCES dealers(id) ON DELETE CASCADE,
  email                 TEXT NOT NULL,
  first_name            TEXT,
  last_name             TEXT,
  phone                 TEXT,
  zip                   TEXT,
  city                  TEXT,
  state                 TEXT,
  make_interest         TEXT,
  model_interest        TEXT,
  status                TEXT CHECK (status IN ('conquest','existing','service','inactive')) DEFAULT 'conquest',
  last_purchase_year    INT,
  last_purchase_make    TEXT,
  last_purchase_model   TEXT,
  last_purchase_miles   INT,
  tags                  TEXT[] DEFAULT '{}',
  unsubscribed          BOOLEAN DEFAULT FALSE,
  unsubscribed_at       TIMESTAMPTZ,
  bounced               BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dealer_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_dealer ON contacts(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_unsub  ON contacts(dealer_id, unsubscribed, bounced);

-- Segments
CREATE TABLE IF NOT EXISTS segments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id     UUID REFERENCES dealers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  filters       JSONB NOT NULL DEFAULT '{}',
  contact_count INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id         UUID REFERENCES dealers(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  segment_id        UUID REFERENCES segments(id),
  vehicle_ids       UUID[] DEFAULT '{}',
  subject_template  TEXT NOT NULL,
  body_template     TEXT NOT NULL,
  from_name         TEXT,
  from_email        TEXT,
  reply_to          TEXT,
  status            TEXT CHECK (status IN ('draft','scheduled','sending','sent','paused','cancelled')) DEFAULT 'draft',
  send_at           TIMESTAMPTZ,
  daily_limit       INT DEFAULT 50,
  delay_seconds     INT DEFAULT 60,
  coop_approved     BOOLEAN DEFAULT FALSE,
  coop_pdf_url      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Sends
CREATE TABLE IF NOT EXISTS sends (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id),
  vehicle_id      UUID REFERENCES vehicles(id),
  step_index      INT DEFAULT 0,
  subject         TEXT,
  postal_msg_id   TEXT,
  status          TEXT CHECK (status IN ('queued','sent','delivered','bounced','complained','failed','unsubscribed')) DEFAULT 'queued',
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  open_count      INT DEFAULT 0,
  clicked_at      TIMESTAMPTZ,
  click_count     INT DEFAULT 0,
  replied_at      TIMESTAMPTZ,
  error_msg       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sends_campaign ON sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_sends_contact  ON sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_sends_postal   ON sends(postal_msg_id);

-- Click events
CREATE TABLE IF NOT EXISTS click_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  send_id     UUID REFERENCES sends(id),
  contact_id  UUID REFERENCES contacts(id),
  vehicle_id  UUID REFERENCES vehicles(id),
  vdp_url     TEXT,
  clicked_at  TIMESTAMPTZ DEFAULT NOW(),
  ip          TEXT,
  user_agent  TEXT
);

-- Sending domains (rotation pool)
CREATE TABLE IF NOT EXISTS sending_domains (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id         UUID REFERENCES dealers(id) ON DELETE CASCADE,
  domain            TEXT NOT NULL UNIQUE,
  display_name      TEXT,
  from_email        TEXT,
  smtp_host         TEXT,
  smtp_port         INT DEFAULT 587,
  smtp_user         TEXT,
  smtp_pass         TEXT,
  postal_server_key TEXT,
  health_score      INT DEFAULT 100,
  status            TEXT DEFAULT 'warming'
                    CHECK (status IN ('warming','active','caution','restricted','suspended','retired')),
  daily_limit       INT DEFAULT 5,
  sends_today       INT DEFAULT 0,
  sends_total       INT DEFAULT 0,
  bounce_count      INT DEFAULT 0,
  complaint_count   INT DEFAULT 0,
  open_count        INT DEFAULT 0,
  last_send_at      TIMESTAMPTZ,
  warmup_started    TIMESTAMPTZ DEFAULT NOW(),
  graduated_at      TIMESTAMPTZ,
  notes             TEXT,
  added_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dealer_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_domains_pool ON sending_domains(dealer_id, status, health_score DESC);

-- Domain daily stats
CREATE TABLE IF NOT EXISTS domain_daily_stats (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id    UUID REFERENCES sending_domains(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  sends        INT DEFAULT 0,
  delivered    INT DEFAULT 0,
  bounced      INT DEFAULT 0,
  complained   INT DEFAULT 0,
  opened       INT DEFAULT 0,
  clicked      INT DEFAULT 0,
  health_score INT,
  UNIQUE(domain_id, date)
);

-- Ad campaigns
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id             UUID REFERENCES dealers(id) ON DELETE CASCADE,
  platform              TEXT NOT NULL CHECK (platform IN ('google','meta','tiktok','email')),
  name                  TEXT NOT NULL,
  status                TEXT DEFAULT 'pending_review'
                        CHECK (status IN ('pending_review','active','paused','rejected','completed')),
  monthly_budget_cents  INT DEFAULT 0,
  vehicle_id            UUID REFERENCES vehicles(id),
  model_groups          JSONB,
  campaign_resource     TEXT,
  ad_group_resource     TEXT,
  meta_campaign_id      TEXT,
  meta_adset_id         TEXT,
  meta_ad_id            TEXT,
  meta_creative_id      TEXT,
  tiktok_campaign_id    TEXT,
  tiktok_adgroup_id     TEXT,
  tiktok_ad_id          TEXT,
  overlay_text          TEXT,
  reject_reason         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  enabled_at            TIMESTAMPTZ,
  rejected_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_dealer ON ad_campaigns(dealer_id, status);

-- Dealer budgets
CREATE TABLE IF NOT EXISTS dealer_budgets (
  dealer_id         UUID REFERENCES dealers(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  monthly_cap_cents INT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (dealer_id, platform)
);

-- Ad events
CREATE TABLE IF NOT EXISTS ad_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID REFERENCES ad_campaigns(id),
  platform          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  platform_click_id TEXT,
  vin               TEXT,
  lead_name         TEXT,
  lead_email        TEXT,
  lead_phone        TEXT,
  value_cents       INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- FTP import log
CREATE TABLE IF NOT EXISTS ftp_imports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id     UUID REFERENCES dealers(id),
  filename      TEXT,
  rows_total    INT DEFAULT 0,
  rows_imported INT DEFAULT 0,
  rows_skipped  INT DEFAULT 0,
  rows_error    INT DEFAULT 0,
  status        TEXT CHECK (status IN ('running','complete','failed')) DEFAULT 'running',
  log           TEXT[],
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

-- Co-op reports
CREATE TABLE IF NOT EXISTS coop_reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id  UUID REFERENCES campaigns(id),
  dealer_id    UUID REFERENCES dealers(id),
  oem_brand    TEXT,
  checks       JSONB,
  score        INT,
  pdf_path     TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
