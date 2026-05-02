import fetch from 'node-fetch';
import pool from '../db/pool.js';
import { pickDomain, recordSend } from '../domains/pool.js';

const POSTAL_BASE = process.env.POSTAL_URL;
const TRACKING_DOMAIN = process.env.TRACKING_DOMAIN;

export async function sendEmail(opts) {
  const { from, replyTo, to, toName, subject, html, sendId, campaignSlug, dealerId } = opts;

  // Pick the healthiest available domain from the rotation pool
  let domain = null;
  let apiKey = process.env.POSTAL_API_KEY;

  if (dealerId) {
    try {
      domain = await pickDomain(dealerId);
      if (domain?.postal_server_key) apiKey = domain.postal_server_key;
    } catch (err) {
      console.warn('Domain pool fallback to default:', err.message);
    }
  }

  // Inject open tracking pixel
  const pixelUrl = `https://${TRACKING_DOMAIN}/t/open/${sendId}.png`;
  const trackedHtml = html + `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="">`;

 const payload = {
  to: [to],
  from:       domain ? `${opts.fromName || 'Sales'} <${domain.from_email}>` : from,
  reply_to:   replyTo || undefined,
  subject,
  html_body:  trackedHtml,
  tag:        campaignSlug || 'campaign',
};

const response = await fetch(`${POSTAL_BASE}/api/v1/send/message`, {
  method:  'POST',
  headers: {
    'X-Server-API-Key': apiKey,
    'Content-Type':     'application/json'
  },
  body: JSON.stringify(payload),
});

  const result = await response.json();
  if (result.status !== 'success') throw new Error(`Postal error: ${JSON.stringify(result)}`);

  const postalMsgId = result.data?.messages?.[to]?.id?.toString();

  if (sendId && postalMsgId) {
    await pool.query(
      `UPDATE sends SET postal_msg_id=$1, status='sent', sent_at=NOW() WHERE id=$2`,
      [postalMsgId, sendId]
    );
  }

  if (domain) await recordSend(domain.id);

  return { postalMsgId, domain: domain?.domain };
}

export async function sendBatch({ sends, campaign, dealer }) {
  const delayMs = (campaign.delay_seconds || 60) * 1000;
  let sent = 0, errors = 0;

  for (const send of sends) {
    try {
      await sendEmail({
        from:         `${campaign.from_name || dealer.from_name} <${campaign.from_email || dealer.from_email}>`,
        fromName:     campaign.from_name || dealer.from_name,
        replyTo:      campaign.reply_to  || dealer.reply_to,
        to:           send.contact.email,
        toName:       `${send.contact.first_name || ''} ${send.contact.last_name || ''}`.trim(),
        subject:      send.subject,
        html:         send.html,
        sendId:       send.id,
        campaignSlug: campaign.slug || campaign.id,
        dealerId:     dealer.id,
      });
      sent++;
    } catch (err) {
      errors++;
      await pool.query(
        `UPDATE sends SET status='failed', error_msg=$1 WHERE id=$2`,
        [err.message, send.id]
      );
    }
    if (sent < sends.length) await new Promise(r => setTimeout(r, delayMs));
  }

  return { sent, errors };
}
