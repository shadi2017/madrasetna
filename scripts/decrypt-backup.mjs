#!/usr/bin/env node
// Decrypts a Madrasetna backup produced by the `backup` Edge Function when
// BACKUP_ENCRYPTION_KEY is configured, then gunzips it to a readable JSON file.
//
// Usage:
//   node scripts/decrypt-backup.mjs <madrasetna-YYYY-MM-DD.json.gz.enc> [base64-key]
//
// The key can also be provided through BACKUP_ENCRYPTION_KEY.
import { createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const file = process.argv[2];
const keyArg = process.argv[3] || process.env.BACKUP_ENCRYPTION_KEY || '';
if (!file || !keyArg) {
  console.error('Usage: node scripts/decrypt-backup.mjs <file.json.gz.enc> <base64-key>');
  process.exit(1);
}
const key = Buffer.from(keyArg, 'base64');
if (key.length !== 32) {
  console.error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64).');
  process.exit(1);
}
const bytes = readFileSync(file);
if (bytes.subarray(0, 5).toString('latin1') !== 'MADB1') {
  console.error('Not a Madrasetna encrypted backup (missing MADB1 header).');
  process.exit(1);
}
const iv = bytes.subarray(5, 17);
const tag = bytes.subarray(bytes.length - 16);
const ciphertext = bytes.subarray(17, bytes.length - 16);
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const gzipped = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const json = gunzipSync(gzipped).toString('utf8');
JSON.parse(json); // Fail fast if the decrypted payload is not valid JSON.
const output = join(dirname(file), basename(file).replace(/\.json\.gz\.enc$/, '.json'));
writeFileSync(output, json);
console.log('Decrypted ->', output);
