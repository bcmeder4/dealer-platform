import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import crypto from 'crypto';
import fetch from 'node-fetch';

const app  = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const pool = new pg.Pool({ connectionString: process.env.SUPPRESSION_DB_URL });

const JWT_SECRET              = process.env.SUPPRESSION_JWT_SECRET;
const PLATFORM_WEBHOOK_URL    = process.env.PLATFORM_WEBHOOK_URL;
const PLATFORM_WEBHOOK_SECRET = process.env.PLATFORM_WEBHOOK_SECRET;
const OPT_OUT_DOMAIN          = process.env.OPT_OUT_DOMAIN;

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Mint unsubscribe token (called by main platform)
app.post('/api/mint', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== PLATFORM_WEBHOOK_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const { email, dealerId, sendId } = req.body;
  if (!email || !dealerId) return res.status(400).json({ error: 'email and dealerId required' });

  const token = jwt.sign(
    { eh: hashEmail(email), did: dealerId, sid: sendId || null },
    JWT_SECRET,
    { expiresIn: '60d' }
  );

  res.json({ url: `https://${OPT_OUT_DOMAIN}/unsub?t=${token}` });
});

// One-click unsubscribe page
app.get('/unsub', async (req, res) => {
  const { t } = req.query;
  if (!t) return res.send(page('Invalid link', 'This unsubscribe link is not valid.', false));

  let decoded;
  try { decoded = jwt.verify(t, JWT_SECRET); }
  catch { return res.send(page('Link expired', 'This link has expired. Please use the link from your most recent email.', false)); }

  const { eh: emailHash, did: dealerId, sid: sendId } = decoded;

  const { rows: [existing] } = await pool.query(
    'SELECT id FROM suppressions WHERE email_hash=$1 AND dealer_id=$2',
    [emailHash, dealerId]
  );

  if (!existing) {
    await pool.query(
      `INSERT INTO suppressions (email_hash, dealer_id, source, ip, user_agent)
       VALUES ($1,$2,'one_click',$3,$4) ON CONFLICT (email_hash, dealer_id) DO NOTHING`,
      [emailHash, dealerId, req.ip, req.get('user-agent')]
    );
    await pool.query(
      `INSERT INTO unsub_log (email_hash, dealer_id, send_id, action, ip) VALUES ($1,$2,$3,'unsubscribed',$4)`,
      [emailHash, dealerId, sendId, req.ip]
    );
    notifyPlatform({ emailHash, dealerId, sendId }).catch(() => {});
  }

  res.send(page("You're unsubscribed", "You've been removed from this sender's list and won't receive further emails from them.", true));
});

// RFC 8058 one-click POST (Gmail/Outlook native unsubscribe button)
app.post('/unsub', async (req, res) => {
  const t = req.query.t || req.body?.t;
  if (!t) return res.sendStatus(400);
  let decoded;
  try { decoded = jwt.verify(t, JWT_SECRET); } catch { return res.sendStatus(400); }
  const { eh: emailHash, did: dealerId, sid: sendId } = decoded;
  await pool.query(
    `INSERT INTO suppressions (email_hash, dealer_id, source, ip) VALUES ($1,$2,'list_header',$3) ON CONFLICT DO NOTHING`,
    [emailHash, dealerId, req.ip]
  );
  notifyPlatform({ emailHash, dealerId, sendId }).catch(() => {});
  res.sendStatus(200);
});

// Check single email
app.post('/api/check', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== PLATFORM_WEBHOOK_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  const { email, dealerId } = req.body;
  if (!email || !dealerId) return res.status(400).json({ error: 'email and dealerId required' });
  const { rows: [row] } = await pool.query(
    'SELECT id FROM suppressions WHERE email_hash=$1 AND dealer_id=$2',
    [hashEmail(email), dealerId]
  );
  res.json({ suppressed: !!row });
});

// Batch check
app.post('/api/check-batch', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== PLATFORM_WEBHOOK_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  const { emails, dealerId } = req.body;
  if (!Array.isArray(emails) || !dealerId)
    return res.status(400).json({ error: 'emails array and dealerId required' });
  const hashes = emails.map(e => typeof e === 'string' && e.includes('@') ? hashEmail(e) : e);
  const { rows } = await pool.query(
    `SELECT email_hash FROM suppressions WHERE email_hash=ANY($1::text[]) AND dealer_id=$2`,
    [hashes, dealerId]
  );
  res.json({ suppressed: rows.map(r => r.email_hash) });
});

async function notifyPlatform({ emailHash, dealerId, sendId }) {
  if (!PLATFORM_WEBHOOK_URL) return;
  await fetch(PLATFORM_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': PLATFORM_WEBHOOK_SECRET },
    body: JSON.stringify({ event: 'unsubscribed', email_hash: emailHash, dealer_id: dealerId, send_id: sendId, ts: new Date().toISOString() }),
  });
}

function page(title, body, success) {
  const color = success ? '#1a7f4b' : '#a32d2d';
  const bg    = success ? '#eaf3de' : '#fcebeb';
  const icon  = success ? '&#10003;' : '&#33;';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#f5f5f3;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#fff;border:0.5px solid rgba(0,0,0,.12);border-radius:14px;padding:36px 32px;max-width:440px;width:100%;text-align:center}.icon{width:48px;height:48px;border-radius:50%;background:${bg};color:${color};font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-weight:500}h1{font-size:18px;font-weight:500;color:${color};margin-bottom:10px}p{font-size:14px;color:#666;line-height:1.6;margin-bottom:18px}.note{font-size:12px;color:#999;line-height:1.5}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${body}</p>
<div class="note">If this was a mistake, reply directly to any previous email from this sender to request reactivation.</div></div></body></html>`;
}

app.listen(process.env.PORT || 4000, () =>
  console.log(`Opt-out service running on :${process.env.PORT || 4000}`)
);
