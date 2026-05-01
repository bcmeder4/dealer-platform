// src/tracking/pixels.js
// ============================================================
// Server-side retargeting pixel events
// Fires on every VDP click BEFORE redirecting the visitor
//
// Why server-side instead of browser pixels:
//   - Works even with ad blockers
//   - iOS 14+ didn't break it (no cookie dependency)
//   - More accurate match rates (we have email hash)
//   - Required for co-op proof (server logs vs browser)
//   - One place to manage all pixel events
//
// Platforms:
//   - Meta Conversions API (Facebook + Instagram)
//   - Google Ads API (conversion tracking)
//   - TikTok Events API
// ============================================================

import crypto from 'crypto';
import fetch  from 'node-fetch';
import pool   from '../db/pool.js';

// ── Hash helper (required by all platforms for PII) ────────
// All personal data must be SHA-256 hashed before sending
function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256')
    .update(value.toString().toLowerCase().trim())
    .digest('hex');
}

// ── Get contact data for event enrichment ──────────────────
// Richer contact data = better audience match rates
async function getContactData(contactId) {
  if (!contactId) return {};
  const { rows: [contact] } = await pool.query(
    'SELECT email, phone, zip, first_name, last_name FROM contacts WHERE id = $1',
    [contactId]
  ).catch(() => ({ rows: [{}] }));
  return contact || {};
}

// ── Get vehicle data ────────────────────────────────────────
async function getVehicleData(vehicleId) {
  if (!vehicleId) return {};
  const { rows: [vehicle] } = await pool.query(
    'SELECT vin, year, make, model, trim, price FROM vehicles WHERE id = $1',
    [vehicleId]
  ).catch(() => ({ rows: [{}] }));
  return vehicle || {};
}

// ── Main event dispatcher ───────────────────────────────────
// Called from the /t/click route before redirect.
// Fires all enabled pixels in parallel — non-blocking.

export async function fireVdpClickPixels({
  sendId,
  contactId,
  vehicleId,
  vdpUrl,
  campaignId,
  dealerId,
  ip,
  userAgent,
  referer,
}) {
  // Load contact + vehicle data for enrichment
  const [contact, vehicle] = await Promise.all([
    getContactData(contactId),
    getVehicleData(vehicleId),
  ]);

  // Get dealer pixel credentials
  const { rows: [dealer] } = await pool.query(
    'SELECT * FROM dealers WHERE id = $1', [dealerId]
  ).catch(() => ({ rows: [{}] }));

  if (!dealer) return;

  // Build shared event data
  const eventData = {
    eventName:   'ViewContent',
    eventTime:   Math.floor(Date.now() / 1000),
    sourceUrl:   vdpUrl,
    ip,
    userAgent,
    contact,
    vehicle,
    campaignId,
    sendId,
  };

  // Fire all pixels in parallel — don't await, don't block the redirect
  const promises = [];

  if (dealer.meta_pixel_id && dealer.meta_access_token) {
    promises.push(
      fireMetaPixel(eventData, dealer).catch(err =>
        console.error('Meta pixel error:', err.message)
      )
    );
  }

  if (dealer.google_ads_customer_id && dealer.google_conversion_label) {
    promises.push(
      fireGoogleConversion(eventData, dealer).catch(err =>
        console.error('Google pixel error:', err.message)
      )
    );
  }

  if (dealer.tiktok_pixel_id && dealer.tiktok_access_token) {
    promises.push(
      fireTikTokPixel(eventData, dealer).catch(err =>
        console.error('TikTok pixel error:', err.message)
      )
    );
  }

  // Don't await — fire and forget so redirect is instant
  Promise.all(promises).catch(() => {});
}

// ============================================================
// META CONVERSIONS API
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
// Event: ViewContent (VDP view) — feeds retargeting audiences
// ============================================================

async function fireMetaPixel(eventData, dealer) {
  const { contact, vehicle, ip, userAgent, sourceUrl, eventTime } = eventData;

  const payload = {
    data: [{
      event_name:  'ViewContent',
      event_time:  eventTime,
      event_source_url: sourceUrl,
      action_source: 'website',

      // User data — all hashed (Meta requirement)
      user_data: {
        em:         hash(contact.email),       // email hash
        ph:         hash(contact.phone),       // phone hash
        fn:         hash(contact.first_name),  // first name hash
        ln:         hash(contact.last_name),   // last name hash
        zp:         hash(contact.zip),         // zip hash
        client_ip_address: ip,
        client_user_agent: userAgent,
        // fbc and fbp cookies can be added if available from browser
      },

      // Content data — what vehicle they viewed
      custom_data: {
        content_type:  'vehicle',
        content_ids:   [vehicle.vin],
        content_name:  `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        value:          vehicle.price,
        currency:      'USD',
        // Custom fields for automotive retargeting
        vehicle_make:  vehicle.make,
        vehicle_model: vehicle.model,
        vehicle_year:  vehicle.year,
        vehicle_vin:   vehicle.vin,
      },
    }],
    // Test event code — remove in production
    // test_event_code: 'TEST12345',
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${dealer.meta_pixel_id}/events?access_token=${dealer.meta_access_token}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }
  );

  const result = await res.json();
  if (result.error) throw new Error(result.error.message);

  // Log pixel event for co-op reporting
  await logPixelEvent({
    dealerId:   dealer.id,
    platform:   'meta',
    eventName:  'ViewContent',
    vehicleVin: vehicle.vin,
    campaignId: eventData.campaignId,
    sendId:     eventData.sendId,
    result:     result.events_received,
  });

  return result;
}

// ============================================================
// GOOGLE ADS CONVERSION API
// Docs: https://developers.google.com/google-ads/api/docs/conversions
// Conversion: VDP view — feeds Google retargeting audiences
// ============================================================

async function fireGoogleConversion(eventData, dealer) {
  const { contact, vehicle, ip, userAgent, sourceUrl, eventTime } = eventData;

  // Google Ads API requires OAuth — use the dealer's refresh token
  const accessToken = await getGoogleAccessToken(dealer);

  const payload = {
    conversions: [{
      gclid:             eventData.gclid || undefined,  // Google Click ID if available
      conversion_action: `customers/${dealer.google_ads_customer_id}/conversionActions/${dealer.google_conversion_label}`,
      conversion_date_time: new Date(eventTime * 1000).toISOString().replace('T', ' ').replace('Z', '+00:00'),
      conversion_value:  vehicle.price || 0,
      currency_code:     'USD',

      // Enhanced conversions — hashed user data for better match
      user_identifiers: [{
        hashed_email:        hash(contact.email),
        hashed_phone_number: hash(contact.phone),
        address_info: {
          hashed_first_name: hash(contact.first_name),
          hashed_last_name:  hash(contact.last_name),
          postal_code:       hash(contact.zip),
          country_code:      'US',
        },
      }],
    }],
    partial_failure: true,
  };

  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${dealer.google_ads_customer_id}/conversionAdjustments:uploadConversions`,
    {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'Authorization':     `Bearer ${accessToken}`,
        'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': process.env.GOOGLE_ADS_MANAGER_ID,
      },
      body: JSON.stringify(payload),
    }
  );

  const result = await res.json();

  await logPixelEvent({
    dealerId:   dealer.id,
    platform:   'google',
    eventName:  'VDP_view',
    vehicleVin: vehicle.vin,
    campaignId: eventData.campaignId,
    sendId:     eventData.sendId,
    result:     result.results?.length || 0,
  });

  return result;
}

// ============================================================
// TIKTOK EVENTS API
// Docs: https://ads.tiktok.com/marketing_api/docs?id=1741601162187777
// Event: ViewContent — feeds TikTok retargeting
// ============================================================

async function fireTikTokPixel(eventData, dealer) {
  const { contact, vehicle, ip, userAgent, sourceUrl, eventTime } = eventData;

  const payload = {
    pixel_code: dealer.tiktok_pixel_id,
    event:      'ViewContent',
    event_id:   `vdp_${eventData.sendId}_${Date.now()}`,  // deduplication ID
    timestamp:  new Date(eventTime * 1000).toISOString(),
    context: {
      page: {
        url:      sourceUrl,
        referrer: eventData.referer || '',
      },
      user: {
        email:      hash(contact.email),
        phone:      hash(contact.phone),
        ip,
        user_agent: userAgent,
      },
    },
    properties: {
      content_type: 'product',
      content_id:   vehicle.vin,
      content_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      currency:     'USD',
      value:        vehicle.price || 0,
      // Custom vehicle properties
      description:  `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}`.trim(),
    },
  };

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/pixel/track/', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': dealer.tiktok_access_token,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.code !== 0) throw new Error(result.message);

  await logPixelEvent({
    dealerId:   dealer.id,
    platform:   'tiktok',
    eventName:  'ViewContent',
    vehicleVin: vehicle.vin,
    campaignId: eventData.campaignId,
    sendId:     eventData.sendId,
    result:     1,
  });

  return result;
}

// ============================================================
// GOOGLE TAG MANAGER — client-side snippet
// Include in VDP pages (dealer website)
// This fires browser-side events for GTM/GA4
// ============================================================

export function generateGtmSnippet(dealer, vehicle) {
  if (!dealer.gtm_container_id) return '';

  return `
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${dealer.gtm_container_id}');</script>
<!-- End Google Tag Manager -->

<!-- VDP Data Layer Push -->
<script>
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event:          'vdp_view',
  vehicle_vin:    '${vehicle.vin}',
  vehicle_year:   ${vehicle.year},
  vehicle_make:   '${vehicle.make}',
  vehicle_model:  '${vehicle.model}',
  vehicle_price:  ${vehicle.price || 0},
  vehicle_status: '${vehicle.status}',
  dealer_name:    '${dealer.name}',
});
</script>`;
}

// ============================================================
// META PIXEL — client-side snippet
// Include in VDP pages on dealer website
// ============================================================

export function generateMetaPixelSnippet(dealer, vehicle) {
  if (!dealer.meta_pixel_id) return '';

  return `
<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${dealer.meta_pixel_id}');
fbq('track', 'ViewContent', {
  content_type:  'vehicle',
  content_ids:   ['${vehicle.vin}'],
  content_name:  '${vehicle.year} ${vehicle.make} ${vehicle.model}',
  value:          ${vehicle.price || 0},
  currency:      'USD',
});
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${dealer.meta_pixel_id}&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->`;
}

// ============================================================
// TIKTOK PIXEL — client-side snippet
// ============================================================

export function generateTikTokPixelSnippet(dealer, vehicle) {
  if (!dealer.tiktok_pixel_id) return '';

  return `
<!-- TikTok Pixel -->
<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify",
  "instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie",
  "holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){
  t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)
  ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],
  n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n)
  {var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},
  ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},
  ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,
  n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];
  e.parentNode.insertBefore(n,e)};ttq.load('${dealer.tiktok_pixel_id}');ttq.page();
  ttq.track('ViewContent', {
    content_type: 'product',
    content_id:   '${vehicle.vin}',
    content_name: '${vehicle.year} ${vehicle.make} ${vehicle.model}',
    currency:     'USD',
    value:        ${vehicle.price || 0},
  });
}(window, document, 'ttq');
</script>
<!-- End TikTok Pixel -->`;
}

// ── Log pixel events for reporting ─────────────────────────
async function logPixelEvent({ dealerId, platform, eventName, vehicleVin, campaignId, sendId, result }) {
  await pool.query(`
    INSERT INTO pixel_events
      (dealer_id, platform, event_name, vehicle_vin, campaign_id, send_id, result, fired_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
  `, [dealerId, platform, eventName, vehicleVin, campaignId || null, sendId || null, result?.toString() || '0'])
  .catch(() => {}); // silent fail — never block main flow
}

// ── Google OAuth helper ─────────────────────────────────────
async function getGoogleAccessToken(dealer) {
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: dealer.google_refresh_token });
  const { token } = await auth.getAccessToken();
  return token;
}
