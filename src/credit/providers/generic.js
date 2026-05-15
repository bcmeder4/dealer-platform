// ============================================================
// src/credit/providers/generic.js
// Generic REST API provider
//
// Allows connecting ANY credit provider that has a REST API.
// All configuration comes from dealer.credit_config JSONB.
//
// Required credit_config fields:
//   endpoint      — full API URL
//   auth_type     — "bearer" | "apikey" | "basic" | "none"
//   auth_header   — header name for API key (default: "Authorization")
//   field_map     — maps our field names to provider's field names
//   score_field   — JSON path to score in response (e.g. "data.score")
//   bureau_field  — JSON path to bureau in response
//
// Example credit_config for a hypothetical provider:
// {
//   "endpoint": "https://api.myprovider.com/v1/softpull",
//   "auth_type": "bearer",
//   "bureau": "equifax",
//   "field_map": {
//     "firstName":  "first_name",
//     "lastName":   "last_name",
//     "address":    "street_address",
//     "city":       "city",
//     "state":      "state_code",
//     "zip":        "postal_code",
//     "dob":        "date_of_birth",
//     "ssnLast4":   "ssn4"
//   },
//   "score_field": "result.credit_score",
//   "bureau_field": "result.bureau"
// }
// ============================================================

export async function pull({ dealer, applicant }) {
  const { credit_api_key, credit_config } = dealer;
  const config = credit_config || {};

  if (!config.endpoint) {
    throw new Error('Generic provider requires credit_config.endpoint');
  }

  // Build request body using field map
  const fieldMap = config.field_map || defaultFieldMap;
  const body = mapFields(applicant, fieldMap);

  // Build auth header
  const headers = { 'Content-Type': 'application/json' };
  const authType = config.auth_type || 'bearer';
  const authHeader = config.auth_header || 'Authorization';

  if (authType === 'bearer' && credit_api_key) {
    headers[authHeader] = `Bearer ${credit_api_key}`;
  } else if (authType === 'apikey' && credit_api_key) {
    headers[authHeader] = credit_api_key;
  } else if (authType === 'basic' && credit_api_key) {
    headers[authHeader] = `Basic ${Buffer.from(credit_api_key).toString('base64')}`;
  }

  // Add any extra headers from config
  if (config.extra_headers) {
    Object.assign(headers, config.extra_headers);
  }

  const response = await fetch(config.endpoint, {
    method:  config.method || 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'unknown');
    throw new Error(`Generic provider error ${response.status}: ${err}`);
  }

  const raw = await response.json();

  // Extract score using dot-notation path
  const score = getNestedValue(raw, config.score_field || 'score') || 0;
  const bureau = getNestedValue(raw, config.bureau_field) || config.bureau || 'unknown';

  return {
    score:       parseInt(score, 10),
    bureau,
    report_date: getNestedValue(raw, config.date_field) || new Date().toISOString().slice(0, 10),
    decision:    getNestedValue(raw, config.decision_field) || null,
    raw,
  };
}

// ── Default field mapping ─────────────────────────────────
// Used if no field_map provided in config
const defaultFieldMap = {
  firstName:  'first_name',
  lastName:   'last_name',
  address:    'address',
  city:       'city',
  state:      'state',
  zip:        'zip',
  dob:        'dob',
  ssnLast4:   'ssn_last4',
};

function mapFields(applicant, fieldMap) {
  const result = {};
  for (const [ourKey, theirKey] of Object.entries(fieldMap)) {
    if (applicant[ourKey] !== undefined) {
      result[theirKey] = applicant[ourKey];
    }
  }
  return result;
}

// ── Get nested value via dot notation ─────────────────────
// e.g. getNestedValue({a:{b:{c:42}}}, "a.b.c") => 42
function getNestedValue(obj, path) {
  if (!path || !obj) return null;
  return path.split('.').reduce((curr, key) => curr?.[key], obj) ?? null;
}
