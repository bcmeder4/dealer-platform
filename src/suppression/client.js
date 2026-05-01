import crypto from 'crypto';
import fetch from 'node-fetch';

const BASE   = process.env.SUPPRESSION_SERVICE_URL;
const SECRET = process.env.PLATFORM_WEBHOOK_SECRET;

const headers = {
  'Content-Type':     'application/json',
  'x-webhook-secret': SECRET,
};

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export async function mintUnsubUrl({ email, dealerId, sendId }) {
  const res = await fetch(`${BASE}/api/mint`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, dealerId, sendId }),
  });
  const { url } = await res.json();
  return url;
}

export async function filterSuppressed(contacts, dealerId) {
  const emails = contacts.map(c => hashEmail(c.email));
  const res    = await fetch(`${BASE}/api/check-batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ emails, dealerId }),
  });
  const { suppressed }  = await res.json();
  const suppressedSet   = new Set(suppressed);
  return contacts.filter(c => !suppressedSet.has(hashEmail(c.email)));
}

export async function isSuppressed({ email, dealerId }) {
  const res = await fetch(`${BASE}/api/check`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, dealerId }),
  });
  const { suppressed } = await res.json();
  return suppressed;
}
