// ============================================================
// src/routes/analytics.js
// Analytics dashboard API
//
// GET /api/analytics/dashboard  — main dashboard data
// GET /api/analytics/campaigns  — campaign list with stats
// GET /api/analytics/domains    — domain health scores
// GET /api/analytics/funnel     — email funnel breakdown
// GET /api/analytics/leads      — recent leads
// GET /api/analytics/daily      — daily sends/opens chart data
// ============================================================

import express from 'express';
import pool    from '../db/pool.js';

const router = express.Router();

// ── Main dashboard endpoint ───────────────────────────────
// GET /api/analytics/dashboard?dealer_id=xxx&days=30
router.get('/dashboard', async (req, res) => {
  try {
    const { dealer_id, days = 30 } = req.query;
    const since = `NOW() - INTERVAL '${parseInt(days)} days'`;

    const [metrics, daily, funnel, campaigns, domains, leads, providers] = await Promise.all([
      getMetrics(dealer_id, since),
      getDailyChart(dealer_id, since, parseInt(days)),
      getFunnel(dealer_id, since),
      getCampaigns(dealer_id),
      getDomains(dealer_id),
      getRecentLeads(dealer_id),
      getProviderSplit(dealer_id, since),
    ]);

    res.json({ metrics, daily, funnel, campaigns, domains, leads, providers });
  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Metrics summary ───────────────────────────────────────
async function getMetrics(dealerId, since) {
  const where = dealerId
    ? `AND c.dealer_id = '${dealerId}'`
    : '';

  const { rows: [m] } = await pool.query(`
    SELECT
      COUNT(s.id)                                          AS sent,
      COUNT(s.id) FILTER (WHERE s.opened_at IS NOT NULL)  AS opened,
      COUNT(s.id) FILTER (WHERE s.clicked_at IS NOT NULL) AS clicked,
      COUNT(s.id) FILTER (WHERE s.status = 'bounced')     AS bounced,
      COUNT(s.id) FILTER (WHERE s.status = 'unsubscribed') AS unsubscribed,
      COUNT(DISTINCT ir.id)                                AS replies,
      COUNT(DISTINCT lf.id)                                AS leads
    FROM sends s
    JOIN campaigns c ON c.id = s.campaign_id
    LEFT JOIN inbound_replies ir ON ir.send_id = s.id
    LEFT JOIN lead_forwards lf ON lf.contact_id = s.contact_id
      AND lf.created_at >= ${since}
    WHERE s.sent_at >= ${since}
    ${where}
  `);

  const sent    = parseInt(m.sent)    || 0;
  const opened  = parseInt(m.opened)  || 0;
  const clicked = parseInt(m.clicked) || 0;
  const bounced = parseInt(m.bounced) || 0;

  return {
    sent,
    opened,
    clicked,
    bounced,
    unsubscribed: parseInt(m.unsubscribed) || 0,
    replies:      parseInt(m.replies)      || 0,
    leads:        parseInt(m.leads)        || 0,
    openRate:     sent > 0 ? +((opened  / sent) * 100).toFixed(1) : 0,
    clickRate:    sent > 0 ? +((clicked / sent) * 100).toFixed(1) : 0,
    bounceRate:   sent > 0 ? +((bounced / sent) * 100).toFixed(1) : 0,
  };
}

// ── Daily chart data ──────────────────────────────────────
async function getDailyChart(dealerId, since, days) {
  const where = dealerId ? `AND c.dealer_id = $1` : '';
  const params = dealerId ? [dealerId] : [];

  const { rows } = await pool.query(`
    SELECT
      DATE(s.sent_at)                                          AS day,
      COUNT(s.id)                                              AS sent,
      COUNT(s.id) FILTER (WHERE s.opened_at IS NOT NULL)       AS opened,
      COUNT(s.id) FILTER (WHERE s.clicked_at IS NOT NULL)      AS clicked
    FROM sends s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.sent_at >= ${since}
    ${where}
    GROUP BY DATE(s.sent_at)
    ORDER BY day ASC
  `, params);

  // Fill gaps with zeros for days with no sends
  const filled = fillDateGaps(rows, days);

  return {
    labels:  filled.map(r => formatDate(r.day)),
    sent:    filled.map(r => parseInt(r.sent)   || 0),
    opened:  filled.map(r => parseInt(r.opened) || 0),
    clicked: filled.map(r => parseInt(r.clicked)|| 0),
  };
}

// ── Email funnel ──────────────────────────────────────────
async function getFunnel(dealerId, since) {
  const where = dealerId ? `AND c.dealer_id = '${dealerId}'` : '';

  const { rows: [f] } = await pool.query(`
    SELECT
      COUNT(s.id)                                              AS sent,
      COUNT(s.id) FILTER (WHERE s.status != 'bounced')        AS delivered,
      COUNT(s.id) FILTER (WHERE s.opened_at IS NOT NULL)      AS opened,
      COUNT(s.id) FILTER (WHERE s.clicked_at IS NOT NULL)     AS clicked,
      COUNT(DISTINCT ir.id)                                    AS replied,
      COUNT(DISTINCT lf.id)                                    AS leads
    FROM sends s
    JOIN campaigns c ON c.id = s.campaign_id
    LEFT JOIN inbound_replies ir ON ir.send_id = s.id
    LEFT JOIN lead_forwards lf ON lf.contact_id = s.contact_id
      AND lf.created_at >= ${since}
    WHERE s.sent_at >= ${since}
    ${where}
  `);

  const sent = parseInt(f.sent) || 1; // avoid divide by zero
  return [
    { label: 'Sent',      n: parseInt(f.sent)      || 0, pct: 100 },
    { label: 'Delivered', n: parseInt(f.delivered) || 0, pct: +((parseInt(f.delivered)||0) / sent * 100).toFixed(1) },
    { label: 'Opened',    n: parseInt(f.opened)    || 0, pct: +((parseInt(f.opened)   ||0) / sent * 100).toFixed(1) },
    { label: 'Clicked',   n: parseInt(f.clicked)   || 0, pct: +((parseInt(f.clicked)  ||0) / sent * 100).toFixed(1) },
    { label: 'Replied',   n: parseInt(f.replied)   || 0, pct: +((parseInt(f.replied)  ||0) / sent * 100).toFixed(1) },
    { label: 'Leads',     n: parseInt(f.leads)     || 0, pct: +((parseInt(f.leads)    ||0) / sent * 100).toFixed(1) },
  ];
}

// ── Campaigns list ────────────────────────────────────────
async function getCampaigns(dealerId) {
  const where = dealerId ? `WHERE c.dealer_id = $1` : '';
  const params = dealerId ? [dealerId] : [];

  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.name,
      c.status,
      d.name                                                    AS dealer_name,
      COUNT(s.id)                                               AS sent,
      COUNT(s.id) FILTER (WHERE s.opened_at IS NOT NULL)        AS opened,
      COUNT(s.id) FILTER (WHERE s.clicked_at IS NOT NULL)       AS clicked,
      COUNT(DISTINCT lf.id)                                      AS leads,
      c.created_at
    FROM campaigns c
    JOIN dealers d ON d.id = c.dealer_id
    LEFT JOIN sends s ON s.campaign_id = c.id
    LEFT JOIN lead_forwards lf ON lf.contact_id = s.contact_id
    ${where}
    GROUP BY c.id, d.name
    ORDER BY c.created_at DESC
    LIMIT 10
  `, params);

  return rows.map(r => {
    const sent   = parseInt(r.sent)   || 0;
    const opened = parseInt(r.opened) || 0;
    const clicked= parseInt(r.clicked)|| 0;
    return {
      id:         r.id,
      name:       r.name,
      dealer:     r.dealer_name,
      status:     r.status,
      sent,
      opened,
      clicked,
      leads:      parseInt(r.leads) || 0,
      openRate:   sent > 0 ? +((opened  / sent) * 100).toFixed(1) : 0,
      clickRate:  sent > 0 ? +((clicked / sent) * 100).toFixed(1) : 0,
    };
  });
}

// ── Domain health scores ──────────────────────────────────
async function getDomains(dealerId) {
  const where = dealerId ? `WHERE dealer_id = $1` : '';
  const params = dealerId ? [dealerId] : [];

  const { rows } = await pool.query(`
    SELECT
      domain,
      health_score,
      daily_limit,
      sends_today,
      status,
      (SELECT COUNT(*) FROM sends s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE c.dealer_id = sd.dealer_id
         AND s.sent_at >= NOW() - INTERVAL '30 days') AS sends_30d
    FROM sending_domains sd
    ${where}
    ORDER BY health_score DESC
    LIMIT 10
  `, params);

  return rows.map(r => ({
    domain:      r.domain,
    health:      parseInt(r.health_score) || 0,
    dailyLimit:  parseInt(r.daily_limit)  || 100,
    sendsToday:  parseInt(r.sends_today)  || 0,
    sends30d:    parseInt(r.sends_30d)    || 0,
    status:      r.status,
  }));
}

// ── Recent leads ──────────────────────────────────────────
async function getRecentLeads(dealerId) {
  const where = dealerId ? `AND d.id = $1` : '';
  const params = dealerId ? [dealerId] : [];

  const { rows } = await pool.query(`
    SELECT
      lf.id,
      lf.classification,
      lf.created_at,
      con.first_name,
      con.last_name,
      con.email,
      v.year, v.make, v.model,
      d.name AS dealer_name
    FROM lead_forwards lf
    JOIN contacts con ON con.id = lf.contact_id
    LEFT JOIN vehicles v ON v.id = lf.vehicle_id
    JOIN dealers d ON d.id = lf.dealer_id
    WHERE lf.created_at >= NOW() - INTERVAL '7 days'
    ${where}
    ORDER BY lf.created_at DESC
    LIMIT 10
  `, params);

  return rows.map(r => ({
    id:           r.id,
    firstName:    r.first_name,
    lastName:     r.last_name,
    email:        r.email,
    intent:       r.classification,
    vehicle:      r.year ? `${r.year} ${r.make} ${r.model}` : null,
    dealer:       r.dealer_name,
    time:         timeAgo(r.created_at),
  }));
}

// ── Provider split ────────────────────────────────────────
async function getProviderSplit(dealerId, since) {
  const where = dealerId ? `AND c.dealer_id = '${dealerId}'` : '';

  const { rows } = await pool.query(`
    SELECT
      COALESCE(s.provider, 'postal') AS provider,
      COUNT(*) AS count
    FROM sends s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.sent_at >= ${since}
    ${where}
    GROUP BY provider
  `);

  const total = rows.reduce((sum, r) => sum + parseInt(r.count), 0) || 1;
  return rows.map(r => ({
    provider: r.provider,
    count:    parseInt(r.count),
    pct:      +((parseInt(r.count) / total) * 100).toFixed(1),
  }));
}

// ── Individual endpoints ──────────────────────────────────
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await getCampaigns(req.query.dealer_id);
    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/domains', async (req, res) => {
  try {
    const domains = await getDomains(req.query.dealer_id);
    res.json({ domains });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const leads = await getRecentLeads(req.query.dealer_id);
    res.json({ leads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily', async (req, res) => {
  try {
    const { dealer_id, days = 30 } = req.query;
    const since = `NOW() - INTERVAL '${parseInt(days)} days'`;
    const daily = await getDailyChart(dealer_id, since, parseInt(days));
    res.json({ daily });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────
function fillDateGaps(rows, days) {
  const map = {};
  rows.forEach(r => { map[r.day?.toISOString?.()?.slice(0,10) || r.day] = r; });

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map[key] || { day: key, sent: 0, opened: 0, clicked: 0 });
  }
  // Return last 14 data points max for chart readability
  return result.slice(-14);
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default router;

// ============================================================
// Add to src/server.js:
// import analyticsRouter from './routes/analytics.js';
// app.use('/api/analytics', analyticsRouter);
// ============================================================
