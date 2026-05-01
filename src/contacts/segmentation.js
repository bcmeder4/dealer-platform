import pool from '../db/pool.js';

export async function getSegmentContacts(dealerId, filters = {}) {
  const conditions = [
    'c.dealer_id = $1',
    'c.unsubscribed = FALSE',
    'c.bounced = FALSE',
  ];
  const params = [dealerId];
  let p = 2;

  if (filters.make) {
    conditions.push(`c.make_interest ILIKE $${p++}`);
    params.push(filters.make);
  }
  if (filters.model) {
    conditions.push(`c.model_interest ILIKE $${p++}`);
    params.push(`%${filters.model}%`);
  }
  if (filters.zip_prefix) {
    conditions.push(`c.zip LIKE $${p++}`);
    params.push(`${filters.zip_prefix}%`);
  }
  if (filters.status) {
    conditions.push(`c.status = $${p++}`);
    params.push(filters.status);
  }
  if (filters.tags?.length) {
    conditions.push(`c.tags @> $${p++}::text[]`);
    params.push(filters.tags);
  }
  if (filters.last_purchase_year_min) {
    conditions.push(`c.last_purchase_year >= $${p++}`);
    params.push(filters.last_purchase_year_min);
  }
  if (filters.last_purchase_year_max) {
    conditions.push(`c.last_purchase_year <= $${p++}`);
    params.push(filters.last_purchase_year_max);
  }

  const { rows } = await pool.query(
    `SELECT c.* FROM contacts c WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC`,
    params
  );
  return rows;
}

export async function countSegmentContacts(dealerId, filters = {}) {
  const contacts = await getSegmentContacts(dealerId, filters);
  return contacts.length;
}
