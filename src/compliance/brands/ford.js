export const FORD = {
  id:          'ford',
  displayName: 'Ford',
  program:     'Ford Dealer Advertising Fund (FDAF)',
  reimbursement: { rate: 0.50, cap: 500, unit: 'per_campaign' },

  fonts: {
    heading:    { family: 'FordAntenna, Arial, sans-serif', size: '22px', weight: '700', color: '#003476' },
    body:       { family: 'FordAntenna, Arial, sans-serif', size: '15px', weight: '400', color: '#1a1a1a' },
    cta:        { family: 'FordAntenna, Arial, sans-serif', size: '14px', weight: '700', color: '#ffffff' },
    price:      { family: 'FordAntenna, Arial, sans-serif', size: '20px', weight: '700', color: '#003476' },
    disclaimer: { family: 'Arial, sans-serif',              size: '10px', weight: '400', color: '#666666' },
  },

  colors: {
    fordBlue:  '#003476',
    fordBlueAlt:'#1769FF',
    white:     '#FFFFFF',
    lightGray: '#F4F4F4',
    ctaBg:     '#003476',
  },

  layout: {
    maxWidth:       '600px',
    headerBg:       '#003476',
    footerBg:       '#F4F4F4',
    contentPadding: '24px',
  },

  disclaimer: {
    text:    "MSRP is Manufacturer's Suggested Retail Price. Excludes taxes, title, license, destination charge, and dealer fees. Actual dealer price may vary. See dealer for complete details. Ford Motor Company.",
    minSize: '10px',
    token:   '{oem_disclaimer}',
  },

  rules: [
    {
      id: 'logo_present',
      label: 'Ford oval logo in header',
      severity: 'block',
      check:  (html) => html.includes('ford-logo') || html.includes('ford_oval'),
    },
    {
      id: 'font_family',
      label: 'FordAntenna or Arial font stack',
      severity: 'block',
      check:  (html) => /FordAntenna|Arial/.test(html),
    },
    {
      id: 'brand_color',
      label: 'Ford Blue (#003476) on headlines',
      severity: 'block',
      check:  (html) => html.includes('#003476'),
    },
    {
      id: 'msrp_label',
      label: 'MSRP label with vehicle price',
      severity: 'block',
      check:  (html) => /MSRP/i.test(html),
    },
    {
      id: 'disclaimer_present',
      label: 'FDAF standard disclaimer in footer',
      severity: 'block',
      check:  (html) => html.includes("Manufacturer's Suggested Retail Price"),
    },
    {
      id: 'cta_present',
      label: 'Call-to-action button links to VDP',
      severity: 'block',
      check:  (html) => html.includes('cta-btn') || html.includes('View'),
    },
    {
      id: 'dealer_address',
      label: 'Dealer address in footer',
      severity: 'block',
      check:  (html, _, data) => !data?.dealer?.address || html.includes(data.dealer.address),
    },
    {
      id: 'no_banned_phrases',
      label: 'No prohibited pricing language',
      severity: 'block',
      check:  (html) => !['below invoice','below MSRP','best price guaranteed','lowest price','beat any deal']
        .some(p => html.toLowerCase().includes(p)),
    },
    {
      id: 'unsubscribe',
      label: 'CAN-SPAM unsubscribe link',
      severity: 'block',
      check:  (html) => html.includes('/unsubscribe') || html.includes('Unsubscribe'),
    },
    {
      id: 'email_width',
      label: 'Email max-width 600px',
      severity: 'warn',
      check:  (html) => html.includes('600px') || html.includes('max-width:600'),
    },
  ],
};
