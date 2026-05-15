// ============================================================
// src/credit/router.js
// Pluggable credit provider router
//
// Every dealer/client stores which provider they use.
// This router dispatches to the correct provider and
// returns a normalized response regardless of which
// provider was used.
//
// Adding a new provider:
//   1. Create src/credit/providers/newprovider.js
//   2. Implement the pull({ dealer, applicant }) interface
//   3. Add to PROVIDERS map below
//   4. Done — no other changes needed
// ============================================================

import { pull as pull700Credit }   from './providers/700credit.js';
import { pull as pullDealerTrack }  from './providers/dealertrack.js';
import { pull as pullRouteOne }     from './providers/routeone.js';
import { pull as pullExperian }     from './providers/experian.js';
import { pull as pullGeneric }      from './providers/generic.js';
import pool                         from '../db/pool.js';
import { encrypt, decrypt }         from './encryption.js';

// ── Provider registry ─────────────────────────────────────
// Add new providers here — key matches dealer.credit_provider
const PROVIDERS = {
  '700credit':     pull700Credit,
  'dealertrack':   pullDealerTrack,
  'routeone':      pullRouteOne,
  'experian':      pullExperian,
  'transunion':    pullGeneric,   // use generic until specific impl built
  'equifax':       pullGeneric,
  'idanalytics':   pullGeneric,
  'generic':       pullGeneric,
};

// ── Main pull function ────────────────────────────────────
// Called by prequal.js — never calls a provider directly
export async function pullCredit({ dealer, applicant }) {
  const provider = dealer.credit_provider || '700credit';
  const fn = PROVIDERS[provider];

  if (!fn) {
    throw new Error(`Unknown credit provider: "${provider}". Add it to src/credit/router.js`);
  }

  // Decrypt API key before passing to provider
  const decryptedDealer = {
    ...dealer,
    credit_api_key: dealer.credit_api_key
      ? safeDecrypt(dealer.credit_api_key)
      : null,
    credit_config: dealer.credit_config || {},
  };

  console.log(`Credit pull via ${provider} for dealer ${dealer.name || dealer.id}`);

  const result = await fn({ dealer: decryptedDealer, applicant });

  // Validate normalized response
  if (!result || typeof result.score === 'undefined') {
    throw new Error(`Provider ${provider} returned invalid response`);
  }

  return {
    ...result,
    provider, // always include which provider was used
  };
}

// ── Test provider connection ──────────────────────────────
// Used by dealer onboarding UI to verify credentials
export async function testProviderConnection({ dealer }) {
  const provider = dealer.credit_provider || '700credit';
  const fn = PROVIDERS[provider];
  if (!fn) return { ok: false, error: `Unknown provider: ${provider}` };

  // Use a synthetic test applicant
  const testApplicant = {
    firstName:  'Test',
    lastName:   'Connection',
    address:    '123 Main St',
    city:       'Dallas',
    state:      'TX',
    zip:        '75201',
    dob:        '1980-01-01',
    ssnLast4:   '0000', // test SSN — providers should return test data
    isTest:     true,
  };

  try {
    const decryptedDealer = {
      ...dealer,
      credit_api_key: dealer.credit_api_key
        ? safeDecrypt(dealer.credit_api_key)
        : null,
      credit_config: dealer.credit_config || {},
    };

    await fn({ dealer: decryptedDealer, applicant: testApplicant });
    return { ok: true, provider };
  } catch (err) {
    return { ok: false, provider, error: err.message };
  }
}

// ── Get available providers list ──────────────────────────
export function getAvailableProviders() {
  return [
    {
      key:         '700credit',
      name:        '700Credit',
      description: 'Industry-leading automotive soft pull prescreen',
      website:     'https://www.700credit.com',
      fields:      ['credit_api_key', 'credit_dealer_id'],
      bureaus:     ['equifax', 'experian', 'transunion'],
      docs:        'https://docs.700credit.com',
    },
    {
      key:         'dealertrack',
      name:        'DealerTrack',
      description: 'Cox Automotive DealerTrack credit platform',
      website:     'https://www.dealertrack.com',
      fields:      ['credit_api_key', 'credit_dealer_id'],
      bureaus:     ['equifax', 'experian', 'transunion'],
      docs:        'https://developer.dealertrack.com',
    },
    {
      key:         'routeone',
      name:        'RouteOne',
      description: 'RouteOne F&I and credit platform',
      website:     'https://www.routeone.com',
      fields:      ['credit_api_key', 'credit_dealer_id'],
      bureaus:     ['equifax', 'experian'],
      docs:        'https://developer.routeone.com',
    },
    {
      key:         'experian',
      name:        'Experian AutoCheck',
      description: 'Direct Experian automotive credit',
      website:     'https://www.experian.com/automotive',
      fields:      ['credit_api_key'],
      bureaus:     ['experian'],
      docs:        'https://developer.experian.com',
    },
    {
      key:         'generic',
      name:        'Generic REST API',
      description: 'Connect any credit provider via REST API',
      website:     null,
      fields:      ['credit_api_key', 'credit_api_endpoint'],
      bureaus:     ['equifax', 'experian', 'transunion'],
      docs:        null,
    },
  ];
}

// ── Save provider config for a dealer ─────────────────────
export async function saveProviderConfig({ dealerId, provider, apiKey, dealerAccountId, config }) {
  const encryptedKey = apiKey ? encrypt(apiKey) : null;

  await pool.query(`
    UPDATE dealers SET
      credit_provider   = $1,
      credit_api_key    = $2,
      credit_dealer_id  = $3,
      credit_config     = $4
    WHERE id = $5
  `, [provider, encryptedKey, dealerAccountId || null,
      JSON.stringify(config || {}), dealerId]);

  return { ok: true };
}

function safeDecrypt(value) {
  try { return decrypt(value); }
  catch { return value; } // return as-is if not encrypted (legacy)
}
