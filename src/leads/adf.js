// ============================================================
// src/leads/adf.js  — Enhanced ADF/XML Lead Formatter
// Maximum data density for highest CRM match rates
//
// ADF spec: https://www.adfxml.com/
// Supported by: DealerSocket, VinSolutions, CDK, Reynolds,
//               DealerTrack, Elead, DriveCentric, all major CRMs
//
// MINIMUM required per our standard:
//   - VIN (vehicle identifier)
//   - Email address OR phone number
//   - First + last name
// Everything else is additive for better CRM matching
// ============================================================

import pool from '../db/pool.js';
import fetch from 'node-fetch';

export function buildAdfXml({ contact, vehicle, dealer, send, source, comments, replyId, classification }) {
  const now         = new Date();
  const requestDate = now.toISOString().slice(0, 10);

  // ── Contact ─────────────────────────────────────────────
  const firstName = escapeXml(contact.first_name || '');
  const lastName  = escapeXml(contact.last_name  || '');
  const email     = escapeXml(contact.email      || '');
  const zip       = escapeXml(contact.zip        || '');
  const city      = escapeXml(contact.city       || '');
  const state     = escapeXml(contact.state      || '');

  const rawPhone       = (contact.phone || '').replace(/\D/g, '');
  const phone10        = rawPhone.length >= 10 ? rawPhone.slice(-10) : '';
  const phoneFormatted = phone10 ? `${phone10.slice(0,3)}-${phone10.slice(3,6)}-${phone10.slice(6)}` : '';

  // ── Vehicle ─────────────────────────────────────────────
  const vin       = escapeXml(vehicle?.vin       || '');
  const year      = vehicle?.year                || '';
  const make      = escapeXml(vehicle?.make      || '');
  const model     = escapeXml(vehicle?.model     || '');
  const trim      = escapeXml(vehicle?.trim      || '');
  const color     = escapeXml(vehicle?.color     || '');
  const miles     = vehicle?.miles               || 0;
  const price     = vehicle?.price               || 0;
  const stock     = escapeXml(vehicle?.stock_num || '');
  const vdpUrl    = escapeXml(vehicle?.vdp_url   || '');
  const condition = vehicle?.status === 'new' ? 'new' : vehicle?.status === 'cpo' ? 'certified' : 'used';

  // ── Comments ─────────────────────────────────────────────
  const fullComments = escapeXml([
    comments ? `Customer message: ${comments.slice(0, 1000)}` : '',
    classification ? `Lead intent: ${classification.replace(/_/g,' ')}` : '',
    send?.subject ? `Email subject: ${send.subject}` : '',
    replyId ? `Platform ref: ${replyId}` : '',
  ].filter(Boolean).join('\n'));

  // ── Trade-in (from contact's prior purchase data) ────────
  const tradeIn = (contact.last_purchase_year && contact.last_purchase_make) ? `
    <trade>
      <vehicle>
        <year>${contact.last_purchase_year}</year>
        <make>${escapeXml(contact.last_purchase_make)}</make>
        <model>${escapeXml(contact.last_purchase_model || '')}</model>
        <mileage>${contact.last_purchase_miles || ''}</mileage>
        <condition>unknown</condition>
      </vehicle>
    </trade>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect>
    <requestdate>${requestDate}</requestdate>

    <vehicle interest="buy" status="${condition}">
      <year>${year}</year>
      <make>${make}</make>
      <model>${model}</model>
      <trim>${trim}</trim>
      <vin>${vin}</vin>
      <stock>${stock}</stock>
      <odometer status="original" units="mi">${miles}</odometer>
      <color><exterior>${color}</exterior></color>
      <price type="quote" currency="USD">${price}</price>
      <url>${vdpUrl}</url>
    </vehicle>

    <customer>
      <contact primarycontact="1">
        <name part="first">${firstName}</name>
        <name part="last">${lastName}</name>
        <email preferredcontact="1">${email}</email>
        ${phoneFormatted ? `<phone time="day" type="voice" preferredcontact="0">${phoneFormatted}</phone>` : ''}
        <address>
          <city>${city}</city>
          <regioncode>${state}</regioncode>
          <postalcode>${zip}</postalcode>
          <country>US</country>
        </address>
      </contact>
    </customer>

    ${tradeIn}

    <vendor>
      <vendorname>${escapeXml(dealer.name || '')}</vendorname>
      <url>${escapeXml(dealer.website_url || '')}</url>
      <contact primarycontact="1">
        <name part="full">${escapeXml(dealer.name || '')}</name>
        <email>${escapeXml(dealer.leads_email || dealer.from_email || '')}</email>
        ${dealer.phone ? `<phone>${escapeXml(dealer.phone)}</phone>` : ''}
        <address>
          <street line="1">${escapeXml(dealer.address || '')}</street>
          <city>${escapeXml(dealer.city || '')}</city>
          <regioncode>${escapeXml(dealer.state || '')}</regioncode>
          <postalcode>${escapeXml(dealer.zip || '')}</postalcode>
          <country>US</country>
        </address>
      </contact>
    </vendor>

    <provider>
      <name part="full">Cars Dealer Platform</name>
      <service>${escapeXml(source || 'Email Campaign')}</service>
      <url>https://app.cars-dealer.com</url>
    </provider>

    <leadtype>used</leadtype>
    <comments>${fullComments}</comments>

  </prospect>
</adf>`;
}

export function buildLeadSummaryText({ contact, vehicle, dealer, comments, classification, send }) {
  const phone = (contact.phone || '').replace(/\D/g, '').slice(-10);
  const phoneFormatted = phone.length === 10
    ? `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}`
    : contact.phone || 'Not provided';

  return [
    `NEW LEAD — ${(classification || 'INQUIRY').toUpperCase().replace(/_/g,' ')}`,
    '='.repeat(60),
    '',
    '▶ CONTACT',
    `   Name:    ${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
    `   Email:   ${contact.email || 'Not provided'}`,
    `   Phone:   ${phoneFormatted}`,
    contact.zip   ? `   ZIP:     ${contact.zip}`              : null,
    contact.city  ? `   City:    ${contact.city}, ${contact.state || ''}` : null,
    '',
    vehicle ? '▶ VEHICLE OF INTEREST' : null,
    vehicle ? `   ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}`.trim() : null,
    vehicle?.vin       ? `   VIN:     ${vehicle.vin}`       : null,
    vehicle?.stock_num ? `   Stock#:  ${vehicle.stock_num}` : null,
    vehicle?.color     ? `   Color:   ${vehicle.color}`     : null,
    vehicle?.miles > 0 ? `   Miles:   ${vehicle.miles.toLocaleString()}` : null,
    vehicle?.price     ? `   Price:   $${Number(vehicle.price).toLocaleString()} MSRP` : null,
    vehicle?.vdp_url   ? `   VDP:     ${vehicle.vdp_url}`   : null,
    '',
    comments ? '▶ CUSTOMER MESSAGE' : null,
    comments ? `   "${comments}"` : null,
    '',
    contact.last_purchase_year ? '▶ PRIOR VEHICLE (potential trade)' : null,
    contact.last_purchase_year ? `   ${contact.last_purchase_year} ${contact.last_purchase_make || ''} ${contact.last_purchase_model || ''}`.trim() : null,
    contact.last_purchase_miles ? `   ${Number(contact.last_purchase_miles).toLocaleString()} miles` : null,
    '',
    '='.repeat(60),
    `Dealer:   ${dealer.name}`,
    `Source:   Email Campaign — Cars Dealer Platform`,
    `Time:     ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`,
    send?.id ? `Ref:      ${send.id}` : null,
    '',
    'ADF/XML attached for direct CRM import.',
    'Compatible with DealerSocket, VinSolutions, CDK, Reynolds & Reynolds, DealerTrack, Elead.',
  ].filter(l => l !== null).join('\n');
}

export async function forwardLeadAsAdf({ replyId, contactId, vehicleId, dealerId, sendId, comments, classification }) {
  const [contactRes, vehicleRes, dealerRes, sendRes] = await Promise.all([
    pool.query('SELECT * FROM contacts WHERE id=$1', [contactId]),
    vehicleId ? pool.query('SELECT * FROM vehicles WHERE id=$1', [vehicleId]) : Promise.resolve({ rows: [null] }),
    pool.query('SELECT * FROM dealers WHERE id=$1', [dealerId]),
    sendId    ? pool.query('SELECT * FROM sends WHERE id=$1', [sendId])       : Promise.resolve({ rows: [null] }),
  ]);

  const contact = contactRes.rows[0];
  const vehicle = vehicleRes.rows[0];
  const dealer  = dealerRes.rows[0];
  const send    = sendRes.rows[0];

  if (!contact || !dealer) throw new Error('Contact or dealer not found');
  if (!contact.email && !contact.phone) return { skipped: true, reason: 'No contact info' };
  if (!dealer.leads_email) return { skipped: true, reason: 'No leads_email on dealer record' };

  const adfXml = buildAdfXml({ contact, vehicle, dealer, send, source: 'Email Campaign', comments, replyId, classification });
  const summaryText = buildLeadSummaryText({ contact, vehicle, dealer, comments, classification, send });

  const vehicleStr = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Vehicle Inquiry';
  const subject = `🚗 Lead: ${contact.first_name || ''} ${contact.last_name || ''} — ${vehicleStr} [${(classification || 'inquiry').replace(/_/g,' ')}]`;

  const response = await fetch(`${process.env.POSTAL_URL}/api/v1/send/message`, {
    method: 'POST',
    headers: { 'X-Server-API-Key': process.env.POSTAL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to:         [dealer.leads_email],
      from:       'leads@cars-dealer.com',
      reply_to:   contact.email || undefined,
      subject,
      plain_body: summaryText,
      attachments: [{
        name:         `adf-${(contact.last_name || 'lead').toLowerCase()}-${Date.now()}.xml`,
        content_type: 'application/xml',
        data:         Buffer.from(adfXml).toString('base64'),
      }],
    }),
  });

  const result = await response.json();
  if (result.status !== 'success') throw new Error(`Postal ADF error: ${JSON.stringify(result)}`);

  const postalMsgId = result.data?.messages?.[dealer.leads_email]?.id?.toString() || null;

  await pool.query(`
    INSERT INTO lead_forwards (reply_id, contact_id, vehicle_id, dealer_id, adf_xml, sent_to, postal_msg_id, classification, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
  `, [replyId, contactId, vehicleId, dealerId, adfXml, dealer.leads_email, postalMsgId, classification]).catch(() => {});

  console.log(`✓ ADF lead → ${dealer.leads_email} | ${contact.first_name} ${contact.last_name} | ${vehicleStr} | VIN: ${vehicle?.vin || 'n/a'}`);
  return { ok: true, sentTo: dealer.leads_email, postalMsgId };
}

export async function autoForwardLead({ replyId, contactId, vehicleId, dealerId, sendId, body, classification }) {
  if (!['appointment', 'interested', 'price_inquiry'].includes(classification)) return null;
  try {
    return await forwardLeadAsAdf({ replyId, contactId, vehicleId, dealerId, sendId, comments: body, classification });
  } catch (err) {
    console.error('Auto ADF error:', err.message);
    return { ok: false, error: err.message };
  }
}

function escapeXml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
