// ============================================================
// src/credit/providers/experian.js
// Experian Automotive direct credit integration
//
// Docs: https://developer.experian.com/products/automotive
// Auth: OAuth 2.0
// Bureau: Experian only
// ============================================================

let tokenCache = {};

export async function pull({ dealer, applicant }) {
  const { credit_api_key, credit_config } = dealer;

  if (!credit_api_key) throw new Error('Experian API credentials not configured');

  const env = credit_config?.env || 'live';
  const baseUrl = env === 'sandbox'
    ? 'https://sandbox-us-api.experian.com/automotive'
    : 'https://us-api.experian.com/automotive';

  const token = await getToken({ dealer, baseUrl });

  const payload = {
    primaryApplicant: {
      name: {
        firstName: applicant.firstName,
        lastName:  applicant.lastName,
      },
      address: {
        street:  applicant.address || '',
        city:    applicant.city    || '',
        state:   applicant.state   || '',
        zip:     applicant.zip,
      },
      dateOfBirth: applicant.dob,
      socialSecurityNumber: {
        last4: applicant.ssnLast4,
      },
    },
    inquiryType: 'SOFT',
    testIndicator: applicant.isTest || false,
  };

  const response = await fetch(`${baseUrl}/v1/credit/prequalification`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'unknown');
    throw new Error(`Experian API error ${response.status}: ${err}`);
  }

  const raw = await response.json();
  return normalizeExperian(raw);
}

async function getToken({ dealer, baseUrl }) {
  const cacheKey = dealer.id || 'experian';
  const cached = tokenCache[cacheKey];
  if (cached && cached.expires > Date.now() + 60000) return cached.token;

  // credit_api_key format: "clientId:clientSecret"
  const [clientId, clientSecret] = (dealer.credit_api_key || ':').split(':');

  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) throw new Error('Experian OAuth failed');
  const { access_token, expires_in } = await res.json();
  tokenCache[cacheKey] = { token: access_token, expires: Date.now() + (expires_in * 1000) };
  return access_token;
}

function normalizeExperian(raw) {
  const score = raw.vantageScore3
    || raw.ficoBankcard8
    || raw.score
    || raw.creditScore
    || 0;

  return {
    score,
    bureau:      'experian',
    report_date: raw.reportDate   || new Date().toISOString().slice(0, 10),
    decision:    raw.decision     || null,
    raw,
  };
}
