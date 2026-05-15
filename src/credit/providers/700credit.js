// ============================================================
// src/credit/providers/700credit.js
// 700Credit soft pull implementation
//
// Docs: https://docs.700credit.com
// Products: PreScreen, SoftPull, QuickScreen
// Bureaus: Equifax, Experian, TransUnion
//
// Dealer must have their own 700Credit account.
// Credentials stored encrypted per dealer record.
// ============================================================

export async function pull({ dealer, applicant }) {
  const { credit_api_key, credit_dealer_id, credit_config } = dealer;

  if (!credit_api_key) throw new Error('700Credit API key not configured for this dealer');
  if (!credit_dealer_id) throw new Error('700Credit dealer ID not configured');

  const bureau  = credit_config?.bureau  || 'equifax';
  const product = credit_config?.product || 'softpull';
  const env     = credit_config?.env     || 'live';

  const baseUrl = env === 'sandbox'
    ? 'https://sandbox.api.700credit.com/v2'
    : 'https://api.700credit.com/v2';

  const endpoint = {
    softpull:   `${baseUrl}/softpull`,
    prescreen:  `${baseUrl}/prescreen`,
    quickscreen:`${baseUrl}/quickscreen`,
  }[product] || `${baseUrl}/softpull`;

  const payload = {
    dealer_id:   credit_dealer_id,
    bureau,
    first_name:  applicant.firstName,
    last_name:   applicant.lastName,
    address1:    applicant.address    || '',
    city:        applicant.city       || '',
    state:       applicant.state      || '',
    zip:         applicant.zip,
    dob:         applicant.dob,        // YYYY-MM-DD
    ssn_last4:   applicant.ssnLast4,   // 4 digits only
    is_test:     applicant.isTest || false,
  };

  const response = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${credit_api_key}`,
      'X-Dealer-ID':   credit_dealer_id,
      'X-Product':     product,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'unknown error');
    throw new Error(`700Credit API error ${response.status}: ${err}`);
  }

  const raw = await response.json();

  return normalize700Credit(raw, bureau);
}

function normalize700Credit(raw, bureau) {
  // 700Credit returns different field names depending on product
  const score = raw.vantage_score
    || raw.fico_score
    || raw.score
    || raw.credit_score
    || raw.prescreen_score
    || 0;

  return {
    score,
    bureau:      raw.bureau        || bureau,
    report_date: raw.report_date   || new Date().toISOString().slice(0, 10),
    decision:    raw.decision      || null,
    raw,
  };
}
