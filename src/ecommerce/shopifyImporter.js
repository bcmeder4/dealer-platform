// ============================================================
// src/ecommerce/shopifyImporter.js
// Shopify product feed importer
//
// Supports three import methods:
//   1. CSV upload (client exports from Shopify admin)
//   2. Shopify REST API (OAuth connected store)
//   3. Shopify RSS/XML feed (public product feed URL)
//
// All three normalize to the same products table schema
// so the rest of the platform never knows which method was used
// ============================================================

import pool from '../db/pool.js';

// ── 1. CSV Import ─────────────────────────────────────────
// Parses standard Shopify CSV export format
// Client: Shopify Admin → Products → Export → CSV

export async function importFromCsv({ csvText, clientId, overwrite = false }) {
  const rows    = parseCsv(csvText);
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const results = { imported: 0, updated: 0, skipped: 0, errors: [] };

  // Group rows by handle (each product has multiple rows for variants)
  const productMap = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || row.every(c => !c)) continue;

    const col  = (name) => row[headers.indexOf(name)] || '';
    const handle = col('handle');
    if (!handle) continue;

    if (!productMap.has(handle)) {
      productMap.set(handle, {
        handle,
        title:       col('title'),
        description: col('body (html)') || col('body'),
        vendor:      col('vendor'),
        type:        col('type'),
        tags:        col('tags'),
        published:   col('published')?.toLowerCase() === 'true',
        image_url:   col('image src'),
        image_alt:   col('image alt text'),
        seo_title:   col('seo title'),
        variants:    [],
      });
    }

    // Add variant
    const price = parseFloat(col('variant price') || col('price') || '0');
    if (price > 0 || col('variant sku')) {
      productMap.get(handle).variants.push({
        sku:           col('variant sku'),
        price,
        compare_price: parseFloat(col('variant compare at price') || '0') || null,
        inventory:     parseInt(col('variant inventory qty') || '0', 10),
        option1:       col('option1 value') || col('option1 name'),
        option2:       col('option2 value') || null,
        weight:        parseFloat(col('variant weight') || '0') || null,
      });
    }
  }

  // Upsert each product
  for (const [handle, product] of productMap) {
    try {
      const variants    = product.variants;
      const minPrice    = variants.length ? Math.min(...variants.map(v => v.price)) : 0;
      const maxPrice    = variants.length ? Math.max(...variants.map(v => v.price)) : 0;
      const totalStock  = variants.reduce((s, v) => s + (v.inventory || 0), 0);
      const primarySku  = variants[0]?.sku || null;

      // Build product page URL (Shopify standard format)
      const productUrl = `https://{store_domain}/products/${handle}`;

      const { rows: [existing] } = await pool.query(
        'SELECT id FROM products WHERE client_id=$1 AND handle=$2',
        [clientId, handle]
      );

      if (existing && !overwrite) {
        results.skipped++;
        continue;
      }

      if (existing) {
        await pool.query(`
          UPDATE products SET
            title=$1, description=$2, vendor=$3, type=$4, tags=$5,
            image_url=$6, price=$7, price_max=$8, sku=$9,
            inventory=$10, variants=$11, product_url=$12,
            published=$13, updated_at=NOW()
          WHERE id=$14
        `, [product.title, product.description, product.vendor, product.type,
            product.tags, product.image_url, minPrice, maxPrice, primarySku,
            totalStock, JSON.stringify(variants), productUrl,
            product.published, existing.id]);
        results.updated++;
      } else {
        await pool.query(`
          INSERT INTO products (
            client_id, handle, title, description, vendor, type, tags,
            image_url, price, price_max, sku, inventory,
            variants, product_url, published, source, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'csv',NOW(),NOW())
        `, [clientId, handle, product.title, product.description,
            product.vendor, product.type, product.tags,
            product.image_url, minPrice, maxPrice, primarySku,
            totalStock, JSON.stringify(variants), productUrl, product.published]);
        results.imported++;
      }
    } catch (err) {
      results.errors.push({ handle, error: err.message });
    }
  }

  return results;
}

// ── 2. Shopify API Import ─────────────────────────────────
// Uses Shopify REST Admin API with OAuth token
// Requires: shop domain + access token (stored encrypted per client)

export async function importFromShopifyApi({ clientId, shopDomain, accessToken, limit = 250 }) {
  const results = { imported: 0, updated: 0, errors: [] };
  let pageInfo  = null;
  let hasMore   = true;

  while (hasMore) {
    const url = new URL(`https://${shopDomain}/admin/api/2024-01/products.json`);
    url.searchParams.set('limit', limit);
    url.searchParams.set('status', 'active');
    if (pageInfo) url.searchParams.set('page_info', pageInfo);

    const response = await fetch(url.toString(), {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`Shopify API error ${response.status}`);

    const { products } = await response.json();
    if (!products?.length) break;

    for (const p of products) {
      try {
        await upsertShopifyProduct({ clientId, shopDomain, product: p });
        results.imported++;
      } catch (err) {
        results.errors.push({ id: p.id, error: err.message });
      }
    }

    // Check for next page via Link header
    const linkHeader = response.headers.get('Link') || '';
    const nextMatch  = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      pageInfo = nextMatch[1];
    } else {
      hasMore = false;
    }
  }

  return results;
}

async function upsertShopifyProduct({ clientId, shopDomain, product }) {
  const variants   = product.variants || [];
  const images     = product.images   || [];
  const minPrice   = variants.length ? Math.min(...variants.map(v => parseFloat(v.price||0))) : 0;
  const maxPrice   = variants.length ? Math.max(...variants.map(v => parseFloat(v.price||0))) : 0;
  const totalStock = variants.reduce((s,v) => s + (v.inventory_quantity||0), 0);
  const primaryImg = images[0]?.src || product.image?.src || null;
  const productUrl = `https://${shopDomain}/products/${product.handle}`;

  const normalizedVariants = variants.map(v => ({
    id:            v.id,
    sku:           v.sku,
    title:         v.title,
    price:         parseFloat(v.price),
    compare_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
    inventory:     v.inventory_quantity,
    option1:       v.option1,
    option2:       v.option2,
    option3:       v.option3,
    image_id:      v.image_id,
  }));

  const { rows: [existing] } = await pool.query(
    'SELECT id FROM products WHERE client_id=$1 AND shopify_product_id=$2',
    [clientId, product.id.toString()]
  );

  if (existing) {
    await pool.query(`
      UPDATE products SET
        title=$1, description=$2, vendor=$3, type=$4,
        tags=$5, image_url=$6, price=$7, price_max=$8,
        sku=$9, inventory=$10, variants=$11, product_url=$12,
        shopify_product_id=$13, updated_at=NOW()
      WHERE id=$14
    `, [product.title, product.body_html, product.vendor, product.product_type,
        (product.tags||''), primaryImg, minPrice, maxPrice,
        variants[0]?.sku||null, totalStock,
        JSON.stringify(normalizedVariants), productUrl,
        product.id.toString(), existing.id]);
  } else {
    await pool.query(`
      INSERT INTO products (
        client_id, shopify_product_id, handle, title, description,
        vendor, type, tags, image_url, price, price_max, sku,
        inventory, variants, product_url, published, source, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,'shopify_api',NOW(),NOW())
    `, [clientId, product.id.toString(), product.handle,
        product.title, product.body_html,
        product.vendor, product.product_type, (product.tags||''),
        primaryImg, minPrice, maxPrice, variants[0]?.sku||null,
        totalStock, JSON.stringify(normalizedVariants), productUrl]);
  }
}

// ── 3. RSS/XML Feed Import ────────────────────────────────
// Shopify generates a public RSS feed at /collections/all.atom
// or a sitemap at /sitemap.xml with product URLs

export async function importFromFeed({ clientId, feedUrl }) {
  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`Feed fetch error ${response.status}`);

  const xml     = await response.text();
  const entries = parseAtomFeed(xml);
  const results = { imported: 0, errors: [] };

  for (const entry of entries) {
    try {
      await pool.query(`
        INSERT INTO products (
          client_id, handle, title, description, image_url,
          product_url, price, published, source, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,'rss',NOW(),NOW())
        ON CONFLICT (client_id, handle) DO UPDATE SET
          title=$3, description=$4, image_url=$5, updated_at=NOW()
      `, [clientId, entry.handle, entry.title, entry.summary,
          entry.image, entry.url, entry.price || 0]);
      results.imported++;
    } catch (err) {
      results.errors.push({ url: entry.url, error: err.message });
    }
  }

  return results;
}

// ── Token resolver ────────────────────────────────────────
// Replaces {product_*} tokens in email templates with real product data

export function resolveProductTokens(template, product, client, contact) {
  const price = product.price
    ? `$${parseFloat(product.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';

  const comparePrice = product.price_max && product.price_max > product.price
    ? `$${parseFloat(product.price_max).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';

  const productUrl = (product.product_url || '')
    .replace('{store_domain}', client?.shopify_domain || client?.website || '');

  return template
    // Product tokens
    .replace(/\{product_name\}/g,        product.title           || '')
    .replace(/\{product_title\}/g,       product.title           || '')
    .replace(/\{product_description\}/g, stripHtml(product.description || ''))
    .replace(/\{product_price\}/g,       price)
    .replace(/\{product_compare_price\}/g, comparePrice)
    .replace(/\{product_image\}/g,       product.image_url       || '')
    .replace(/\{product_url\}/g,         productUrl)
    .replace(/\{product_sku\}/g,         product.sku             || '')
    .replace(/\{product_vendor\}/g,      product.vendor          || '')
    .replace(/\{product_type\}/g,        product.type            || '')
    .replace(/\{product_tags\}/g,        product.tags            || '')
    // Store tokens
    .replace(/\{store_name\}/g,          client?.name            || '')
    .replace(/\{store_domain\}/g,        client?.shopify_domain  || client?.website || '')
    .replace(/\{store_url\}/g,           client?.website         || '')
    // Contact tokens
    .replace(/\{first_name\}/g,          contact?.first_name     || 'there')
    .replace(/\{last_name\}/g,           contact?.last_name      || '')
    .replace(/\{email\}/g,               contact?.email          || '')
    // Dynamic tokens
    .replace(/\{discount_code\}/g,       client?.discount_code   || '')
    .replace(/\{cart_link\}/g,           `${client?.website || ''}/cart`)
    .replace(/\{shop_all_link\}/g,       `${client?.website || ''}/collections/all`);
}

// ── Helpers ───────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i+1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        row.push(cell); cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseAtomFeed(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/g) || [];
  for (const entry of entryMatches) {
    const title   = (entry.match(/<title[^>]*>(.*?)<\/title>/)     || [])[1] || '';
    const url     = (entry.match(/href="([^"]*\/products\/[^"]*)"/)|| [])[1] || '';
    const image   = (entry.match(/<img[^>]*src="([^"]*)"/)         || [])[1] || '';
    const summary = (entry.match(/<summary[^>]*>(.*?)<\/summary>/s)|| [])[1] || '';
    const handle  = url.split('/products/')[1]?.split('?')[0]       || '';
    if (handle) entries.push({ title, url, image, summary: stripHtml(summary), handle, price: 0 });
  }
  return entries;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
}
