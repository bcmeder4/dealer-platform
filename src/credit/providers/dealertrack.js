// ============================================================
// src/credit/providers/dealertrack.js
// Cox Automotive DealerTrack credit platform
//
// Docs: https://developer.dealertrack.com
// Auth: OAuth 2.0 client credentials
// Bureaus: Equifax, Experian, TransUnion
// ============================================================

let tokenCache = {}; // { dealerId: { token, expires } }

export async function pull({ dealer, applicant }) {
  const { credit_api_key, credit_dealer_id, credit_config } = dealer;

  if (!credit_api_key) throw new Error('DealerTrack API key not configured');
  if (!credit_dealer_id) throw new Error('DealerTrack dealer ID not configured');

  const env = credit_config?.env || 'live';
  const baseUrl = env === 'sandbox'
    ? 'https://sandbox.api.dealertrack.com'
    : 'https://api.dealertrack.com';

  // Get OAuth token (cached per dealer)
  const token = await getToken({ dealer, baseUrl });

  const bureau = credit_config?.bureau || 'equifax';

  const payload = {
    dealerId:    credit_dealer_id,
    bureau,
    applicant: {
      firstName:  applicant.firstName,
      lastName:   applicant.lastName,
      streetLine1: applicant.address || '',
      city:        applicant.city    || '',
      state:       applicant.state   || '',
      postalCode:  applicant.zip,
      dateOfBirth: applicant.dob,     // YYYY-MM-DD
      ssn4:        applicant.ssnLast4,
    },
    inquiryType: 'SOFT',
    isTest:      applicant.isTest || false,
  };

  const response = await fetch(`${baseUrl}/v1/credit/inquiries`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Dealer-Id':   credit_dealer_id,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'unknown');
    throw new Error(`DealerTrack API error ${response.status}: ${err}`);
  }

  const raw = await response.json();
  return normalizeDealerTrack(raw, bureau);
}

async function getToken({ dealer, baseUrl }) {
  const cacheKey = dealer.id || dealer.credit_dealer_id;
  const cached = tokenCache[cacheKey];
  if (cached && cached.expires > Date.now() + 60000) return cached.token;

  // DealerTrack uses client_credentials OAuth
  // credit_api_key format: "clientId:clientSecret"
  const [clientId, clientSecret] = (dealer.credit_api_key || ':').split(':');

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'credit:read',
    }),
  });

  if (!res.ok) throw new Error('DealerTrack OAuth failed');

  const { access_token, expires_in } = await res.json();
  tokenCache[cacheKey] = {
    token:   access_token,
    expires: Date.now() + (expires_in * 1000),
  };
  return access_token;
}

function normalizeDealerTrack(raw, bureau) {
  const score = raw.creditScore
    || raw.score
    || raw.vantageSore
    || raw.ficoScore
    || 0;

  return {
    score,
    bureau:      raw.bureau      || bureau,
    report_date: raw.reportDate  || new Date().toISOString().slice(0, 10),
    decision:    raw.decision    || null,
    raw,
  };
}
