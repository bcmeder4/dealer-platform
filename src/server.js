import express from 'express';
import pool from './db/pool.js';
import { runFtpImport } from './ftp/importer.js';
import { campaignQueue, registerFtpCrons } from './campaigns/scheduler.js';
import domainsRouter from './domains/router.js';
import adsRouter from './ads/router.js';
import contactsUpload from './routes/contacts-upload.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check (used by Docker + Coolify) ──────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
});

// ── Open tracking pixel ──────────────────────────────────
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
app.get('/t/open/:sendId.png', async (req, res) => {
  await pool.query(
    `UPDATE sends SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1 WHERE id = $1`,
    [req.params.sendId]
  ).catch(() => {});
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  res.send(PIXEL);
});

// ── Click redirect ───────────────────────────────────────
app.get('/t/click', async (req, res) => {
  const { sid, vid, url } = req.query;
  if (!url) return res.redirect('/');
  if (sid) {
    pool.query(
      `UPDATE sends SET clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1 WHERE id = $1`,
      [sid]
    ).catch(() => {});
    pool.query(
      `INSERT INTO click_events (send_id, vehicle_id, vdp_url, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
      [sid, vid || null, url, req.ip, req.get('user-agent')]
    ).catch(() => {});
  }
  res.redirect(302, url);
});

// ── Unsubscribe ──────────────────────────────────────────
app.get('/unsubscribe', async (req, res) => {
  const { cid } = req.query;
  if (cid) {
    await pool.query(
      `UPDATE contacts SET unsubscribed = TRUE, unsubscribed_at = NOW() WHERE id = $1`,
      [cid]
    ).catch(() => {});
  }
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>You have been unsubscribed</h2>
    <p>You will not receive further emails from this sender.</p>
  </body></html>`);
});

// ── Postal delivery webhook ──────────────────────────────
app.post('/webhooks/postal', async (req, res) => {
  const { event, payload } = req.body;
  const msgId = payload?.id?.toString();
  if (!msgId) return res.sendStatus(200);
  const { rows: [send] } = await pool.query(
    `SELECT * FROM sends WHERE postal_msg_id = $1`, [msgId]
  );
  if (!send) return res.sendStatus(200);
  if (event === 'MessageDelivered') {
    await pool.query(`UPDATE sends SET status='delivered', delivered_at=NOW() WHERE id=$1`, [send.id]);
  } else if (event === 'MessageBounced') {
    await pool.query(`UPDATE sends SET status='bounced' WHERE id=$1`, [send.id]);
    await pool.query(`UPDATE contacts SET bounced=TRUE WHERE id=$1`, [send.contact_id]);
  } else if (event === 'MessageSpamComplaint') {
    await pool.query(`UPDATE sends SET status='complained' WHERE id=$1`, [send.id]);
    await pool.query(`UPDATE contacts SET unsubscribed=TRUE, unsubscribed_at=NOW() WHERE id=$1`, [send.contact_id]);
  }
  res.sendStatus(200);
});

// ── Suppression webhook ──────────────────────────────────
app.post('/webhooks/unsubscribed', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== process.env.PLATFORM_WEBHOOK_SECRET)
    return res.sendStatus(401);
  const { email_hash, dealer_id, send_id } = req.body;
  await pool.query(
    `UPDATE contacts SET unsubscribed=TRUE, unsubscribed_at=NOW()
     WHERE dealer_id=$1 AND encode(sha256(lower(trim(email))::bytea),'hex')=$2`,
    [dealer_id, email_hash]
  ).catch(() => {});
  if (send_id) {
    await pool.query(`UPDATE sends SET status='unsubscribed' WHERE id=$1`, [send_id]).catch(() => {});
  }
  res.sendStatus(200);
});

// ── API routes ───────────────────────────────────────────
app.post('/api/ftp/trigger', async (req, res) => {
  const { dealer_id } = req.body;
  try {
    const result = await runFtpImport(dealer_id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  const { dealer_id, status, make } = req.query;
  const { rows } = await pool.query(
    `SELECT * FROM vehicles WHERE dealer_id=$1 ${status ? 'AND status=$2' : ''} ORDER BY year DESC, make, model`,
    status ? [dealer_id, status] : [dealer_id]
  );
  res.json(rows);
});

app.post('/api/campaigns/:id/launch', async (req, res) => {
  await pool.query(`UPDATE campaigns SET status='scheduled' WHERE id=$1`, [req.params.id]);
  await campaignQueue.add('send-campaign', { campaignId: req.params.id });
  res.json({ ok: true });
});

app.get('/api/campaigns/:id/stats', async (req, res) => {
  const { rows: [stats] } = await pool.query(`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status='delivered') AS delivered,
      COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
      COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
      ROUND(COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::numeric /
        NULLIF(COUNT(*) FILTER (WHERE status='delivered'),0)*100,1) AS open_rate_pct
    FROM sends WHERE campaign_id=$1
  `, [req.params.id]);
  res.json(stats);
});

app.use('/api/domains',  domainsRouter);
app.use('/api/ads',      adsRouter);
app.use('/api/contacts', contactsUpload);

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Dealer platform running on :${PORT}`);
  await registerFtpCrons().catch(err => console.error('FTP cron error:', err));
});
