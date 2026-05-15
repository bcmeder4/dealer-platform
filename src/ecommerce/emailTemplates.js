// ============================================================
// src/ecommerce/emailTemplates.js
// E-commerce email templates with product tokens
//
// Templates:
//   - product_spotlight  : single product feature email
//   - abandoned_cart     : cart recovery email
//   - new_arrivals       : multiple new products
//   - flash_sale         : limited time offer
//   - back_in_stock      : restock notification
//   - post_purchase      : upsell after purchase
//   - browse_abandonment : viewed but didn't buy
// ============================================================

// ── Template registry ─────────────────────────────────────
import { resolveProductTokens } from './shopifyImporter.js';
export const EMAIL_TEMPLATES = {

  product_spotlight: {
    name:        'Product spotlight',
    description: 'Single product feature with image and CTA',
    best_for:    'New products, hero items, featured launches',
    subject:     '{first_name}, meet your new favorite {product_type}',
    preview:     '{product_name} — now available at {store_name}',
    html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{product_name}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:20px 10px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:580px">

  <!-- Header -->
  <tr><td style="background:#000;padding:16px 24px;text-align:center">
    <span style="color:#fff;font-size:18px;font-weight:600;letter-spacing:-0.02em">{store_name}</span>
  </td></tr>

  <!-- Product image -->
  <tr><td style="padding:0">
    <a href="{product_url}">
      <img src="{product_image}" alt="{product_name}"
           style="width:100%;max-width:580px;height:auto;display:block;object-fit:cover;max-height:400px">
    </a>
  </td></tr>

  <!-- Product info -->
  <tr><td style="padding:28px 32px 8px">
    <p style="margin:0 0 8px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.08em">{product_vendor}</p>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#111;line-height:1.2">{product_name}</h1>
    <p style="margin:0 0 16px;font-size:16px;color:#111">
      <strong style="font-size:22px">{product_price}</strong>
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6">{product_description}</p>
    <a href="{product_url}"
       style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;letter-spacing:-0.01em">
      Shop now →
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 32px;border-top:1px solid #eee;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">
      You received this because you subscribed to {store_name}.<br>
      <a href="{unsubscribe_link}" style="color:#aaa">Unsubscribe</a> · <a href="{store_url}" style="color:#aaa">Visit store</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
  },

  abandoned_cart: {
    name:        'Abandoned cart recovery',
    description: 'Remind customers of items left in their cart',
    best_for:    'Cart abandonment automation',
    subject:     '{first_name}, you left something behind',
    preview:     'Your {product_name} is waiting — complete your purchase',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:20px 10px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:580px">

  <tr><td style="background:#000;padding:16px 24px;text-align:center">
    <span style="color:#fff;font-size:18px;font-weight:600">{store_name}</span>
  </td></tr>

  <tr><td style="padding:32px 32px 8px;text-align:center">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">You left something behind, {first_name}</h1>
    <p style="margin:0;font-size:15px;color:#666">Your cart is saved and ready when you are.</p>
  </td></tr>

  <tr><td style="padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden">
      <tr>
        <td width="100" style="padding:12px">
          <img src="{product_image}" alt="{product_name}"
               style="width:76px;height:76px;object-fit:cover;border-radius:6px;display:block">
        </td>
        <td style="padding:12px">
          <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">{product_name}</p>
          <p style="margin:0 0 4px;font-size:12px;color:#888">{product_vendor}</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#111">{product_price}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:8px 32px 32px;text-align:center">
    <a href="{cart_link}"
       style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:15px;font-weight:600;margin-bottom:12px">
      Complete my order →
    </a>
    <p style="margin:8px 0 0;font-size:13px;color:#888">
      Or <a href="{product_url}" style="color:#888">keep browsing</a>
    </p>
  </td></tr>

  <tr><td style="padding:20px 32px;border-top:1px solid #eee;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">
      <a href="{unsubscribe_link}" style="color:#aaa">Unsubscribe</a> · {store_name}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
  },

  flash_sale: {
    name:        'Flash sale / limited offer',
    description: 'Urgency-driven sale announcement',
    best_for:    'Sales, promos, clearance',
    subject:     '{first_name} — {product_name} {product_price} (ends soon)',
    preview:     'Limited time offer — don\'t miss out',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:20px 10px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:580px">

  <tr><td style="background:#e63946;padding:12px 24px;text-align:center">
    <span style="color:#fff;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Limited time offer</span>
  </td></tr>

  <tr><td style="background:#000;padding:16px 24px;text-align:center">
    <span style="color:#fff;font-size:18px;font-weight:600">{store_name}</span>
  </td></tr>

  <tr><td style="padding:0">
    <a href="{product_url}">
      <img src="{product_image}" alt="{product_name}"
           style="width:100%;max-width:580px;height:auto;display:block;object-fit:cover;max-height:360px">
    </a>
  </td></tr>

  <tr><td style="padding:28px 32px;text-align:center">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">{product_name}</h1>
    <p style="margin:0 0 20px">
      <span style="font-size:28px;font-weight:800;color:#e63946">{product_price}</span>
      <span style="font-size:16px;color:#aaa;text-decoration:line-through;margin-left:8px">{product_compare_price}</span>
    </p>
    <a href="{product_url}"
       style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:700">
      Grab it now →
    </a>
    <p style="margin:16px 0 0;font-size:13px;color:#888">Use code: <strong>{discount_code}</strong></p>
  </td></tr>

  <tr><td style="padding:20px 32px;border-top:1px solid #eee;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">
      <a href="{unsubscribe_link}" style="color:#aaa">Unsubscribe</a> · {store_name}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
  },

  back_in_stock: {
    name:        'Back in stock',
    description: 'Notify contacts a product is available again',
    best_for:    'Restock alerts, waitlist fulfillment',
    subject:     'Good news, {first_name} — {product_name} is back',
    preview:     'It\'s back and it won\'t last long',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:20px 10px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:580px">

  <tr><td style="background:#000;padding:16px 24px;text-align:center">
    <span style="color:#fff;font-size:18px;font-weight:600">{store_name}</span>
  </td></tr>

  <tr><td style="padding:32px 32px 16px;text-align:center">
    <div style="display:inline-block;background:#d4f1e0;color:#1a7a42;font-size:12px;font-weight:600;padding:5px 14px;border-radius:20px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px">Back in stock</div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Great news, {first_name}!</h1>
    <p style="margin:0;font-size:15px;color:#555">{product_name} is available again — but it won't last long.</p>
  </td></tr>

  <tr><td style="padding:0 32px 24px">
    <a href="{product_url}">
      <img src="{product_image}" alt="{product_name}"
           style="width:100%;height:auto;display:block;border-radius:8px;object-fit:cover;max-height:300px">
    </a>
  </td></tr>

  <tr><td style="padding:0 32px 32px;text-align:center">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111">{product_price}</p>
    <a href="{product_url}"
       style="display:inline-block;background:#1a7a42;color:#fff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:15px;font-weight:600">
      Shop now before it sells out →
    </a>
  </td></tr>

  <tr><td style="padding:20px 32px;border-top:1px solid #eee;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">
      <a href="{unsubscribe_link}" style="color:#aaa">Unsubscribe</a> · {store_name}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
  },
};

// ── Get all templates ─────────────────────────────────────
export function getTemplates() {
  return Object.entries(EMAIL_TEMPLATES).map(([key, t]) => ({
    key,
    name:        t.name,
    description: t.description,
    best_for:    t.best_for,
    subject:     t.subject,
    preview:     t.preview,
  }));
}

// ── Render template with product/contact data ─────────────
export function renderTemplate(templateKey, { product, client, contact, discountCode }) {
  const template = EMAIL_TEMPLATES[templateKey];
  if (!template) throw new Error(`Template "${templateKey}" not found`);

  
  let html = template.html;
  let subject = template.subject;
  let preview = template.preview;

  // Inject discount code into client context
  const clientWithDiscount = { ...client, discount_code: discountCode || '' };

  html    = resolveProductTokens(html,    product, clientWithDiscount, contact);
  subject = resolveProductTokens(subject, product, clientWithDiscount, contact);
  preview = resolveProductTokens(preview, product, clientWithDiscount, contact);

  return { html, subject, preview };
}
