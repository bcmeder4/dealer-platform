import * as ftp from 'basic-ftp';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import pool from '../db/pool.js';

const DEFAULT_MAP = {
  vin:      ['VIN','Vin','vin','VehicleVIN'],
  year:     ['Year','YEAR','ModelYear','year'],
  make:     ['Make','MAKE','VehicleMake','make'],
  model:    ['Model','MODEL','VehicleModel','model'],
  trim:     ['Trim','TRIM','TrimLevel','trim'],
  color:    ['Color','ExteriorColor','COLOR','ExtColor'],
  price:    ['ListPrice','LIST_PRICE','Price','InternetPrice','price'],
  miles:    ['Mileage','MILEAGE','Miles','Odometer'],
  status:   ['VehicleStatus','VEHICLE_STATUS','Status','Condition','Type'],
  stock_num:['StockNumber','STOCK_NUM','StockNum','stock'],
  vdp_url:  ['DetailURL','DETAIL_URL','VDPUrl','vdp_url','URL','VehicleURL'],
  image_url:['ImageURL','IMAGE_URL','PhotoURL','MainPhoto'],
};

function mapRow(row, fieldMap = DEFAULT_MAP) {
  const get = keys => { for (const k of keys) { if (row[k] !== undefined && row[k] !== '') return row[k]; } return null; };
  const vin    = get(fieldMap.vin);
  const vdpUrl = get(fieldMap.vdp_url);
  if (!vin || !vdpUrl) return null;
  const rawStatus = (get(fieldMap.status) || 'new').toLowerCase();
  let status = 'used';
  if (/^new$/i.test(rawStatus) || rawStatus === 'n') status = 'new';
  else if (/cpo|certified/i.test(rawStatus))         status = 'cpo';
  else if (/sold/i.test(rawStatus))                  status = 'sold';
  return {
    vin:       vin.trim().toUpperCase(),
    year:      parseInt(get(fieldMap.year), 10) || new Date().getFullYear(),
    make:      (get(fieldMap.make) || '').trim(),
    model:     (get(fieldMap.model) || '').trim(),
    trim:      (get(fieldMap.trim) || '').trim() || null,
    color:     (get(fieldMap.color) || '').trim() || null,
    price:     parseFloat((get(fieldMap.price) || '0').replace(/[^0-9.]/g,'')) || null,
    miles:     parseInt((get(fieldMap.miles) || '0').replace(/[^0-9]/g,''), 10) || 0,
    status,
    stock_num: (get(fieldMap.stock_num) || '').trim() || null,
    vdp_url:   vdpUrl.trim(),
    image_url: (get(fieldMap.image_url) || '').trim() || null,
  };
}

export async function runFtpImport(dealerId) {
  const { rows: [dealer] } = await pool.query('SELECT * FROM dealers WHERE id=$1', [dealerId]);
  if (!dealer?.ftp_host) throw new Error('No FTP configuration for dealer');

  const { rows: [importLog] } = await pool.query(
    `INSERT INTO ftp_imports (dealer_id, status, log) VALUES ($1,'running','{}') RETURNING id`,
    [dealerId]
  );
  const importId = importLog.id;
  const log = (...msgs) => {
    console.log(`[FTP ${dealer.slug}]`, ...msgs);
    pool.query('UPDATE ftp_imports SET log=log||$1::text[] WHERE id=$2', [msgs.join(' '), importId]);
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dealer-ftp-'));
  const client = new ftp.Client();
  let rowsTotal=0, rowsImported=0, rowsSkipped=0, rowsError=0;

  try {
    log(`Connecting to ${dealer.ftp_host}…`);
    await client.access({ host: dealer.ftp_host, user: dealer.ftp_user, password: dealer.ftp_pass, secure: false });
    log('Authenticated. Listing files…');

    const files = await client.list(dealer.ftp_path);
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (!csvFiles.length) { log('No CSV files found.'); }

    for (const file of csvFiles) {
      const localPath = path.join(tmpDir, file.name);
      log(`Downloading ${file.name}…`);
      await client.downloadTo(localPath, dealer.ftp_path + file.name);
      const raw  = fs.readFileSync(localPath, 'utf8');
      const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
      rowsTotal += rows.length;
      log(`Parsing ${rows.length} rows…`);

      const fieldMap = dealer.ftp_field_map || DEFAULT_MAP;
      const vinsInFeed = [];

      for (const row of rows) {
        const mapped = mapRow(row, fieldMap);
        if (!mapped) { rowsSkipped++; continue; }
        vinsInFeed.push(mapped.vin);
        try {
          await pool.query(`
            INSERT INTO vehicles
              (dealer_id,vin,year,make,model,trim,color,price,miles,status,stock_num,vdp_url,image_url,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
            ON CONFLICT (dealer_id,vin) DO UPDATE SET
              year=EXCLUDED.year, make=EXCLUDED.make, model=EXCLUDED.model,
              trim=EXCLUDED.trim, color=EXCLUDED.color, price=EXCLUDED.price,
              miles=EXCLUDED.miles, status=EXCLUDED.status, stock_num=EXCLUDED.stock_num,
              vdp_url=EXCLUDED.vdp_url, image_url=EXCLUDED.image_url, updated_at=NOW()
          `, [dealerId,mapped.vin,mapped.year,mapped.make,mapped.model,mapped.trim,
              mapped.color,mapped.price,mapped.miles,mapped.status,mapped.stock_num,
              mapped.vdp_url,mapped.image_url]);
          rowsImported++;
        } catch (err) { rowsError++; log(`Error on VIN ${mapped.vin}: ${err.message}`); }
      }

      if (vinsInFeed.length) {
        await pool.query(
          `UPDATE vehicles SET status='inactive', updated_at=NOW()
           WHERE dealer_id=$1 AND status!='inactive' AND vin!=ALL($2::text[])`,
          [dealerId, vinsInFeed]
        );
        log('Marked removed vehicles inactive.');
      }
    }

    log(`Complete: ${rowsImported} imported, ${rowsSkipped} skipped, ${rowsError} errors.`);
    await pool.query(
      `UPDATE ftp_imports SET status='complete',rows_total=$1,rows_imported=$2,rows_skipped=$3,rows_error=$4,finished_at=NOW() WHERE id=$5`,
      [rowsTotal, rowsImported, rowsSkipped, rowsError, importId]
    );
  } catch (err) {
    log(`FATAL: ${err.message}`);
    await pool.query(`UPDATE ftp_imports SET status='failed',finished_at=NOW() WHERE id=$1`, [importId]);
    throw err;
  } finally {
    client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { rowsTotal, rowsImported, rowsSkipped, rowsError };
}
