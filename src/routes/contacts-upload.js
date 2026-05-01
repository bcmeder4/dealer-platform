import express from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import fs from 'fs';
import crypto from 'crypto';
import pool from '../db/pool.js';

const router  = express.Router();
const upload  = multer({
  dest: '/tmp/dealer-uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/csv|text\/plain|text\/tab-separated/.test(file.mimetype) ||
        /\.(csv|tsv|txt)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only CSV files are accepted'));
  },
});

const VALID_STATUSES = new Set(['conquest','existing','service','inactive']);

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function parseRow(raw, mapping, defaultStatus) {
  const rec = {};
  Object.entries(mapping).forEach(([csvCol, schemaKey]) => {
    if (schemaKey && schemaKey !== '__skip') {
      rec[schemaKey] = (raw[csvCol] || '').toString().trim();
    }
  });
  const errors = [];
  if (!rec.email)              errors.push('missing_email');
  else if (!validateEmail(rec.email)) errors.push('invalid_email');
  else rec.email = rec.email.toLowerCase();

  if (!rec.status || !VALID_STATUSES.has(rec.status.toLowerCase())) {
    rec.status = defaultStatus;
  } else {
    rec.status = rec.status.toLowerCase();
  }

  if (rec.zip && !/^\d{5}(-\d{4})?$/.test(rec.zip)) {
    errors.push('invalid_zip'); delete rec.zip;
  }
  if (rec.phone) {
    const digits = rec.phone.replace(/\D/g,'');
    if      (digits.length === 10) rec.phone = `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    else if (digits.length === 11 && digits[0]==='1') rec.phone = `${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
    else { errors.push('invalid_phone'); delete rec.phone; }
  }
  if (rec.last_purchase_year) {
    const yr = parseInt(rec.last_purchase_year, 10);
    if (isNaN(yr) || yr < 1990 || yr > new Date().getFullYear()) {
      errors.push('invalid_year'); delete rec.last_purchase_year;
    } else {
      rec.last_purchase_year = yr;
    }
  }
  rec.tags = rec.tags ? rec.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  return { rec, errors };
}

// POST /api/contacts/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    const { dealer_id, mapping: mappingRaw, default_status = 'conquest' } = req.body;
    if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
    if (!req.file)  return res.status(400).json({ error: 'No file uploaded' });

    const mapping = JSON.parse(mappingRaw || '{}');
    const csv     = fs.readFileSync(filePath, 'utf8');
    const { data: rawRows } = Papa.parse(csv, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim(),
    });

    if (!rawRows.length) return res.status(400).json({ error: 'CSV file is empty' });

    const parsed   = rawRows.map((raw, i) => {
      const { rec, errors } = parseRow(raw, mapping, default_status);
      return { rowNum: i+1, rec, errors };
    });

    const valid    = parsed.filter(p => p.errors.length === 0);
    const invalid  = parsed.filter(p => p.errors.length > 0);

    // Deduplicate within file
    const deduped  = new Map();
    valid.forEach(p => deduped.set(p.rec.email, p));
    const toImport = [...deduped.values()];

    let imported = 0, updated = 0;
    for (const { rec } of toImport) {
      const result = await pool.query(`
        INSERT INTO contacts
          (dealer_id, email, first_name, last_name, phone, zip, city, state,
           make_interest, model_interest, status, last_purchase_year,
           last_purchase_make, last_purchase_model, tags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (dealer_id, email) DO UPDATE SET
          first_name   = COALESCE(NULLIF(EXCLUDED.first_name,''),   contacts.first_name),
          last_name    = COALESCE(NULLIF(EXCLUDED.last_name,''),    contacts.last_name),
          phone        = COALESCE(NULLIF(EXCLUDED.phone,''),        contacts.phone),
          zip          = COALESCE(NULLIF(EXCLUDED.zip,''),          contacts.zip),
          make_interest= COALESCE(NULLIF(EXCLUDED.make_interest,''),contacts.make_interest),
          tags         = (SELECT ARRAY(SELECT DISTINCT UNNEST(contacts.tags || EXCLUDED.tags)))
        RETURNING (xmax = 0) AS inserted
      `, [
        dealer_id, rec.email, rec.first_name||null, rec.last_name||null,
        rec.phone||null, rec.zip||null, rec.city||null, rec.state||null,
        rec.make_interest||null, rec.model_interest||null, rec.status,
        rec.last_purchase_year||null, rec.last_purchase_make||null,
        rec.last_purchase_model||null, rec.tags||[],
      ]);
      if (result.rows[0]?.inserted) imported++; else updated++;
    }

    await pool.query(`
      INSERT INTO ftp_imports (dealer_id,filename,rows_total,rows_imported,rows_skipped,rows_error,status,finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,'complete',NOW())
    `, [dealer_id, req.file.originalname, rawRows.length, imported+updated, invalid.length, invalid.length]);

    res.json({
      ok: true,
      summary: { total: rawRows.length, imported, updated, errors: invalid.length },
      error_rows: invalid.slice(0,200).map(p => ({ row: p.rowNum, email: p.rec.email||'', errors: p.errors })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
});

export default router;
