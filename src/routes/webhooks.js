// ============================================================
// src/routes/webhooks.js
// Handles all Postal webhook events + AI reply classification
// ============================================================

import express from 'express';
import pool from '../db/pool.js';

const router = express.Router();

// ── Postal webhook handler ────────────────────────────────
// POST /webhooks/postal
router.post('/postal', async (req, res) => {
  res.sendStatus(200); // always respond fast

  const { event, payload } = req.body;
  if (!event || !payload) return;

  console.log(`Postal webhook: ${event}`, payload?.id);

  try {
    switch (event) {

      case 'MessageSent':
      case 'MessageDelivered':
        await handleDelivered(payload);
        break;

      case 'MessageBounced':
        await handleBounced(payload);
        break;

      case 'MessageDeliveryFailed':
        await handleFailed(payload);
        break;

      case 'MessageDelayed':
        await handleDelayed(payload);
        break;

      case 'MessageHeld':
        await handleHeld(payload);
        break;

      case 'MessageLoaded':
        await handleOpened(payload);
        break;

      case 'MessageLinkClicked':
        await handleLinkClicked(payload);
        break;

      case 'DomainDNSError':
        console.error('DNS error for domain:', payload?.domain);
        break;

      default:
        console.log('Unhandled Postal event:', event);
    }
  } catch (err) {
    console.error(`Webhook error for ${event}:`, err.message);
  }
});

// ── Event handlers ────────────────────────────────────────

async function handleDelivered(payload) {
  const msgId = payload?.id?.toString() || payload?.original_id?.toString();
  if (!msgId) return;

  await pool.query(
    `UPDATE sends SET status='delivered', delivered_at=NOW()
     WHERE postal_msg_id=$1 AND status!='bounced'`,
    [msgId]
  ).catch(() => {});
}

async function handleBounced(payload) {
  const msgId = payload?.original_id?.toString() || payload?.id?.toString();
  if (!msgId) return;

  const { rows: [send] } = await pool.query(
    `UPDATE sends SET status='bounced'
     WHERE postal_msg_id=$1 RETURNING contact_id, dealer_id`,
    [msgId]
  ).catch(() => ({ rows: [] }));

  if (send?.contact_id) {
    // Mark contact as bounced — remove from future sends
    await pool.query(
      `UPDATE contacts SET bounced=TRUE WHERE id=$1`,
      [send.contact_id]
    ).catch(() => {});

    // Update domain health score
    await updateDomainHealth(msgId, 'bounced');
  }
}

async function handleFailed(payload) {
  const msgId = payload?.id?.toString();
  if (!msgId) return;

  await pool.query(
    `UPDATE sends SET status='failed', error_msg=$1
     WHERE postal_msg_id=$2`,
    [payload?.details || 'Delivery failed', msgId]
  ).catch(() => {});
}

async function handleDelayed(payload) {
  const msgId = payload?.id?.toString();
  if (!msgId) return;

  // Log soft bounce — don't mark contact as bounced yet
  await pool.query(
    `UPDATE sends SET error_msg=$1
     WHERE postal_msg_id=$2`,
    [`Delayed: ${payload?.details || 'unknown reason'}`, msgId]
  ).catch(() => {});

  await updateDomainHealth(msgId, 'soft_bounce');
}

async function handleHeld(payload) {
  const msgId = payload?.id?.toString();
  if (!msgId) return;

  await pool.query(
    `UPDATE sends SET status='held', error_msg='Message held by Postal'
     WHERE postal_msg_id=$1`,
    [msgId]
  ).catch(() => {});
}

async function handleOpened(payload) {
  const msgId = payload?.id?.toString();
  if (!msgId) return;

  const openedAt = new Date(payload?.loaded_at || Date.now());
  const ip        = payload?.ip_address || null;
  const userAgent = payload?.user_agent || null;

  const { rows: [send] } = await pool.query(
    `UPDATE sends SET
       opened_at   = COALESCE(opened_at, $2),
       open_count  = open_count + 1,
       last_opened_at = $2
     WHERE postal_msg_id=$1
     RETURNING id, contact_id, vehicle_id, campaign_id`,
    [msgId, openedAt]
  ).catch(() => ({ rows: [] }));

  if (!send) return;

  // Log detailed open event
  await pool.query(
    `INSERT INTO open_events
       (send_id, contact_id, vehicle_id, campaign_id, opened_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [send.id, send.contact_id, send.vehicle_id, send.campaign_id,
     openedAt, ip, userAgent]
  ).catch(() => {});

  // Boost domain health on open
  await updateDomainHealth(msgId, 'opened');
}

async function handleLinkClicked(payload) {
  const msgId = payload?.id?.toString();
  const url   = payload?.url;
  if (!msgId) return;

  const { rows: [send] } = await pool.query(
    `UPDATE sends SET
       clicked_at  = COALESCE(clicked_at, NOW()),
       click_count = click_count + 1
     WHERE postal_msg_id=$1
     RETURNING id, contact_id, vehicle_id, campaign_id`,
    [msgId]
  ).catch(() => ({ rows: [] }));

  if (!send) return;

  // Log click event
  await pool.query(
    `INSERT INTO click_events
       (send_id, contact_id, vehicle_id, vdp_url, clicked_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,NOW(),$5,$6)`,
    [send.id, send.contact_id, send.vehicle_id, url || null,
     payload?.ip_address || null, payload?.user_agent || null]
  ).catch(() => {});

  // Boost domain health on click
  await updateDomainHealth(msgId, 'clicked');
}

// ── AI Reply Handler ──────────────────────────────────────
// POST /webhooks/inbound
// Called when Postal receives a reply to one of your emails
router.post('/inbound', async (req, res) => {
  res.sendStatus(200);

  const { message, rcpt_to, mail_from, subject, plain_body, html_body } = req.body;
  const replyText = plain_body || html_body?.replace(/<[^>]*>/g, '') || '';

  console.log(`Inbound reply from ${mail_from} re: ${subject}`);

  try {
    // Find the original send this is a reply to
    const { rows: [send] } = await pool.query(`
      SELECT s.*, c.first_name, c.last_name, c.email,
             v.year, v.make, v.model, v.price, v.vdp_url,
             d.name as dealer_name, d.brand, d.phone as dealer_phone
      FROM sends s
      JOIN contacts c ON c.id = s.contact_id
      LEFT JOIN vehicles v ON v.id = s.vehicle_id
      JOIN campaigns camp ON camp.id = s.campaign_id
      JOIN dealers d ON d.id = camp.dealer_id
      WHERE c.email ILIKE $1
      ORDER BY s.sent_at DESC
      LIMIT 1
    `, [mail_from]).catch(() => ({ rows: [] }));

    // Classify the reply with AI
    const classification = await classifyReply(replyText, send);

    // Store the inbound reply
    await pool.query(`
      INSERT INTO inbound_replies
        (send_id, contact_id, from_email, subject, body,
         classification, ai_draft, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [
      send?.id || null,
      send?.contact_id || null,
      mail_from,
      subject,
      replyText,
      classification.intent,
      classification.draft,
    ]).catch(() => {});

    // Auto-handle unsubscribe requests
    if (classification.intent === 'unsubscribe' && send?.contact_id) {
      await pool.query(
        `UPDATE contacts SET unsubscribed=TRUE, unsubscribed_at=NOW() WHERE id=$1`,
        [send.contact_id]
      ).catch(() => {});
      console.log(`Auto-unsubscribed ${mail_from} based on reply intent`);
    }

  } catch (err) {
    console.error('Inbound reply error:', err.message);
  }
});

// ── AI reply classification ───────────────────────────────
async function classifyReply(replyText, context) {
  try {
    const systemPrompt = `You are an assistant for an automotive dealership email platform.
Classify the intent of this email reply and draft a brief response.
Return JSON only with these fields:
{
  "intent": "interested" | "not_interested" | "unsubscribe" | "question" | "appointment" | "price_inquiry" | "other",
  "summary": "one sentence summary of the reply",
  "urgency": "high" | "medium" | "low",
  "draft": "a brief professional response draft from the dealer (2-3 sentences max)",
  "auto_send": false
}
Never set auto_send to true - always require human review.`;

    const userPrompt = context ? `
Customer: ${context.first_name} ${context.last_name}
Vehicle they were contacted about: ${context.year} ${context.make} ${context.model} - $${context.price}
Dealer: ${context.dealer_name}

Their reply:
${replyText}
` : `Reply: ${replyText}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });

    const data  = await response.json();
    const text  = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);

  } catch (err) {
    console.error('AI classification error:', err.message);
    return { intent: 'other', summary: 'Could not classify', urgency: 'low', draft: '', auto_send: false };
  }
}

// ── Domain health update helper ───────────────────────────
async function updateDomainHealth(postalMsgId, eventType) {
  try {
    const { rows: [send] } = await pool.query(
      `SELECT s.*, sd.id as domain_id
       FROM sends s
       JOIN campaigns c ON c.id = s.campaign_id
       JOIN sending_domains sd ON sd.dealer_id = c.dealer_id
       WHERE s.postal_msg_id = $1
       LIMIT 1`,
      [postalMsgId]
    );
    if (send?.domain_id) {
      const { handleDeliveryEvent } = await import('../domains/pool.js');
      await handleDeliveryEvent(send.domain_id, eventType);
    }
  } catch (err) {
    // Silent fail — don't block main flow
  }
}

// ── Unsubscribe webhook (from optout service) ─────────────
router.post('/unsubscribed', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== process.env.PLATFORM_WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }

  const { email_hash, dealer_id, send_id } = req.body;

  await pool.query(
    `UPDATE contacts SET unsubscribed=TRUE, unsubscribed_at=NOW()
     WHERE dealer_id=$1
     AND encode(sha256(lower(trim(email))::bytea),'hex')=$2`,
    [dealer_id, email_hash]
  ).catch(() => {});

  if (send_id) {
    await pool.query(
      `UPDATE sends SET status='unsubscribed' WHERE id=$1`,
      [send_id]
    ).catch(() => {});
  }

  res.sendStatus(200);
});

export default router;

// ============================================================
// Additional DB tables needed — run in Coolify terminal:
// ============================================================
/*
-- Open events table (detailed open tracking)
CREATE TABLE IF NOT EXISTS open_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  send_id     UUID REFERENCES sends(id) ON DELETE CASCADE,
  contact_id  UUID REFERENCES contacts(id),
  vehicle_id  UUID REFERENCES vehicles(id),
  campaign_id UUID REFERENCES campaigns(id),
  opened_at   TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  UNIQUE(send_id, opened_at)
);
CREATE INDEX IF NOT EXISTS idx_open_events_send ON open_events(send_id);
CREATE INDEX IF NOT EXISTS idx_open_events_campaign ON open_events(campaign_id, opened_at DESC);

-- Add last_opened_at to sends table
ALTER TABLE sends ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

-- Inbound replies table
CREATE TABLE IF NOT EXISTS inbound_replies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  send_id         UUID REFERENCES sends(id),
  contact_id      UUID REFERENCES contacts(id),
  from_email      TEXT NOT NULL,
  subject         TEXT,
  body            TEXT,
  classification  TEXT,
  urgency         TEXT DEFAULT 'medium',
  ai_draft        TEXT,
  reviewed        BOOLEAN DEFAULT FALSE,
  sent            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbound_replies_contact ON inbound_replies(contact_id);
CREATE INDEX IF NOT EXISTS idx_inbound_replies_reviewed ON inbound_replies(reviewed, created_at DESC);
*/

// ============================================================
// Add to server.js:
// import webhooksRouter from './routes/webhooks.js';
// app.use('/webhooks', webhooksRouter);
//
// New env var needed:
// ANTHROPIC_API_KEY=your_anthropic_api_key
// Get it from: console.anthropic.com
// ============================================================
