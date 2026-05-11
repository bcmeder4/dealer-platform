// ============================================================
// src/credit/prequal.js
// 700Credit soft pull pre-qualification integration
//
// FCRA COMPLIANCE NOTES:
//   - Customer must consent before any pull
//   - Consent is logged with timestamp + IP
//   - Credit data stored AES-256 encrypted
//   - Only dealer-authenticated users can view full report
//   - Customer sees result message only (no raw score)
//   - Data auto-purged after retention period
//   - Every access is audit-logged
//
// 700Credit API docs: https://www.700credit.com/api
// Dealer must have their own 700Credit account
// ============================================================

import crypto    from 'crypto';
import pool      from '../db/pool.js';
import fetch     from 'node-fetch';

// ── Encryption helpers ────────────────────────────────────
// AES-256-GCM — authenticated encryption for credit data
const ENCRYPTION_KEY = Buffer.from(
  process.env.CREDIT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
  'hex'
);

function encrypt(plaintext) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext) {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv        = Buffer.from(ivHex,       'hex');
  const authTag   = Buffer.from(authTagHex,  'hex');
  const encrypted = Buffer.from(encryptedHex,'hex');
  const decipher  = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── 700Credit API call ────────────────────────────────────
// Performs a soft pull using dealer's own 700Credit credentials
// Soft pull = no impact on consumer's credit score

async function call700Credit({ dealer, applicant }) {
  if (!dealer.credit_api_key || !dealer.credit_dealer_id) {
    throw new Error(`Dealer ${dealer.name} has no 700Credit credentials configured`);
  }

  // 700Credit PreScreen / SoftPull endpoint
  // Exact endpoint varies by product — consult 700Credit API docs
  const response = await fetch('https://api.700credit.com/v2/softpull', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${dealer.credit_api_key}`,
      'X-Dealer-ID':   dealer.credit_dealer_id,
    },
    body: JSON.stringify({
      first_name:   applicant.firstName,
      last_name:    applicant.lastName,
      address1:     applicant.address,
      city:         applicant.city,
      state:        applicant.state,
      zip:          applicant.zip,
      dob:          applicant.dob,       // YYYY-MM-DD
      ssn_last4:    applicant.ssnLast4,  // last 4 digits only
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`700Credit API error ${response.status}: ${errText}`);
  }

  return response.json();
}

// ── Map score to approval tier ────────────────────────────
// Converts raw score to dealer-friendly tier
// We show tier to customer — never raw score

function scoreTier(score) {
  if (score >= 750) return { tier: 'excellent',  label: 'Excellent',   message: 'You qualify for our best financing rates.' };
  if (score >= 700) return { tier: 'good',       label: 'Good',        message: 'You qualify for competitive financing.' };
  if (score >= 650) return { tier: 'fair',       label: 'Fair',        message: 'Financing options are available for you.' };
  if (score >= 600) return { tier: 'challenged', label: 'We Can Help', message: 'Our finance team has options for your situation.' };
  return               { tier: 'special',       label: 'Special Finance', message: 'Our special finance team specializes in situations like yours.' };
}

// ── Submit pre-qual form ──────────────────────────────────
// Called when customer submits the pre-qual form.
// Validates consent, calls 700Credit, stores encrypted result.

export async function submitPrequal({ formData, contactId, vehicleId, dealerId, sendId, ip, userAgent }) {
  const { firstName, lastName, address, city, state, zip, dob, ssnLast4, consentGiven } = formData;

  // Validate consent — required by FCRA
  if (!consentGiven) throw new Error('FCRA consent not given');

  // Validate minimum required fields
  if (!firstName || !lastName)      throw new Error('Name required');
  if (!ssnLast4 || ssnLast4.length !== 4 || !/^\d{4}$/.test(ssnLast4)) {
    throw new Error('Last 4 of SSN required (digits only)');
  }
  if (!dob) throw new Error('Date of birth required');
  if (!zip)  throw new Error('ZIP code required');

  // Load dealer credentials
  const { rows: [dealer] } = await pool.query(
    'SELECT * FROM dealers WHERE id=$1', [dealerId]
  );
  if (!dealer) throw new Error('Dealer not found');

  // Log consent BEFORE making any credit inquiry (FCRA requirement)
  const { rows: [consent] } = await pool.query(`
    INSERT INTO credit_consents
      (contact_id, vehicle_id, dealer_id, send_id,
       first_name, last_name, ip, user_agent, consented_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    RETURNING id
  `, [contactId, vehicleId, dealerId, sendId,
      firstName, lastName, ip, userAgent]);

  // Call 700Credit API
  let apiResult;
  try {
    apiResult = await call700Credit({
      dealer,
      applicant: { firstName, lastName, address, city, state, zip, dob, ssnLast4 },
    });
  } catch (err) {
    // Log failed attempt
    await pool.query(
      `UPDATE credit_consents SET error=$1 WHERE id=$2`,
      [err.message, consent.id]
    ).catch(() => {});
    throw err;
  }

  const score    = apiResult.score || apiResult.vantage_score || apiResult.fico_score || 0;
  const bureau   = apiResult.bureau || 'equifax';
  const tier     = scoreTier(score);

  // Encrypt everything before storage
  const encryptedScore  = encrypt(score.toString());
  const encryptedReport = encrypt(JSON.stringify(apiResult));
  const encryptedSsn4   = encrypt(ssnLast4);
  const encryptedDob    = encrypt(dob);

  // Store encrypted result
  const { rows: [prequal] } = await pool.query(`
    INSERT INTO credit_prequals
      (consent_id, contact_id, vehicle_id, dealer_id, send_id,
       score_encrypted, report_encrypted, ssn_last4_encrypted,
       dob_encrypted, bureau, tier, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    RETURNING id, tier
  `, [consent.id, contactId, vehicleId, dealerId, sendId,
      encryptedScore, encryptedReport, encryptedSsn4,
      encryptedDob, bureau, tier.tier]);

  // Update consent record as completed
  await pool.query(
    `UPDATE credit_consents SET prequal_id=$1 WHERE id=$2`,
    [prequal.id, consent.id]
  ).catch(() => {});

  // Load vehicle and dealer for result message
  const { rows: [vehicle] } = await pool.query(
    'SELECT * FROM vehicles WHERE id=$1', [vehicleId]
  ).catch(() => ({ rows: [null] }));

  // Fire ADF lead with pre-qual flag
  const { autoForwardLead } = await import('../leads/adf.js');
  await autoForwardLead({
    replyId:        prequal.id,
    contactId,
    vehicleId,
    dealerId,
    sendId,
    body:           `Customer pre-qualified via soft pull. Tier: ${tier.label}. Interested in ${vehicle?.year} ${vehicle?.make} ${vehicle?.model}.`,
    classification: 'interested',
  }).catch(err => console.error('ADF forward error:', err.message));

  // Return customer-facing result (no raw score)
  return {
    prequalId:   prequal.id,
    tier:        tier.tier,
    tierLabel:   tier.label,
    message:     tier.message,
    vehicle:     vehicle ? {
      year:  vehicle.year,
      make:  vehicle.make,
      model: vehicle.model,
      trim:  vehicle.trim,
      price: vehicle.price,
    } : null,
    dealer: {
      name:  dealer.name,
      phone: dealer.phone,
    },
  };
}

// ── Get full report (dealer back office only) ─────────────
// Only callable by authenticated dealer users
// Logs every access for compliance audit trail

export async function getDealerReport({ prequalId, dealerId, accessedBy }) {
  const { rows: [prequal] } = await pool.query(
    `SELECT * FROM credit_prequals WHERE id=$1 AND dealer_id=$2`,
    [prequalId, dealerId]
  );

  if (!prequal) throw new Error('Pre-qual not found or access denied');

  // Audit log every access
  await pool.query(`
    INSERT INTO credit_access_log
      (prequal_id, dealer_id, accessed_by, accessed_at, ip)
    VALUES ($1,$2,$3,NOW(),$4)
  `, [prequalId, dealerId, accessedBy, null]).catch(() => {});

  // Decrypt
  const score  = parseInt(decrypt(prequal.score_encrypted), 10);
  const report = JSON.parse(decrypt(prequal.report_encrypted));
  const tier   = scoreTier(score);

  return {
    prequalId:    prequal.id,
    score,
    tier:         tier.tier,
    tierLabel:    tier.label,
    bureau:       prequal.bureau,
    completedAt:  prequal.completed_at,
    report,       // full 700Credit API response
  };
}

// ── Generate pre-qual URL for email ──────────────────────
// Creates a signed, time-limited URL to include in email
// URL is specific to contact + vehicle + send

export function generatePrequalUrl({ contactId, vehicleId, dealerId, sendId }) {
  // Build signed token — expires in 14 days
  const payload = Buffer.from(JSON.stringify({
    cid: contactId,
    vid: vehicleId,
    did: dealerId,
    sid: sendId,
    exp: Date.now() + 14 * 24 * 60 * 60 * 1000,
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', process.env.PLATFORM_WEBHOOK_SECRET || 'secret')
    .update(payload)
    .digest('hex')
    .slice(0, 16);

  return `https://app.cars-dealer.com/prequal?t=${payload}.${sig}`;
}

// ── Verify pre-qual token ─────────────────────────────────
export function verifyPrequalToken(token) {
  const [payload, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.PLATFORM_WEBHOOK_SECRET || 'secret')
    .update(payload)
    .digest('hex')
    .slice(0, 16);

  if (sig !== expectedSig) throw new Error('Invalid token');

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > data.exp)  throw new Error('Token expired');

  return { contactId: data.cid, vehicleId: data.vid, dealerId: data.did, sendId: data.sid };
}

// ============================================================
// DB schema — run in Coolify terminal
// ============================================================
/*
-- Consent log (FCRA required — must log before pulling credit)
CREATE TABLE IF NOT EXISTS credit_consents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id  UUID REFERENCES contacts(id),
  vehicle_id  UUID REFERENCES vehicles(id),
  dealer_id   UUID REFERENCES dealers(id),
  send_id     UUID REFERENCES sends(id),
  prequal_id  UUID,
  first_name  TEXT,
  last_name   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  error       TEXT,
  consented_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-qual results (all sensitive data encrypted)
CREATE TABLE IF NOT EXISTS credit_prequals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consent_id          UUID REFERENCES credit_consents(id),
  contact_id          UUID REFERENCES contacts(id),
  vehicle_id          UUID REFERENCES vehicles(id),
  dealer_id           UUID REFERENCES dealers(id),
  send_id             UUID REFERENCES sends(id),
  score_encrypted     TEXT NOT NULL,
  report_encrypted    TEXT NOT NULL,
  ssn_last4_encrypted TEXT NOT NULL,
  dob_encrypted       TEXT NOT NULL,
  bureau              TEXT DEFAULT 'equifax',
  tier                TEXT NOT NULL,
  completed_at        TIMESTAMPTZ DEFAULT NOW(),
  purge_at            TIMESTAMPTZ DEFAULT NOW() + INTERVAL '90 days'
);

CREATE INDEX IF NOT EXISTS idx_prequals_dealer
  ON credit_prequals(dealer_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_prequals_contact
  ON credit_prequals(contact_id);

-- Access audit log (every view of credit data is logged)
CREATE TABLE IF NOT EXISTS credit_access_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prequal_id  UUID REFERENCES credit_prequals(id),
  dealer_id   UUID REFERENCES dealers(id),
  accessed_by TEXT,
  ip          TEXT,
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add 700Credit credentials to dealers table
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS credit_api_key    TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS credit_dealer_id  TEXT;

-- Auto-purge cron (run monthly to delete expired credit data)
-- In production add this to your scheduler:
-- DELETE FROM credit_prequals WHERE purge_at < NOW();
-- DELETE FROM credit_consents WHERE consented_at < NOW() - INTERVAL '90 days';
*/

// ============================================================
// Add to .env:
// CREDIT_ENCRYPTION_KEY=generate with: openssl rand -hex 32
// ============================================================
