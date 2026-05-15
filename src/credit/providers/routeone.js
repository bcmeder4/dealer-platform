// ============================================================
// src/credit/providers/routeone.js
// RouteOne F&I and credit platform
//
// Docs: https://developer.routeone.com
// Auth: API key header
// Bureaus: Equifax, Experian
// ============================================================

export async function pull({ dealer, applicant }) {
  const { credit_api_key, credit_dealer_id, credit_config } = dealer;

  if (!credit_api_key) throw new Error('RouteOne API key not configured');
  if (!credit_dealer_id) throw new Error('RouteOne dealer ID not configured');

  const env = credit_config?.env || 'live';
  const baseUrl = env === 'sandbox'
    ? 'https://sandbox.api.routeone.com/v1'
    : 'https://api.routeone.com/v1';

  const bureau = credit_config?.bureau || 'equifax';

  const payload = {
    dealer_number: credit_dealer_id,
    bureau_code:   bureau.toUpperCase().slice(0, 3), // EQF, EXP
    consumer: {
      first_name:    applicant.firstName,
      last_name:     applicant.lastName,
      address:       applicant.address  || '',
      city:          applicant.city     || '',
      state:         applicant.state    || '',
      zip:           applicant.zip,
      date_of_birth: applicant.dob,
      ssn_last4:     applicant.ssnLast4,
    },
    inquiry_type: 'SOFT_PULL',
    test_mode:    applicant.isTest || false,
  };

  const response = await fetch(`${baseUrl}/credit/inquiries`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    credit_api_key,
      'X-Dealer-Id':  credit_dealer_id,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'unknown');
    throw new Error(`RouteOne API error ${response.status}: ${err}`);
  }

  const raw = await response.json();
  return normalizeRouteOne(raw, bureau);
}

function normalizeRouteOne(raw, bureau) {
  const score = raw.credit_score
    || raw.vantage_score
    || raw.fico_score
    || raw.score
    || 0;

  return {
    score,
    bureau:      raw.bureau_used  || bureau,
    report_date: raw.report_date  || new Date().toISOString().slice(0, 10),
    decision:    raw.decision     || null,
    raw,
  };
}
