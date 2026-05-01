import express from 'express';
import pool from '../db/pool.js';

const router = express.Router();

// GET /api/ads/queue?dealer_id=...
router.get('/queue', async (req, res) => {
  const { dealer_id } = req.query;
  const { rows } = await pool.query(`
    SELECT ac.*, d.name AS dealer_name,
      v.year, v.make, v.model, v.vin, v.price, v.vdp_url
    FROM ad_campaigns ac
    JOIN dealers d ON d.id = ac.dealer_id
    LEFT JOIN vehicles v ON v.id = ac.vehicle_id
    WHERE ac.dealer_id = $1 AND ac.status = 'pending_review'
    ORDER BY ac.created_at DESC
  `, [dealer_id]);
  res.json(rows);
});

// GET /api/ads/campaigns?dealer_id=...
router.get('/campaigns', async (req, res) => {
  const { dealer_id } = req.query;
  const { rows } = await pool.query(
    `SELECT * FROM ad_campaigns WHERE dealer_id=$1 ORDER BY created_at DESC`,
    [dealer_id]
  );
  res.json(rows);
});

// POST /api/ads/campaigns - create campaign (goes to review queue)
router.post('/campaigns', async (req, res) => {
  const {
    dealer_id, platform, name, vehicle_id,
    monthly_budget_cents, model_groups,
  } = req.body;

  if (!dealer_id || !platform || !name) {
    return res.status(400).json({ error: 'dealer_id, platform and name required' });
  }

  // Check budget cap
  const withinBudget = await checkBudgetCap(dealer_id, platform, monthly_budget_cents || 0);
  if (!withinBudget.ok) return res.status(400).json({ error: withinBudget.message });

  const { rows: [campaign] } = await pool.query(`
    INSERT INTO ad_campaigns
      (dealer_id, platform, name, vehicle_id, monthly_budget_cents, model_groups, status)
    VALUES ($1,$2,$3,$4,$5,$6,'pending_review')
    RETURNING *
  `, [dealer_id, platform, name, vehicle_id || null,
      monthly_budget_cents || 0, model_groups ? JSON.stringify(model_groups) : null]);

  res.json({ ok: true, campaign, status: 'pending_review' });
});

// POST /api/ads/campaigns/:id/approve
router.post('/campaigns/:id/approve', async (req, res) => {
  const { rows: [campaign] } = await pool.query(
    'SELECT * FROM ad_campaigns WHERE id=$1', [req.params.id]
  );
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.status !== 'pending_review') {
    return res.status(400).json({ error: `Campaign is ${campaign.status}` });
  }

  // In production: call platform-specific enable function here
  // await enableGoogle(id) / enableMetaCampaign(id) / enableTikTokCampaign(id)

  await pool.query(
    `UPDATE ad_campaigns SET status='active', enabled_at=NOW() WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true, status: 'active' });
});

// POST /api/ads/campaigns/:id/reject
router.post('/campaigns/:id/reject', async (req, res) => {
  const { reason } = req.body;
  await pool.query(
    `UPDATE ad_campaigns SET status='rejected', rejected_at=NOW(), reject_reason=$1 WHERE id=$2`,
    [reason || '', req.params.id]
  );
  res.json({ ok: true, status: 'rejected' });
});

// POST /api/ads/campaigns/:id/pause
router.post('/campaigns/:id/pause', async (req, res) => {
  await pool.query(`UPDATE ad_campaigns SET status='paused' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true, status: 'paused' });
});

// GET /api/ads/budgets?dealer_id=...
router.get('/budgets', async (req, res) => {
  const { dealer_id } = req.query;
  const { rows } = await pool.query(`
    SELECT platform,
      SUM(monthly_budget_cents) AS allocated_cents,
      COUNT(*) FILTER (WHERE status='active') AS active_campaigns
    FROM ad_campaigns
    WHERE dealer_id=$1 AND created_at >= date_trunc('month', NOW())
    GROUP BY platform
  `, [dealer_id]);
  const { rows: caps } = await pool.query(
    'SELECT * FROM dealer_budgets WHERE dealer_id=$1', [dealer_id]
  );
  const capMap = Object.fromEntries(caps.map(c => [c.platform, c.monthly_cap_cents]));
  res.json(rows.map(r => ({
    ...r,
    cap_cents: capMap[r.platform] || null,
    cap_dollars: capMap[r.platform] ? Math.round(capMap[r.platform] / 100) : null,
    allocated_dollars: Math.round(Number(r.allocated_cents) / 100),
  })));
});

// POST /api/ads/budgets
router.post('/budgets', async (req, res) => {
  const { dealer_id, platform, monthly_cap_dollars } = req.body;
  await pool.query(`
    INSERT INTO dealer_budgets (dealer_id, platform, monthly_cap_cents, updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT (dealer_id, platform) DO UPDATE SET monthly_cap_cents=$3, updated_at=NOW()
  `, [dealer_id, platform, monthly_cap_dollars * 100]);
  res.json({ ok: true });
});

async function checkBudgetCap(dealerId, platform, requestedCents) {
  const { rows: [cap] } = await pool.query(
    'SELECT monthly_cap_cents FROM dealer_budgets WHERE dealer_id=$1 AND platform=$2',
    [dealerId, platform]
  );
  if (!cap) return { ok: true };
  const { rows: [spent] } = await pool.query(`
    SELECT COALESCE(SUM(monthly_budget_cents),0) AS total FROM ad_campaigns
    WHERE dealer_id=$1 AND platform=$2 AND status IN ('active','pending_review')
      AND created_at >= date_trunc('month',NOW())
  `, [dealerId, platform]);
  const remaining = cap.monthly_cap_cents - Number(spent.total);
  if (requestedCents > remaining) {
    return {
      ok: false,
      message: `Budget cap exceeded. Remaining: $${Math.round(remaining/100)}. Requested: $${Math.round(requestedCents/100)}.`,
    };
  }
  return { ok: true };
}

export default router;
