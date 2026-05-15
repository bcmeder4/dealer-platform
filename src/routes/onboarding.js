// ============================================================
// src/routes/onboarding.js
// Client onboarding API
//
// POST /api/onboarding/clients          — create new client
// GET  /api/onboarding/clients          — list all clients
// GET  /api/onboarding/clients/:id      — get client details
// PUT  /api/onboarding/clients/:id      — update client
// POST /api/onboarding/clients/:id/activate   — activate client
// POST /api/onboarding/clients/:id/invite     — send self-serve invite
// POST /api/onboarding/clients/:id/domains    — add sending domain
// DELETE /api/onboarding/clients/:id/domains/:domain — remove domain
// POST /api/onboarding/invite/accept    — accept self-serve invite
// ============================================================

import express  from 'express';
import crypto   from 'crypto';
import pool     from '../db/pool.js';
import { encrypt } from '../credit/encryption.js';

const router = express.Router();

// ── Create new client ────────────────────────────────────
router.post('/clients', async (req, res) => {
  const {
    mode, vertical, name, slug, brand, website,
    contactName, contactEmail, contactPhone,
    address, city, state, zip,
    fromName, fromEmail, replyTo, leadsEmail,
    domains, features,
    creditProvider, creditApiKey, creditDealerId,
    sendgridKey,
  } = req.body;

  if (!name || !contactEmail) {
    return res.status(400).json({ error: 'name and contactEmail required' });
  }

  // Generate unique slug if not provided
  const clientSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Check slug uniqueness
  const { rows: existing } = await pool.query(
    'SELECT id FROM dealers WHERE slug=$1', [clientSlug]
  );
  if (existing.length) {
    return res.status(409).json({ error: `Slug "${clientSlug}" already taken` });
  }

  // Generate platform API key for this client
  const platformApiKey = `cdp_${crypto.randomBytes(24).toString('hex')}`;
  const hashedKey      = crypto.createHash('sha256').update(platformApiKey).digest('hex');

  // Encrypt sensitive credentials
  const encryptedSendgrid = sendgridKey ? encrypt(sendgridKey) : null;
  const encryptedCreditKey = creditApiKey ? encrypt(creditApiKey) : null;

  const client = await pool.query(`
    INSERT INTO dealers (
      name, slug, brand, website,
      contact_name, from_email, contact_phone,
      address, city, state, zip,
      from_name, from_email, reply_to, leads_email,
      vertical, onboarding_mode, status,
      credit_provider, credit_api_key, credit_dealer_id,
      sendgrid_api_key,
      features,
      platform_api_key_hash,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,'pending',
      $18,$19,$20,$21,$22,$23,NOW(),NOW()
    ) RETURNING id, name, slug, vertical, status
  `, [
    name, clientSlug, brand||null, website||null,
    contactName||null, contactEmail, contactPhone||null,
    address||null, city||null, state||null, zip||null,
    fromName||name, fromEmail||null, replyTo||null, leadsEmail||null,
    vertical||'generic', mode||'manual',
    creditProvider||'700credit', encryptedCreditKey, creditDealerId||null,
    encryptedSendgrid,
    JSON.stringify(features||{}),
    hashedKey,
  ]);

  const clientId = client.rows[0].id;

  // Add sending domains
  if (domains?.length) {
    for (const domain of domains) {
      await pool.query(`
        INSERT INTO sending_domains
          (dealer_id, domain, from_email, status, health_score, daily_limit, warmup_started)
        VALUES ($1,$2,$3,'pending',100,5,NOW())
        ON CONFLICT (domain) DO NOTHING
      `, [clientId, domain, fromEmail || `sales@${domain}`]).catch(() => {});
    }
  }

  // Log onboarding
  await pool.query(`
    INSERT INTO onboarding_log (client_id, mode, created_at)
    VALUES ($1,$2,NOW())
  `, [clientId, mode||'manual']).catch(() => {});

  res.status(201).json({
    ok:           true,
    client:       client.rows[0],
    platformApiKey, // shown once — client must store this
    message:      `Client "${name}" created successfully`,
  });
});

// ── List all clients ──────────────────────────────────────
router.get('/clients', async (req, res) => {
  const { vertical, status, search } = req.query;
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (vertical) { conditions.push(`vertical=$${p++}`); params.push(vertical); }
  if (status)   { conditions.push(`status=$${p++}`);   params.push(status); }
  if (search)   {
    conditions.push(`(name ILIKE $${p} OR contact_email ILIKE $${p} OR slug ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }

  const { rows } = await pool.query(`
    SELECT
      d.id, d.name, d.slug, d.vertical, d.status,
      d.contact_email, d.from_email, d.city, d.state,
      d.onboarding_mode, d.features, d.created_at,
      COUNT(DISTINCT sd.id) AS domain_count,
      COUNT(DISTINCT s.id)  AS total_sends
    FROM dealers d
    LEFT JOIN sending_domains sd ON sd.dealer_id = d.id
    LEFT JOIN campaigns c ON c.dealer_id = d.id
    LEFT JOIN sends s ON s.campaign_id = c.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `, params);

  res.json({ clients: rows });
});

// ── Get client details ────────────────────────────────────
router.get('/clients/:id', async (req, res) => {
  const { rows: [client] } = await pool.query(`
    SELECT d.*,
      (SELECT json_agg(sd.*) FROM sending_domains sd WHERE sd.dealer_id=d.id) AS domains
    FROM dealers d WHERE d.id=$1
  `, [req.params.id]);

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Never return encrypted credentials
  delete client.credit_api_key;
  delete client.sendgrid_api_key;
  delete client.platform_api_key_hash;

  res.json(client);
});

// ── Update client ─────────────────────────────────────────
router.put('/clients/:id', async (req, res) => {
  const allowed = [
    'name','brand','website','contact_name','contact_email',
    'contact_phone','address','city','state','zip',
    'from_name','from_email','reply_to','leads_email','features',
    'credit_provider','credit_dealer_id',
  ];

  const updates = [];
  const values  = [];
  let p = 1;

  for (const [key, val] of Object.entries(req.body)) {
    if (allowed.includes(key)) {
      updates.push(`${key}=$${p++}`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push(`updated_at=NOW()`);
  values.push(req.params.id);

  await pool.query(
    `UPDATE dealers SET ${updates.join(',')} WHERE id=$${p}`,
    values
  );

  res.json({ ok: true });
});

// ── Activate client ───────────────────────────────────────
router.post('/clients/:id/activate', async (req, res) => {
  await pool.query(
    `UPDATE dealers SET status='active', activated_at=NOW() WHERE id=$1`,
    [req.params.id]
  );

  // Set warmup schedule for pending domains
  await pool.query(`
    UPDATE sending_domains SET status='active', warmup_started=NOW()
    WHERE dealer_id=$1 AND status='pending'
  `, [req.params.id]).catch(() => {});

  res.json({ ok: true, message: 'Client activated' });
});

// ── Send self-serve invite ────────────────────────────────
router.post('/clients/:id/invite', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  // Generate signed invite token (expires 72h)
  const payload = Buffer.from(JSON.stringify({
    clientId: req.params.id,
    email,
    exp: Date.now() + 72 * 60 * 60 * 1000,
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', process.env.PLATFORM_WEBHOOK_SECRET || 'secret')
    .update(payload)
    .digest('hex')
    .slice(0, 16);

  const inviteUrl = `https://app.cars-dealer.com/onboard?t=${payload}.${sig}`;

  // Send invite email via Postal
  await fetch(`${process.env.POSTAL_URL}/api/v1/send/message`, {
    method: 'POST',
    headers: {
      'X-Server-API-Key': process.env.POSTAL_API_KEY,
      'Content-Type':     'application/json',
    },
    body: JSON.stringify({
      to:         [email],
      from:       'onboarding@cars-dealer.com',
      subject:    'Complete your platform onboarding',
      plain_body: `You've been invited to complete your onboarding.\n\nClick here to get started:\n${inviteUrl}\n\nThis link expires in 72 hours.`,
    }),
  }).catch(err => console.error('Invite email error:', err.message));

  res.json({ ok: true, inviteUrl });
});

// ── Accept self-serve invite ──────────────────────────────
router.post('/invite/accept', async (req, res) => {
  const { token, ...clientData } = req.body;

  try {
    const [payload, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.PLATFORM_WEBHOOK_SECRET || 'secret')
      .update(payload)
      .digest('hex')
      .slice(0, 16);

    if (sig !== expected) throw new Error('Invalid token');

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > data.exp) throw new Error('Invite expired');

    // Update client with self-serve data
    await pool.query(
      `UPDATE dealers SET status='pending_approval', updated_at=NOW() WHERE id=$1`,
      [data.clientId]
    );

    res.json({ ok: true, clientId: data.clientId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Add sending domain ────────────────────────────────────
router.post('/clients/:id/domains', async (req, res) => {
  const { domain, fromEmail } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  await pool.query(`
    INSERT INTO sending_domains
      (dealer_id, domain, from_email, status, health_score, daily_limit, warmup_started)
    VALUES ($1,$2,$3,'active',100,5,NOW())
    ON CONFLICT (domain) DO UPDATE SET dealer_id=$1
  `, [req.params.id, domain, fromEmail || `sales@${domain}`]);

  res.json({ ok: true });
});

// ── Remove sending domain ─────────────────────────────────
router.delete('/clients/:id/domains/:domain', async (req, res) => {
  await pool.query(
    `UPDATE sending_domains SET status='inactive' WHERE dealer_id=$1 AND domain=$2`,
    [req.params.id, req.params.domain]
  );
  res.json({ ok: true });
});

export default router;

// ============================================================
// DB migrations — run in Coolify terminal:
// ============================================================
/*
node -e "
import('./src/db/pool.js').then(async m => {
  const pool = m.default;
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT \'generic\'');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS onboarding_mode TEXT DEFAULT \'manual\'');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'active\'');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS contact_name TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS contact_phone TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS website TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS address TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS features JSONB DEFAULT \'{}\'');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS platform_api_key_hash TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ');
  await pool.query(\`CREATE TABLE IF NOT EXISTS onboarding_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES dealers(id),
    mode TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )\`);
  console.log('done');
  await pool.end();
});
"

// Add to src/server.js:
// import onboardingRouter from './routes/onboarding.js';
// app.use('/api/onboarding', onboardingRouter);
*/
