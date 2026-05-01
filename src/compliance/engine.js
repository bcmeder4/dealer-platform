import { FORD } from './brands/ford.js';

const BRAND_REGISTRY = {
  ford: FORD,
  // Add more brands here as you onboard them:
  // toyota: TOYOTA,
  // chevrolet: CHEVROLET,
  // honda: HONDA,
  // bmw: BMW,
};

export function runComplianceCheck(brand, html, data = {}) {
  const spec = BRAND_REGISTRY[brand?.toLowerCase()];
  if (!spec) {
    return { passed: true, blocked: false, score: 100, results: [], brand, warning: `No spec for "${brand}"` };
  }

  const results = spec.rules.map(rule => {
    const passed = (() => { try { return rule.check(html, spec, data); } catch { return false; } })();
    return { id: rule.id, label: rule.label, severity: rule.severity, passed };
  });

  const blocked = results.some(r => !r.passed && r.severity === 'block');
  const score   = Math.round(results.filter(r => r.passed).length / results.length * 100);
  return { passed: !blocked, blocked, score, results, brand: spec.displayName };
}

export function getDisclaimer(brand) {
  const spec = BRAND_REGISTRY[brand?.toLowerCase()];
  return spec?.disclaimer?.text || '';
}

export function getBrandSpec(brand) {
  return BRAND_REGISTRY[brand?.toLowerCase()] || null;
}
