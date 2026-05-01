import pool from '../db/pool.js';

const THRESHOLDS = {
  HEALTHY:    80,
  CAUTION:    60,
  RESTRICTED: 40,
  SUSPENDED:  20,
};

const WARMUP_SCHEDULE = [
  { day:  1, limit:   5 },
  { day:  2, limit:  10 },
  { day:  3, limit:  15 },
  { day:  5, limit:  25 },
  { day:  7, limit:  30 },
  { day: 10, limit:  40 },
  { day: 14, limit:  50 },
  { day: 21, limit:  75 },
  { day: 30, limit: 100 },
];

export async function pickDomain(dealerId) {
  const { rows } = await pool.query(`
    SELECT * FROM sending_domains
    WHERE dealer_id   = $1
      AND status     IN ('active','caution','warming')
      AND sends_today < daily_limit
      AND health_score >= $2
    ORDER BY (health_score * random()) DESC
    LIMIT 1
  `, [dealerId, THRESHOLDS.RESTRICTED]);

  if (!rows.length) throw new Error(`No available sending domains for dealer ${dealerId}`);
  return rows[0];
}

export async function allocateDomains(dealerId, totalSends) {
  const { rows: domains } = await pool.query(`
    SELECT *, (daily_limit - sends_today) AS remaining_capacity
    FROM sending_domains
    WHERE dealer_id   = $1
      AND status     IN ('active','caution','warming')
      AND sends_today < daily_limit
      AND health_score >= $2
    ORDER BY health_score DESC
  `, [dealerId, THRESHOLDS.RESTRICTED]);

  if (!domains.length) throw new Error('No domains available for campaign allocation');

  const totalCapacity = domains.reduce((s, d) => s + d.remaining_capacity, 0);
  const totalHealth   = domains.reduce((s, d) => s + d.health_score, 0);
  const allocations   = [];
  let remaining = Math.min(totalSends, totalCapacity);

  for (const domain of domains) {
    if (remaining <= 0) break;
    const share = Math.round((domain.health_score / totalHealth) * totalSends);
    const alloc = Math.min(share, domain.remaining_capacity, remaining);
    if (alloc > 0) { allocations.push({ domain, allocatedSends: alloc }); remaining -= alloc; }
  }
  if (remaining > 0 && allocations.length > 0) allocations[0].allocatedSends += remaining;
  return allocations;
}

export async function recordSend(domainId) {
  await pool.query(
    `UPDATE sending_domains SET sends_today=sends_today+1, sends_total=sends_total+1, last_send_at=NOW() WHERE id=$1`,
    [domainId]
  );
  await upsertDailyStat(domainId, 'sends', 1);
}

export async function handleDeliveryEvent(domainId, eventType) {
  const adjustments = {
    delivered: +0.5, opened: +1.0, clicked: +0.5,
    bounced: -5.0, soft_bounce: -1.0, complained: -15.0, deferred: -0.5,
  };
  const delta = adjustments[eventType] || 0;
  if (delta === 0) return;

  const { rows: [domain] } = await pool.query(`
    UPDATE sending_domains SET
      health_score    = GREATEST(0, LEAST(100, health_score + $1)),
      bounce_count    = bounce_count    + $2,
      complaint_count = complaint_count + $3,
      open_count      = open_count      + $4,
      last_bounce_at  = CASE WHEN $5 THEN NOW() ELSE last_bounce_at END
    WHERE id = $6 RETURNING *
  `, [
    delta,
    ['bounced','soft_bounce'].includes(eventType) ? 1 : 0,
    eventType === 'complained' ? 1 : 0,
    eventType === 'opened' ? 1 : 0,
    ['bounced','soft_bounce'].includes(eventType),
    domainId,
  ]);

  await refreshDomainStatus(domain);
  await upsertDailyStat(domainId, eventType, 1);
}

async function refreshDomainStatus(domain) {
  if (domain.status === 'warming' && !domain.graduated_at) return;
  const score = domain.health_score;
  let newStatus = score >= THRESHOLDS.HEALTHY    ? 'active'
                : score >= THRESHOLDS.CAUTION    ? 'caution'
                : score >= THRESHOLDS.RESTRICTED ? 'restricted'
                :                                  'suspended';

  if (newStatus !== domain.status) {
    await pool.query('UPDATE sending_domains SET status=$1 WHERE id=$2', [newStatus, domain.id]);
    if (newStatus === 'suspended') {
      console.error(`DOMAIN SUSPENDED: ${domain.domain} — health: ${score}, bounces: ${domain.bounce_count}, complaints: ${domain.complaint_count}`);
    }
  }
}

export async function advanceWarmup() {
  const { rows } = await pool.query(`SELECT * FROM sending_domains WHERE status='warming'`);
  for (const domain of rows) {
    const ageDays = Math.floor((Date.now() - new Date(domain.warmup_started).getTime()) / 86400000);
    if (ageDays >= 30) {
      await pool.query(
        `UPDATE sending_domains SET status='active', daily_limit=100, graduated_at=NOW() WHERE id=$1`,
        [domain.id]
      );
      console.log(`Domain graduated: ${domain.domain}`);
    } else {
      const schedule = [...WARMUP_SCHEDULE].reverse().find(s => ageDays >= s.day);
      await pool.query('UPDATE sending_domains SET daily_limit=$1 WHERE id=$2', [schedule?.limit || 5, domain.id]);
    }
  }
  await pool.query(`UPDATE sending_domains SET sends_today=0 WHERE DATE(last_send_at) < CURRENT_DATE OR last_send_at IS NULL`);
}

export async function importDomainsFromCsv(dealerId, rows) {
  const results = { imported: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    const domain = (row.domain || row.Domain || '').trim().toLowerCase();
    if (!domain) { results.skipped++; continue; }
    if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      results.errors.push({ domain, reason: 'Invalid domain format' }); continue;
    }
    try {
      await pool.query(`
        INSERT INTO sending_domains
          (dealer_id, domain, display_name, from_email, smtp_host, smtp_port,
           smtp_user, smtp_pass, postal_server_key, notes, status, health_score, daily_limit, warmup_started)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'warming',100,5,NOW())
        ON CONFLICT (domain) DO UPDATE SET
          display_name=EXCLUDED.display_name, smtp_host=EXCLUDED.smtp_host,
          smtp_port=EXCLUDED.smtp_port, smtp_user=EXCLUDED.smtp_user,
          smtp_pass=EXCLUDED.smtp_pass, postal_server_key=EXCLUDED.postal_server_key,
          notes=EXCLUDED.notes
      `, [
        dealerId, domain,
        (row.display_name || row.name || '').trim() || null,
        (row.from_email   || row.email || `sales@${domain}`).trim(),
        (row.smtp_host    || row.host  || '').trim() || null,
        parseInt(row.smtp_port || row.port || 587, 10),
        (row.smtp_user    || row.user  || row.username || '').trim() || null,
        (row.smtp_pass    || row.password || row.pass  || '').trim() || null,
        (row.postal_server_key || row.api_key || '').trim() || null,
        (row.notes || '').trim() || null,
      ]);
      results.imported++;
    } catch (err) {
      results.errors.push({ domain, reason: err.message });
    }
  }
  return results;
}

export async function getDomainPoolStatus(dealerId) {
  const { rows } = await pool.query(`
    SELECT d.*,
      COALESCE(s.sends,0)      AS today_sends,
      COALESCE(s.bounced,0)    AS today_bounces,
      COALESCE(s.complained,0) AS today_complaints,
      FLOOR(EXTRACT(EPOCH FROM (NOW()-d.warmup_started))/86400) AS age_days
    FROM sending_domains d
    LEFT JOIN domain_daily_stats s ON s.domain_id=d.id AND s.date=CURRENT_DATE
    WHERE d.dealer_id=$1
    ORDER BY d.health_score DESC, d.domain
  `, [dealerId]);
  return rows;
}

export async function retireDomain(domainId) {
  await pool.query(`UPDATE sending_domains SET status='retired' WHERE id=$1`, [domainId]);
}

async function upsertDailyStat(domainId, field, increment) {
  const allowed = ['sends','delivered','bounced','complained','opened','clicked'];
  if (!allowed.includes(field)) return;
  await pool.query(`
    INSERT INTO domain_daily_stats (domain_id, date, ${field}) VALUES ($1, CURRENT_DATE, $2)
    ON CONFLICT (domain_id, date) DO UPDATE SET ${field} = domain_daily_stats.${field} + $2
  `, [domainId, increment]);
}
