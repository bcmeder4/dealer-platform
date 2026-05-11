// ============================================================
// src/messaging/index.js
// Unified messaging layer — email + SMS
//
// Email providers (in priority order):
//   1. Postal (self-hosted, primary)
//   2. SendGrid (backup / overflow / transactional)
//
// SMS provider:
//   1. Twilio (campaigns, opt-in flow, two-way)
//
// The campaign scheduler calls sendMessage() and never
// needs to know which provider actually delivered it.
// ============================================================

import pool from '../db/pool.js';

// ── Provider selector ─────────────────────────────────────
// Automatically falls back to SendGrid if Postal fails
// or if domain health is too low

export async function sendEmail(opts) {
  const { provider = 'auto' } = opts;

  if (provider === 'sendgrid') {
    return sendViaSendGrid(opts);
  }

  if (provider === 'postal' || provider === 'auto') {
    try {
      const { sendEmail: postalSend } = await import('../smtp/sender.js');
      return await postalSend(opts);
    } catch (err) {
      if (provider === 'auto' && process.env.SENDGRID_API_KEY) {
        console.warn('Postal failed, falling back to SendGrid:', err.message);
        return sendViaSendGrid({ ...opts, fallback: true });
      }
      throw err;
    }
  }
}

// ============================================================
// src/messaging/sendgrid.js
// SendGrid email integration
// Docs: https://docs.sendgrid.com/api-reference/mail-send
// ============================================================

export async function sendViaSendGrid({
  from, fromName, replyTo, to, toName,
  subject, html, sendId, campaignSlug,
  dealerId, fallback = false,
}) {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY not configured');
  }

  const TRACKING_DOMAIN = process.env.TRACKING_DOMAIN;
  const pixelUrl  = `https://${TRACKING_DOMAIN}/t/open/${sendId}.png`;
  const trackedHtml = html + `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="">`;

  const payload = {
    personalizations: [{
      to: [{ email: to, name: toName || '' }],
    }],
    from: {
      email: from?.match(/<(.+)>/)?.[1] || from,
      name:  fromName || from?.match(/^(.+) </)?.[1]?.trim() || '',
    },
    reply_to: replyTo ? { email: replyTo } : undefined,
    subject,
    content: [{ type: 'text/html', value: trackedHtml }],
    // SendGrid click tracking — we handle our own so disable theirs
    tracking_settings: {
      click_tracking:    { enable: false },
      open_tracking:     { enable: false }, // we use our own pixel
      subscription_tracking: { enable: false },
    },
    // Custom args for webhook identification
    custom_args: {
      send_id:       sendId       || '',
      campaign_slug: campaignSlug || '',
      dealer_id:     dealerId     || '',
      fallback:      fallback ? 'true' : 'false',
    },
    // Categories for SendGrid dashboard
    categories: [campaignSlug || 'campaign', dealerId || 'unknown'],
    // List-Unsubscribe header
    headers: {
      'List-Unsubscribe':      `<https://${TRACKING_DOMAIN}/unsubscribe?cid=${sendId}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  // SendGrid returns 202 Accepted with no body on success
  if (response.status === 202) {
    const msgId = response.headers.get('x-message-id') || `sg-${Date.now()}`;

    if (sendId) {
      await pool.query(
        `UPDATE sends SET postal_msg_id=$1, status='sent', sent_at=NOW(),
         provider='sendgrid' WHERE id=$2`,
        [msgId, sendId]
      ).catch(() => {});
    }

    return { postalMsgId: msgId, provider: 'sendgrid' };
  }

  const errorBody = await response.json().catch(() => ({}));
  throw new Error(`SendGrid error ${response.status}: ${JSON.stringify(errorBody.errors || errorBody)}`);
}

// ============================================================
// src/messaging/sms.js
// Twilio SMS integration
// Docs: https://www.twilio.com/docs/sms/api
//
// Features:
//   - Outbound campaigns with VDP links
//   - Double opt-in flow
//   - STOP/HELP auto-response
//   - Phone number pool rotation
//   - MMS support (vehicle images)
//   - Two-way replies to back office
// ============================================================

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

function twilioAuth() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

async function twilioPost(path, body) {
  const params = new URLSearchParams(body);
  const res = await fetch(`${TWILIO_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Authorization': twilioAuth(),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (data.status >= 400 || data.code) {
    throw new Error(`Twilio error: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

// ── Send SMS ─────────────────────────────────────────────
export async function sendSms({ to, body, mediaUrl, dealerId, contactId, sendId, campaignId }) {
  if (!process.env.TWILIO_ACCOUNT_SID) throw new Error('Twilio not configured');

  // Check opt-in status
  const { rows: [contact] } = await pool.query(
    `SELECT sms_opted_in, sms_opted_out, phone FROM contacts WHERE id=$1`,
    [contactId]
  );
  if (!contact?.sms_opted_in)  throw new Error('Contact not opted in to SMS');
  if (contact?.sms_opted_out)  throw new Error('Contact has opted out of SMS');

  // Pick best sending number from pool
  const fromNumber = await pickSmsNumber(dealerId);

  const twilioBody = {
    To:   normalizePhone(to || contact.phone),
    From: fromNumber,
    Body: body,
  };

  // MMS — attach vehicle image if provided
  if (mediaUrl) twilioBody.MediaUrl = mediaUrl;

  const result = await twilioPost(
    `/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    twilioBody
  );

  // Log the send
  await pool.query(`
    INSERT INTO sms_sends
      (contact_id, dealer_id, campaign_id, send_id,
       from_number, to_number, body, twilio_sid,
       status, sent_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',NOW())
  `, [contactId, dealerId, campaignId || null, sendId || null,
      fromNumber, normalizePhone(to || contact.phone),
      body, result.sid]).catch(() => {});

  return { sid: result.sid, status: result.status, from: fromNumber };
}

// ── Send double opt-in invite ─────────────────────────────
// Sends the first message asking contact to reply YES
// Required before sending any marketing SMS

export async function sendOptInInvite({ contactId, dealerId, vehicleId }) {
  const { rows: [contact] } = await pool.query(
    'SELECT * FROM contacts WHERE id=$1', [contactId]
  );
  const { rows: [dealer]  } = await pool.query(
    'SELECT * FROM dealers WHERE id=$1', [dealerId]
  );
  const { rows: [vehicle] } = vehicleId
    ? await pool.query('SELECT * FROM vehicles WHERE id=$1', [vehicleId])
    : { rows: [null] };

  if (!contact?.phone) throw new Error('Contact has no phone number');
  if (contact.sms_opted_out) throw new Error('Contact has opted out');
  if (contact.sms_opted_in)  return { alreadyOptedIn: true };

  const vehicleStr = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : 'vehicle updates';

  const message = `${dealer.name}: Hi ${contact.first_name || 'there'}, ` +
    `we'd like to send you updates about ${vehicleStr} and other available inventory. ` +
    `Reply YES to receive messages or STOP to decline. ` +
    `Msg & data rates may apply.`;

  const fromNumber = await pickSmsNumber(dealerId);

  const result = await twilioPost(
    `/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      To:   normalizePhone(contact.phone),
      From: fromNumber,
      Body: message,
    }
  );

  // Log opt-in invite
  await pool.query(`
    INSERT INTO sms_optin_log
      (contact_id, dealer_id, vehicle_id, from_number,
       to_number, twilio_sid, status, sent_at)
    VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
  `, [contactId, dealerId, vehicleId || null, fromNumber,
      normalizePhone(contact.phone), result.sid]).catch(() => {});

  return { sid: result.sid, status: 'pending', message };
}

// ── Handle inbound SMS (Twilio webhook) ──────────────────
// Twilio calls POST /webhooks/sms when a reply arrives
// Handles: YES (opt-in), STOP (opt-out), HELP, and replies

export async function handleInboundSms({ from, to, body, twilioSid }) {
  const phone    = normalizePhone(from);
  const msgLower = body.trim().toLowerCase();

  // Find contact by phone
  const { rows: [contact] } = await pool.query(
    `SELECT * FROM contacts WHERE regexp_replace(phone,'[^0-9]','','g') = $1`,
    [phone.replace(/\D/g, '')]
  );

  // ── STOP / opt-out ───────────────────────────────────
  if (['stop','stopall','unsubscribe','cancel','quit','end'].includes(msgLower)) {
    if (contact) {
      await pool.query(
        `UPDATE contacts SET sms_opted_out=TRUE, sms_opted_in=FALSE,
         sms_opted_out_at=NOW() WHERE id=$1`,
        [contact.id]
      );
    }
    // Twilio requires STOP response — must confirm opt-out
    return {
      response: 'You have been unsubscribed and will receive no further messages. Reply START to re-subscribe.',
      action:   'opted_out',
    };
  }

  // ── START / re-subscribe ──────────────────────────────
  if (['start','yes','unstop'].includes(msgLower)) {
    if (contact) {
      await pool.query(
        `UPDATE contacts SET sms_opted_in=TRUE, sms_opted_out=FALSE,
         sms_opted_in_at=NOW() WHERE id=$1`,
        [contact.id]
      );
      // Update opt-in log
      await pool.query(
        `UPDATE sms_optin_log SET status='confirmed', confirmed_at=NOW()
         WHERE to_number=$1 AND status='pending'
         ORDER BY sent_at DESC LIMIT 1`,
        [phone]
      ).catch(() => {});
    }
    return {
      response: 'You\'re now subscribed! Reply STOP at any time to unsubscribe.',
      action:   'opted_in',
    };
  }

  // ── HELP ─────────────────────────────────────────────
  if (msgLower === 'help') {
    return {
      response: 'For assistance reply to this message or call us directly. Reply STOP to unsubscribe.',
      action:   'help',
    };
  }

  // ── Regular reply — route to back office ─────────────
  if (contact) {
    // Classify with AI and store as inbound reply
    await pool.query(`
      INSERT INTO inbound_sms
        (contact_id, from_number, to_number, body,
         twilio_sid, received_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
    `, [contact.id, phone, to, body, twilioSid]).catch(() => {});

    // Trigger AI classification (same as email replies)
    const { classifyAndStoreSmsReply } = await import('./smsClassifier.js').catch(() => ({ classifyAndStoreSmsReply: null }));
    if (classifyAndStoreSmsReply) {
      classifyAndStoreSmsReply({ contact, body, phone }).catch(() => {});
    }
  }

  return { response: null, action: 'reply_received' };
}

// ── SMS number pool ───────────────────────────────────────
// Rotates through available Twilio numbers for a dealer
// Same health scoring concept as email domain pool

async function pickSmsNumber(dealerId) {
  // Try dealer-specific number first
  const { rows: [num] } = await pool.query(`
    SELECT phone_number FROM sms_numbers
    WHERE dealer_id=$1
      AND status='active'
      AND sends_today < daily_limit
    ORDER BY (health_score * random()) DESC
    LIMIT 1
  `, [dealerId]).catch(() => ({ rows: [] }));

  if (num?.phone_number) return num.phone_number;

  // Fall back to platform shared number
  if (process.env.TWILIO_FROM_NUMBER) return process.env.TWILIO_FROM_NUMBER;

  throw new Error(`No SMS numbers available for dealer ${dealerId}`);
}

// ── Build SMS campaign message ────────────────────────────
// Generates personalized SMS with VDP link

export function buildSmsMessage({ contact, vehicle, dealer, type = 'campaign' }) {
  const firstName = contact.first_name || 'there';
  const veh = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : 'a vehicle';
  const price = vehicle?.price
    ? ` ($${Number(vehicle.price).toLocaleString()} MSRP)`
    : '';

  const templates = {
    campaign: `Hi ${firstName}! ${dealer.name} has a ${veh}${price} available that matches what you're looking for. Details: {VDP_LINK} Reply STOP to opt out.`,
    followup: `Hi ${firstName}, just following up on the ${veh} at ${dealer.name}. Still available! {VDP_LINK} Questions? Reply here. STOP to opt out.`,
    prequal:  `Hi ${firstName}! You're pre-qualified for the ${veh} at ${dealer.name}. Call us to set up a test drive: ${dealer.phone || ''}. STOP to opt out.`,
  };

  return templates[type] || templates.campaign;
}

// ── Normalize phone to E.164 ──────────────────────────────
function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

// ============================================================
// DB schema — run in Coolify terminal
// ============================================================
/*
-- Add SMS columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_in     BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_out    BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_in_at  TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ;

-- SMS sends log
CREATE TABLE IF NOT EXISTS sms_sends (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id   UUID REFERENCES contacts(id),
  dealer_id    UUID REFERENCES dealers(id),
  campaign_id  UUID REFERENCES campaigns(id),
  send_id      UUID,
  from_number  TEXT NOT NULL,
  to_number    TEXT NOT NULL,
  body         TEXT,
  media_url    TEXT,
  twilio_sid   TEXT,
  status       TEXT DEFAULT 'sent',
  delivered_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_sends_contact   ON sms_sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_sends_campaign  ON sms_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sms_sends_dealer    ON sms_sends(dealer_id, sent_at DESC);

-- SMS opt-in log
CREATE TABLE IF NOT EXISTS sms_optin_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id   UUID REFERENCES contacts(id),
  dealer_id    UUID REFERENCES dealers(id),
  vehicle_id   UUID REFERENCES vehicles(id),
  from_number  TEXT,
  to_number    TEXT,
  twilio_sid   TEXT,
  status       TEXT DEFAULT 'pending',
  sent_at      TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- Inbound SMS replies
CREATE TABLE IF NOT EXISTS inbound_sms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id   UUID REFERENCES contacts(id),
  from_number  TEXT NOT NULL,
  to_number    TEXT NOT NULL,
  body         TEXT,
  twilio_sid   TEXT,
  classification TEXT,
  ai_draft     TEXT,
  reviewed     BOOLEAN DEFAULT FALSE,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

-- SMS phone number pool
CREATE TABLE IF NOT EXISTS sms_numbers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id    UUID REFERENCES dealers(id),
  phone_number TEXT NOT NULL UNIQUE,
  twilio_sid   TEXT,
  status       TEXT DEFAULT 'active',
  health_score INT DEFAULT 100,
  daily_limit  INT DEFAULT 200,
  sends_today  INT DEFAULT 0,
  opt_out_count INT DEFAULT 0,
  added_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Add provider column to sends table
ALTER TABLE sends ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'postal';
*/

// ============================================================
// New environment variables needed in Coolify:
// ============================================================
// TWILIO_ACCOUNT_SID    = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// TWILIO_AUTH_TOKEN     = your auth token from twilio.com/console
// TWILIO_FROM_NUMBER    = +1XXXXXXXXXX (your Twilio number)
// SENDGRID_API_KEY      = SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Get Twilio credentials: console.twilio.com
// Get SendGrid API key:   app.sendgrid.com/settings/api_keys
// ============================================================

// ============================================================
// Add to server.js:
// ============================================================
// import { handleInboundSms } from './messaging/index.js';
//
// // Twilio calls this when an SMS reply arrives
// app.post('/webhooks/sms', express.urlencoded({ extended: false }), async (req, res) => {
//   const { From, To, Body, SmsSid } = req.body;
//   const result = await handleInboundSms({
//     from: From, to: To, body: Body, twilioSid: SmsSid,
//   });
//   // Twilio expects TwiML response
//   if (result.response) {
//     res.type('text/xml');
//     res.send(`<?xml version="1.0" encoding="UTF-8"?>
//       <Response><Message>${result.response}</Message></Response>`);
//   } else {
//     res.type('text/xml');
//     res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
//   }
// });
// ============================================================
