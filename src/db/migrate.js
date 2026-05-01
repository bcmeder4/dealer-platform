import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema    = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

console.log('Running database migrations...');
await pool.query(schema);
console.log('Migrations complete.');
await pool.end();
