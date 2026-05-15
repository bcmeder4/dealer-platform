// ============================================================
// src/ecommerce/adCreativeGenerator.js
// AI-powered ad creative generator
//
// Takes product data and generates complete ad creative for:
//   - TikTok (video script + captions + hashtags)
//   - Instagram (Reels script, feed post, Stories)
//   - Facebook / Meta (carousel, single image, video)
//   - Google Shopping (title, description, structured data)
//   - Email (subject, preview, HTML body)
//
// Uses Claude API to write copy tailored to each platform's
// format, audience, and best practices
// ============================================================

import pool from '../db/pool.js';

// ── Platform configs ──────────────────────────────────────
const PLATFORMS = {
  tiktok: {
    name:        'TikTok',
    formats:     ['video_script', 'caption', 'hashtags'],
    char_limits: { caption: 2200, hashtags: 30 },
    tone:        'energetic, authentic, trend-aware, Gen Z friendly',
    cta_options: ['Shop now', 'Link in bio', 'Check it out', 'Get yours'],
    notes:       'Hook in first 3 seconds. Use trending sounds. Authentic over polished. UGC style works best.',
  },
  instagram: {
    name:        'Instagram',
    formats:     ['reels_script', 'feed_caption', 'stories_text', 'hashtags'],
    char_limits: { feed_caption: 2200, stories_text: 100, hashtags: 30 },
    tone:        'aspirational, visual-forward, lifestyle-focused',
    cta_options: ['Shop now', 'Link in bio', 'Swipe up', 'DM us'],
    notes:       'Lead with lifestyle benefit. Strong visual hook. Mix product and lifestyle content.',
  },
  facebook: {
    name:        'Facebook / Meta',
    formats:     ['primary_text', 'headline', 'description', 'carousel_cards'],
    char_limits: { primary_text: 125, headline: 40, description: 30 },
    tone:        'benefit-focused, social proof heavy, value-driven',
    cta_options: ['Shop Now', 'Learn More', 'Get Offer', 'Buy Now'],
    notes:       'Lead with benefit or social proof. Price anchoring works well. Carousel shows multiple products/angles.',
  },
  google_shopping: {
    name:        'Google Shopping',
    formats:     ['title', 'description', 'structured_data'],
    char_limits: { title: 150, description: 5000 },
    tone:        'factual, keyword-rich, feature-forward',
    cta_options: [],
    notes:       'Include brand, product type, key attributes in title. Keywords matter more than copy style.',
  },
  google_display: {
    name:        'Google Display',
    formats:     ['headline', 'long_headline', 'description', 'business_name'],
    char_limits: { headline: 30, long_headline: 90, description: 90 },
    tone:        'clear, benefit-focused, action-oriented',
    cta_options: ['Shop Now', 'Buy Now', 'Learn More', 'Get Deal'],
    notes:       'Responsive display ads — write multiple headlines and descriptions. Google mixes them.',
  },
  email: {
    name:        'Email',
    formats:     ['subject_line', 'preview_text', 'body_html', 'cta_text'],
    char_limits: { subject_line: 50, preview_text: 90 },
    tone:        'personalized, conversational, benefit-led',
    cta_options: ['Shop Now', 'View Product', 'Get Yours', 'Claim Offer'],
    notes:       'Subject line is everything. Personalize with {first_name}. One primary CTA. Mobile-first.',
  },
  sms: {
    name:        'SMS',
    formats:     ['message'],
    char_limits: { message: 160 },
    tone:        'ultra-brief, urgent, clear value',
    cta_options: ['Shop:', 'Get it:'],
    notes:       'Under 160 chars. Include opt-out. Link shortener recommended.',
  },
};

// ── Main generator ────────────────────────────────────────
export async function generateAdCreative({
  productId,
  product,        // pass directly or load by productId
  clientId,
  platforms,      // array of platform keys e.g. ['tiktok','instagram','email']
  campaign,       // campaign context: goal, offer, audience, tone override
  count = 3,      // number of variants per platform
}) {
  // Load product if not passed directly
  if (!product && productId) {
    const { rows: [p] } = await pool.query(
      'SELECT * FROM products WHERE id=$1', [productId]
    );
    product = p;
  }

  if (!product) throw new Error('Product not found');

  // Load client context
  let client = null;
  if (clientId) {
    const { rows: [c] } = await pool.query(
      'SELECT name, website, vertical FROM dealers WHERE id=$1', [clientId]
    );
    client = c;
  }

  const results = {};

  // Generate for each platform in parallel
  await Promise.all(
    (platforms || Object.keys(PLATFORMS)).map(async (platformKey) => {
      const platformConfig = PLATFORMS[platformKey];
      if (!platformConfig) return;

      try {
        const creative = await generateForPlatform({
          product, client, platformKey, platformConfig, campaign, count,
        });
        results[platformKey] = creative;
      } catch (err) {
        results[platformKey] = { error: err.message };
      }
    })
  );

  // Store generated creatives
  if (productId || product?.id) {
    await pool.query(`
      INSERT INTO ad_creatives
        (product_id, client_id, platforms, creative_json, campaign_context, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
    `, [
      product.id || productId,
      clientId,
      JSON.stringify(platforms || Object.keys(PLATFORMS)),
      JSON.stringify(results),
      JSON.stringify(campaign || {}),
    ]).catch(() => {});
  }

  return results;
}

// ── Generate for a single platform ───────────────────────
async function generateForPlatform({ product, client, platformKey, platformConfig, campaign, count }) {
  const price = product.price
    ? `$${parseFloat(product.price).toFixed(2)}`
    : 'price not set';

  const comparePrice = product.price_max && product.price_max > product.price
    ? `(regular price $${parseFloat(product.price_max).toFixed(2)})`
    : '';

  const systemPrompt = `You are an expert performance marketing copywriter specializing in ${platformConfig.name} ads.

Platform: ${platformConfig.name}
Tone: ${platformConfig.tone}
Character limits: ${JSON.stringify(platformConfig.char_limits)}
Best practices: ${platformConfig.notes}

Return ONLY valid JSON — no markdown, no preamble.`;

  const userPrompt = `Generate ${count} ad creative variants for this product on ${platformConfig.name}.

PRODUCT:
- Name: ${product.title}
- Description: ${stripHtml(product.description || '').slice(0, 300)}
- Price: ${price} ${comparePrice}
- Vendor/Brand: ${product.vendor || 'unknown'}
- Type: ${product.type || 'product'}
- Tags: ${product.tags || ''}
- Product URL: ${product.product_url || '{product_url}'}
- Image: ${product.image_url ? 'Available' : 'Not available'}

STORE: ${client?.name || 'the store'}
WEBSITE: ${client?.website || '{store_url}'}

CAMPAIGN CONTEXT:
${campaign ? JSON.stringify(campaign, null, 2) : 'Standard product promotion'}

REQUIRED OUTPUT FORMAT:
{
  "platform": "${platformKey}",
  "product_id": "${product.id || ''}",
  "variants": [
    {
      "variant_number": 1,
      "angle": "benefit | social_proof | urgency | curiosity | lifestyle | price | feature",
      "angle_notes": "why this angle",
      ${platformConfig.formats.map(f => `"${f}": "content here"`).join(',\n      ')}${platformKey === 'tiktok' || platformKey === 'instagram' ? `,
      "hashtags": ["#tag1", "#tag2"],
      "suggested_music_vibe": "upbeat pop / chill lo-fi / trending audio"` : ''}${platformKey === 'tiktok' || platformKey === 'instagram' || platformKey === 'facebook' ? `,
      "visual_direction": "brief description of what the video/image should show"` : ''}${platformKey === 'facebook' ? `,
      "carousel_cards": [
        {"headline": "card 1 headline", "description": "card 1 desc", "image_note": "what image to use"}
      ]` : ''}
    }
  ],
  "ab_test_recommendation": "which variant to test first and why"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  const data  = await response.json();
  const text  = data.content?.[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return { raw: text, error: 'JSON parse failed' };
  }
}

// ── Generate full campaign package ───────────────────────
// One call generates ad creative for ALL platforms at once
export async function generateFullCampaignPackage({
  productIds,
  clientId,
  campaign,
  platforms = ['tiktok', 'instagram', 'facebook', 'google_shopping', 'email'],
}) {
  const results = [];

  for (const productId of productIds) {
    const creative = await generateAdCreative({
      productId,
      clientId,
      platforms,
      campaign,
      count: 3,
    });
    results.push({ productId, creative });
  }

  return results;
}

// ── Get platform list ─────────────────────────────────────
export function getAvailablePlatforms() {
  return Object.entries(PLATFORMS).map(([key, p]) => ({
    key,
    name:        p.name,
    formats:     p.formats,
    char_limits: p.char_limits,
    cta_options: p.cta_options,
  }));
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
