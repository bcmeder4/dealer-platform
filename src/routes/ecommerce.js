// ============================================================
// src/routes/ecommerce.js
// E-commerce API routes
//
// POST /api/ecommerce/products/import/csv      — CSV upload
// POST /api/ecommerce/products/import/api      — Shopify API sync
// POST /api/ecommerce/products/import/feed     — RSS feed import
// GET  /api/ecommerce/products                 — list products
// GET  /api/ecommerce/products/:id             — get product
// POST /api/ecommerce/creative/generate        — AI ad creative
// POST /api/ecommerce/creative/campaign        — full campaign package
// GET  /api/ecommerce/creative/:id             — get saved creative
// GET  /api/ecommerce/templates                — list email templates
// POST /api/ecommerce/templates/preview        — preview template
// POST /api/ecommerce/shopify/connect          — save Shopify OAuth
// ============================================================

import express from 'express';
import pool    from '../db/pool.js';
import { importFromCsv, importFromShopifyApi, importFromFeed, resolveProductTokens } from '../ecommerce/shopifyImporter.js';
import { generateAdCreative, generateFullCampaignPackage, getAvailablePlatforms } from '../ecommerce/adCreativeGenerator.js';
import { getTemplates, EMAIL_TEMPLATES } from '../ecommerce/emailTemplates.js';
import { encrypt, decrypt } from '../credit/encryption.js';

const router = express.Router();

// ── Import products from CSV ──────────────────────────────
router.post('/products/import/csv', express.text({ limit: '10mb', type: '*/*' }), async (req, res) => {
  const { client_id, overwrite } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  try {
    const csvText = typeof req.body === 'string' ? req.body : req.body.toString();
    const results = await importFromCsv({ csvText, clientId: client_id, overwrite: overwrite === 'true' });
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync products from Shopify API ────────────────────────
router.post('/products/import/api', async (req, res) => {
  const { client_id, shop_domain } = req.body;
  if (!client_id || !shop_domain) return res.status(400).json({ error: 'client_id and shop_domain required' });

  try {
    // Load encrypted access token
    const { rows: [client] } = await pool.query(
      'SELECT shopify_access_token FROM dealers WHERE id=$1', [client_id]
    );
    if (!client?.shopify_access_token) return res.status(400).json({ error: 'Shopify not connected for this client' });

    const accessToken = decrypt(client.shopify_access_token);
    const results = await importFromShopifyApi({ clientId: client_id, shopDomain: shop_domain, accessToken });
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import from RSS/Atom feed ─────────────────────────────
router.post('/products/import/feed', async (req, res) => {
  const { client_id, feed_url } = req.body;
  if (!client_id || !feed_url) return res.status(400).json({ error: 'client_id and feed_url required' });

  try {
    const results = await importFromFeed({ clientId: client_id, feedUrl: feed_url });
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List products ─────────────────────────────────────────
router.get('/products', async (req, res) => {
  const { client_id, type, vendor, search, limit = 50, offset = 0 } = req.query;

  const conditions = ['published = TRUE'];
  const params = [];
  let p = 1;

  if (client_id) { conditions.push(`client_id=$${p++}`); params.push(client_id); }
  if (type)      { conditions.push(`type ILIKE $${p++}`);   params.push(`%${type}%`); }
  if (vendor)    { conditions.push(`vendor ILIKE $${p++}`); params.push(`%${vendor}%`); }
  if (search)    { conditions.push(`(title ILIKE $${p} OR tags ILIKE $${p})`); params.push(`%${search}%`); p++; }

  const { rows } = await pool.query(`
    SELECT id, handle, title, vendor, type, tags,
           image_url, price, price_max, sku, inventory,
           product_url, source, created_at
    FROM products
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
  `, params);

  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) FROM products WHERE ${conditions.join(' AND ')}`, params
  );

  res.json({ products: rows, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) });
});

// ── Get single product ────────────────────────────────────
router.get('/products/:id', async (req, res) => {
  const { rows: [product] } = await pool.query(
    'SELECT * FROM products WHERE id=$1', [req.params.id]
  );
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// ── Generate AI ad creative ───────────────────────────────
router.post('/creative/generate', async (req, res) => {
  const { product_id, client_id, platforms, campaign, count } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  try {
    const results = await generateAdCreative({
      productId: product_id,
      clientId:  client_id,
      platforms: platforms || ['tiktok','instagram','facebook','email'],
      campaign,
      count:     count || 3,
    });
    res.json({ ok: true, creative: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate full campaign package ───────────────────────
router.post('/creative/campaign', async (req, res) => {
  const { product_ids, client_id, platforms, campaign } = req.body;
  if (!product_ids?.length) return res.status(400).json({ error: 'product_ids array required' });

  try {
    const results = await generateFullCampaignPackage({
      productIds: product_ids,
      clientId:   client_id,
      platforms,
      campaign,
    });
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get saved creative ────────────────────────────────────
router.get('/creative/:id', async (req, res) => {
  const { rows: [creative] } = await pool.query(
    'SELECT * FROM ad_creatives WHERE id=$1', [req.params.id]
  );
  if (!creative) return res.status(404).json({ error: 'Creative not found' });
  res.json(creative);
});

// ── List available platforms ──────────────────────────────
router.get('/platforms', (req, res) => {
  res.json({ platforms: getAvailablePlatforms() });
});

// ── List email templates ──────────────────────────────────
router.get('/templates', (req, res) => {
  res.json({ templates: getTemplates() });
});

// ── Preview email template with product ──────────────────
router.post('/templates/preview', async (req, res) => {
  const { template_key, product_id, client_id, contact_id, discount_code } = req.body;

  const template = EMAIL_TEMPLATES[template_key];
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const [productRes, clientRes, contactRes] = await Promise.all([
    product_id  ? pool.query('SELECT * FROM products WHERE id=$1', [product_id])    : Promise.resolve({ rows: [{}] }),
    client_id   ? pool.query('SELECT * FROM dealers  WHERE id=$1', [client_id])     : Promise.resolve({ rows: [{}] }),
    contact_id  ? pool.query('SELECT * FROM contacts WHERE id=$1', [contact_id])    : Promise.resolve({ rows: [{}] }),
  ]);

  const product = productRes.rows[0] || {};
  const client  = clientRes.rows[0]  || {};
  const contact = contactRes.rows[0] || { first_name: 'there' };

  const clientWithDiscount = { ...client, discount_code: discount_code || 'SAVE10' };

  let html    = template.html;
  let subject = template.subject;
  let preview = template.preview;

  html    = resolveProductTokens(html,    product, clientWithDiscount, contact);
  subject = resolveProductTokens(subject, product, clientWithDiscount, contact);
  preview = resolveProductTokens(preview, product, clientWithDiscount, contact);

  res.json({ html, subject, preview });
});

// ── Connect Shopify store ─────────────────────────────────
router.post('/shopify/connect', async (req, res) => {
  const { client_id, shop_domain, access_token } = req.body;
  if (!client_id || !shop_domain || !access_token) {
    return res.status(400).json({ error: 'client_id, shop_domain, access_token required' });
  }

  const encryptedToken = encrypt(access_token);

  await pool.query(`
    UPDATE dealers SET
      shopify_domain = $1,
      shopify_access_token = $2,
      updated_at = NOW()
    WHERE id = $3
  `, [shop_domain, encryptedToken, client_id]);

  // Trigger initial product sync
  const results = await importFromShopifyApi({
    clientId:    client_id,
    shopDomain:  shop_domain,
    accessToken: access_token,
  });

  res.json({ ok: true, synced: results.imported, message: `Connected and synced ${results.imported} products` });
});

export default router;

// ============================================================
// DB migrations — run in Coolify terminal:
// ============================================================
/*
node -e "
import('./src/db/pool.js').then(async m => {
  const pool = m.default;
  await pool.query(\`CREATE TABLE IF NOT EXISTS products (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id          UUID REFERENCES dealers(id),
    shopify_product_id TEXT,
    handle             TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT,
    vendor             TEXT,
    type               TEXT,
    tags               TEXT,
    image_url          TEXT,
    price              NUMERIC(10,2) DEFAULT 0,
    price_max          NUMERIC(10,2),
    sku                TEXT,
    inventory          INT DEFAULT 0,
    variants           JSONB DEFAULT '[]',
    product_url        TEXT,
    published          BOOLEAN DEFAULT TRUE,
    source             TEXT DEFAULT 'csv',
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, handle)
  )\`);
  console.log('products table created');
  await pool.query(\`CREATE TABLE IF NOT EXISTS ad_creatives (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id       UUID REFERENCES products(id),
    client_id        UUID REFERENCES dealers(id),
    platforms        JSONB,
    creative_json    JSONB,
    campaign_context JSONB,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )\`);
  console.log('ad_creatives table created');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS shopify_domain TEXT');
  await pool.query('ALTER TABLE dealers ADD COLUMN IF NOT EXISTS shopify_access_token TEXT');
  console.log('dealer shopify columns added');
  await pool.end();
});
"

// Add to src/server.js:
// import ecommerceRouter from './routes/ecommerce.js';
// app.use('/api/ecommerce', ecommerceRouter);
*/
