export function spin(text) {
  return text.replace(/\{([^}|]+(?:\|[^}|]+)+)\}/g, (match, inner) => {
    const options = inner.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

export function resolveTokens(template, { contact, vehicle, campaign, dealer, vdpHref, unsubUrl }) {
  const price = vehicle?.price
    ? new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(vehicle.price)
    : '';
  const tokens = {
    first_name:   contact?.first_name  || 'there',
    last_name:    contact?.last_name   || '',
    email:        contact?.email       || '',
    year:         vehicle?.year        || '',
    make:         vehicle?.make        || '',
    model:        vehicle?.model       || '',
    trim:         vehicle?.trim        || '',
    price,
    vin:          vehicle?.vin         || '',
    miles:        vehicle?.miles?.toLocaleString() || '',
    color:        vehicle?.color       || '',
    vdp_href:     vdpHref              || '#',
    unsub_url:    unsubUrl             || '#',
    sender_name:  campaign?.from_name  || dealer?.from_name || '',
    dealer_name:  dealer?.name         || '',
    phone:        dealer?.phone        || '',
    oem_disclaimer: "MSRP is Manufacturer's Suggested Retail Price. Excludes taxes, title, license, destination charge, and dealer fees. Actual dealer price may vary. See dealer for complete details. Ford Motor Company.",
  };
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    tokens[key] !== undefined ? tokens[key] : match
  );
}

export function renderEmail({ subjectTemplate, bodyTemplate, contact, vehicle, campaign, dealer, vdpHref, unsubUrl }) {
  const subject = resolveTokens(spin(subjectTemplate), { contact, vehicle, campaign, dealer, vdpHref, unsubUrl });
  const bodyText = resolveTokens(spin(bodyTemplate),   { contact, vehicle, campaign, dealer, vdpHref, unsubUrl });
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#222;max-width:600px;margin:0 auto;padding:20px">
${bodyText.split('\n').map(line => line.trim() === '' ? '<br>' : `<p style="margin:0 0 8px">${line}</p>`).join('\n')}
<p style="margin:20px 0 0;font-size:10px;color:#888;line-height:1.5">
  MSRP is Manufacturer's Suggested Retail Price. Excludes taxes, title, license, destination charge, and dealer fees. Actual dealer price may vary. See dealer for complete details. Ford Motor Company.
</p>
<p style="margin:8px 0 0;font-size:10px;color:#888">
  ${dealer?.name || ''} &nbsp;·&nbsp; ${dealer?.address || ''}<br>
  <a href="${unsubUrl || '#'}" style="color:#888">Unsubscribe</a>
</p>
</body></html>`;
  return { subject, html };
}
