-- ============================================================
-- Add to schema.sql — pixel events tracking table
-- ============================================================

CREATE TABLE IF NOT EXISTS pixel_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id   UUID REFERENCES dealers(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok','gtm')),
  event_name  TEXT NOT NULL,
  vehicle_vin TEXT,
  campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  send_id     UUID REFERENCES sends(id) ON DELETE SET NULL,
  result      TEXT,
  fired_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pixel_events_dealer
  ON pixel_events(dealer_id, platform, fired_at DESC);

-- Add pixel credentials to dealers table
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS meta_pixel_id         TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS tiktok_pixel_id       TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS gtm_container_id      TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS google_conversion_label TEXT;


-- ============================================================
-- Updated /t/click route for server.js
-- Replace the existing app.get('/t/click') with this version
-- ============================================================

-- Paste this into src/server.js replacing the existing /t/click route:

/*
import { fireVdpClickPixels } from './tracking/pixels.js';

app.get('/t/click', async (req, res) => {
  const { sid, vid, url, did } = req.query;
  if (!url) return res.redirect('/');

  // 1. Log click in database
  if (sid) {
    pool.query(
      `UPDATE sends
       SET clicked_at  = COALESCE(clicked_at, NOW()),
           click_count = click_count + 1
       WHERE id = $1`,
      [sid]
    ).catch(() => {});

    pool.query(
      `INSERT INTO click_events
         (send_id, vehicle_id, vdp_url, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [sid, vid || null, url, req.ip, req.get('user-agent')]
    ).catch(() => {});
  }

  // 2. Fire retargeting pixels (non-blocking — redirect happens immediately)
  if (did) {
    fireVdpClickPixels({
      sendId:     sid     || null,
      contactId:  req.query.cid || null,
      vehicleId:  vid     || null,
      vdpUrl:     url,
      campaignId: req.query.camp || null,
      dealerId:   did,
      ip:         req.ip,
      userAgent:  req.get('user-agent'),
      referer:    req.get('referer'),
    }).catch(() => {}); // never block the redirect
  }

  // 3. Redirect to VDP immediately — pixels fire in background
  res.redirect(302, url);
});
*/


-- ============================================================
-- How to add pixel IDs for a dealer (run in DB terminal)
-- ============================================================

/*
UPDATE dealers SET
  meta_pixel_id          = 'YOUR_META_PIXEL_ID',
  tiktok_pixel_id        = 'YOUR_TIKTOK_PIXEL_ID',
  gtm_container_id       = 'GTM-XXXXXXX',
  google_conversion_label = 'YOUR_CONVERSION_LABEL'
WHERE slug = 'metro-ford-dallas';
*/


-- ============================================================
-- Pixel IDs — where to find them
-- ============================================================

-- META PIXEL ID
-- 1. Go to business.facebook.com
-- 2. Click Events Manager in the left sidebar
-- 3. Click your pixel (or create one — Connect Data Sources → Web → Meta Pixel)
-- 4. The Pixel ID is the number shown under your pixel name
-- 5. Also get your Access Token from:
--    Events Manager → your pixel → Settings → Conversions API → Generate Access Token

-- GOOGLE TAG MANAGER
-- 1. Go to tagmanager.google.com
-- 2. Create an account for your dealer
-- 3. The Container ID looks like GTM-XXXXXXX
-- 4. Copy the GTM snippet and add it to the dealer's website <head>
-- 5. In GTM create a trigger for VDP URL pattern
-- 6. Add Google Ads conversion tag firing on that trigger

-- GOOGLE ADS CONVERSION LABEL
-- 1. Go to ads.google.com
-- 2. Tools → Measurement → Conversions
-- 3. Create a new conversion action → Website
-- 4. Name it "VDP View"
-- 5. Copy the Conversion Label (looks like: AbCdEfGhIj-AbCdEfGhIjKlMnOp)

-- TIKTOK PIXEL ID
-- 1. Go to ads.tiktok.com
-- 2. Assets → Events → Web Events
-- 3. Create pixel → Manually install pixel code
-- 4. Copy the Pixel ID (looks like: C4ABC123DEF456)
-- 5. Generate an Events API access token from the same screen


-- ============================================================
-- Retargeting audience strategy for auto dealers
-- ============================================================

-- META AUDIENCES TO CREATE (in Ads Manager → Audiences):
-- 1. "VDP Viewers — 30 days"
--    Source: Meta Pixel → ViewContent event → Last 30 days
--    Use for: carousel retargeting showing vehicles they viewed
--
-- 2. "VDP Viewers — 7 days (hot)"
--    Source: Meta Pixel → ViewContent event → Last 7 days
--    Use for: aggressive retargeting with urgency messaging
--
-- 3. "Email clickers — lookalike"
--    Source: Upload contact list → Create 1% lookalike
--    Use for: conquest campaigns finding similar buyers
--
-- 4. "Existing customers — exclude"
--    Source: Upload customer list
--    Use for: suppression — don't retarget people who already bought

-- GOOGLE AUDIENCES TO CREATE (in Google Ads → Audience Manager):
-- 1. "VDP viewers" — website visitors who triggered VDP conversion
-- 2. "High intent" — viewed 3+ VDPs in 7 days
-- 3. "Similar audiences" — Google's auto-generated lookalike

-- TIKTOK AUDIENCES:
-- 1. "VDP viewers" — pixel ViewContent event → 30 days
-- 2. "Email list custom audience" — upload hashed email list
