// ============================================================
// src/routes/credit.js
// Credit provider management API routes
//
// GET  /api/credit/providers          — list available providers
// POST /api/credit/providers/test     — test provider connection
// POST /api/credit/dealers/:id/config — save provider config
// GET  /api/credit/dealers/:id/config — get provider config
// POST /api/credit/prequal            — submit pre-qual form
// GET  /api/credit/prequal/:id        — get result (customer-facing)
// GET  /api/credit/report/:id         — get full report (dealer only)
// ============================================================

import express              from 'express';
import pool                 from '../db/pool.js';
import { pullCredit, testProviderConnection, getAvailableProviders, saveProviderConfig } from '../credit/router.js';
import { submitPrequal, getDealerReport, generatePrequalUrl, verifyPrequalToken } from '../credit/prequal.js';

const router = express.Router();

// ── List available credit providers ──────────────────────
router.get('/providers', (req, res) => {
  res.json({ providers: getAvailableProviders() });
});

// ── Test a provider connection ────────────────────────────
router.post('/providers/test', async (req, res) => {
  const { dealerId, provider, apiKey, dealerAccountId, config } = req.body;

  try {
    const result = await testProviderConnection({
      dealer: {
        id:               dealerId,
        credit_provider:  provider,
        credit_api_key:   apiKey,
        credit_dealer_id: dealerAccountId,
        credit_config:    config || {},
      },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Save provider config for a dealer ─────────────────────
router.post('/dealers/:id/config', async (req, res) => {
  const { provider, apiKey, dealerAccountId, config } = req.body;

  try {
    await saveProviderConfig({
      dealerId:        req.params.id,
      provider,
      apiKey,
      dealerAccountId,
      config,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Get provider config for a dealer ─────────────────────
// Returns config WITHOUT the decrypted API key
router.get('/dealers/:id/config', async (req, res) => {
  const { rows: [dealer] } = await pool.query(
    `SELECT credit_provider, credit_dealer_id, credit_config,
            CASE WHEN credit_api_key IS NOT NULL THEN TRUE ELSE FALSE END as has_api_key
     FROM dealers WHERE id=$1`,
    [req.params.id]
  );

  if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
  res.json(dealer);
});

// ── Submit pre-qual form (customer-facing) ────────────────
router.post('/prequal', async (req, res) => {
  const { token, formData } = req.body;

  try {
    // Verify signed token from email link
    const { contactId, vehicleId, dealerId, sendId } = verifyPrequalToken(token);

    const result = await submitPrequal({
      formData,
      contactId,
      vehicleId,
      dealerId,
      sendId,
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Get pre-qual result page ──────────────────────────────
// Customer-facing — shows tier message, no raw score
router.get('/prequal/result/:id', async (req, res) => {
  const { rows: [prequal] } = await pool.query(
    `SELECT cp.tier, cp.completed_at,
            c.first_name, v.year, v.make, v.model, v.price, v.vdp_url,
            d.name as dealer_name, d.phone as dealer_phone
     FROM credit_prequals cp
     JOIN contacts c  ON c.id  = cp.contact_id
     LEFT JOIN vehicles v ON v.id = cp.vehicle_id
     JOIN dealers d   ON d.id  = cp.dealer_id
     WHERE cp.id = $1`,
    [req.params.id]
  );

  if (!prequal) return res.status(404).json({ error: 'Not found' });

  // Return only non-sensitive result data
  res.json({
    tier:       prequal.tier,
    firstName:  prequal.first_name,
    vehicle:    prequal.year ? {
      year:  prequal.year,
      make:  prequal.make,
      model: prequal.model,
      price: prequal.price,
      vdpUrl: prequal.vdp_url,
    } : null,
    dealer: {
      name:  prequal.dealer_name,
      phone: prequal.dealer_phone,
    },
  });
});

// ── Get full report (dealer back office only) ─────────────
router.get('/report/:id', async (req, res) => {
  const dealerId   = req.query.dealer_id;
  const accessedBy = req.query.user || 'unknown';

  if (!dealerId) return res.status(400).json({ error: 'dealer_id required' });

  try {
    const report = await getDealerReport({
      prequalId:  req.params.id,
      dealerId,
      accessedBy,
    });
    res.json(report);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// ── Serve pre-qual HTML form ──────────────────────────────
router.get('/form', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid link');

  try {
    verifyPrequalToken(token); // validate before serving form
  } catch {
    return res.status(400).send('This link has expired or is invalid.');
  }

  res.sendFile('prequal.html', {
    root: new URL('../credit', import.meta.url).pathname,
  });
});

// ── Generate pre-qual URL (internal/campaign use) ────────
router.post('/generate-link', async (req, res) => {
  const { contactId, vehicleId, dealerId, sendId } = req.body;
  const url = generatePrequalUrl({ contactId, vehicleId, dealerId, sendId });
  res.json({ url });
});

export default router;

// ============================================================
// Add to src/server.js:
// import creditRouter from './routes/credit.js';
// app.use('/api/credit', creditRouter);
// ============================================================

// ============================================================
// DB migration — run in Coolify terminal:
// ============================================================
/*
node -e "
import('./src/db/pool.js').then(async m => {
  const pool = m.default;
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS credit_provider TEXT DEFAULT \'700credit\'');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS credit_config JSONB DEFAULT \'{}\'');
  console.log('credit columns added');
  await pool.end();
});
"
*/
