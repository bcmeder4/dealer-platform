import express from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import fs from 'fs';
import pool from '../db/pool.js';
import {
  importDomainsFromCsv,
  getDomainPoolStatus,
  retireDomain,
} from './pool.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/domain-uploads/', limits: { fileSize: 2 * 1024 * 1024 } });

// GET /api/domains?dealer_id=...
router.get('/', async (req, res) => {
  const { dealer_id } = req.query;
  if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
  const domains = await getDomainPoolStatus(dealer_id);
  res.json(domains);
});

// POST /api/domains/import  — CSV upload
router.post('/import', upload.single('file'), async (req, res) => {
  const { dealer_id } = req.body;
  if (!dealer_id || !req.file) return res.status(400).json({ error: 'dealer_id and CSV required' });
  try {
    const csv = fs.readFileSync(req.file.path, 'utf8');
    const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const result = await importDomainsFromCsv(dealer_id, data);
    res.json({ ok: true, ...result });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// POST /api/domains/:id/retire
router.post('/:id/retire', async (req, res) => {
  await retireDomain(req.params.id);
  res.json({ ok: true });
});

// GET /api/domains/pool-status?dealer_id=...
router.get('/pool-status', async (req, res) => {
  const { dealer_id } = req.query;
  const domains = await getDomainPoolStatus(dealer_id);
  const summary = {
    total:      domains.length,
    active:     domains.filter(d => d.status === 'active').length,
    warming:    domains.filter(d => d.status === 'warming').length,
    caution:    domains.filter(d => d.status === 'caution').length,
    restricted: domains.filter(d => d.status === 'restricted').length,
    suspended:  domains.filter(d => d.status === 'suspended').length,
    capacity_today: domains.filter(d => !['suspended','retired'].includes(d.status))
      .reduce((s, d) => s + (d.daily_limit - d.sends_today), 0),
  };
  res.json({ summary, domains });
});

export default router;
