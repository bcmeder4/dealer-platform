// ============================================================
// src/credit/encryption.js
// Shared AES-256-GCM encryption for credit data
// Used by router.js and prequal.js
// ============================================================

import crypto from 'crypto';

const KEY = Buffer.from(
  process.env.CREDIT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
  'hex'
);

export function encrypt(plaintext) {
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const iv      = Buffer.from(ivHex,  'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const enc     = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
