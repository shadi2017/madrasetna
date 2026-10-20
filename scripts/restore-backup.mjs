#!/usr/bin/env node
// Restores a Madrasetna backup into a Supabase project.
//
// SAFETY: dry-run by default. Writes nothing until you pass --confirm.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   RESTORE_ADMIN_PASSWORD="temporary-strong-password" \
//   node scripts/restore-backup.mjs backup.json [--confirm] [--with-audit] [--no-auth]
//
// Flags:
//   --confirm     actually write to the target project
//   --with-audit  restore the audit_log table too (large)
//   --no-auth     skip creating auth users; only works if their IDs already exist
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--'));
const confirmed = args.includes('--confirm');
const withAudit = args.includes('--with-audit');
const restoreAuth = !args.includes('--no-auth');
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminPassword = process.env.RESTORE_ADMIN_PASSWORD || '';

if (!file || !url || !serviceKey) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs <backup.json> [--confirm] [--with-audit] [--no-auth]');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(file, 'utf8'));
if (backup.format !== 'madrasetna-cloud-backup-v1') {
  console.error('This is not a Madrasetna cloud backup file. Use the .json from the cloud backup (after decrypting if needed).');
  process.exit(1);
}
const tables = backup.tables || {};
console.log(`Backup format ${backup.format || 'unknown'} · study day ${backup.study_date || 'unknown'} · created ${backup.created_at || 'unknown'}`);
console.table(Object.fromEntries(Object.entries(tables).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])));
console.log(`Auth users in backup: ${(backup.auth_users || []).length}`);
if (!confirmed) {
  console.log(`\nDry run only. Re-run with --confirm to write into ${url}.`);
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function upsert(table, rows, onConflict) {
  if (!rows || !rows.length) return;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await admin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`  ${table}: +${chunk.length}`);
  }
}
async function listUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

const emailToId = new Map();
if (restoreAuth)
  for (const user of await listUsers())
    if (user.email) emailToId.set(user.email.toLowerCase(), user.id);

const idMap = new Map();
for (const user of backup.auth_users || []) {
  if (!restoreAuth) { idMap.set(user.id, user.id); continue; }
  const email = String(user.email || '').toLowerCase();
  if (email && emailToId.has(email)) { idMap.set(user.id, emailToId.get(email)); continue; }
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: user.user_metadata || {},
  });
  if (error || !data?.user) throw new Error(`auth user ${user.email}: ${error?.message || 'unknown error'}`);
  idMap.set(user.id, data.user.id);
  if (email) emailToId.set(email, data.user.id);
  console.log(`  auth user created: ${user.email}`);
}
if (!idMap.size && (tables.profiles || []).length) {
  console.error('No auth_users in backup. Users will not be created; profile restore may fail on foreign keys.');
}
if (restoreAuth && adminPassword) {
  for (const row of tables.admins || []) {
    const id = idMap.get(row.user_id);
    if (!id) continue;
    const { error } = await admin.auth.admin.updateUserById(id, { password: adminPassword });
    if (error) throw new Error(`admin password reset: ${error.message}`);
    console.log('  admin password reset for', id);
  }
}

const mapId = id => idMap.get(id) || id;
const remap = (row, keys) => {
  const copy = { ...row };
  for (const key of keys) if (copy[key]) copy[key] = mapId(copy[key]);
  return copy;
};

let restoreStarted = false;
let failed = false;
try {
  // Backups can contain historical grades that predate the binary-daily rule.
  // Disable that trigger only for the duration of the restore, then enable it again.
  const { error: beginError } = await admin.rpc('begin_restore');
  if (beginError) throw new Error(`begin_restore: ${beginError.message}`);
  restoreStarted = true;
  await upsert('settings', tables.settings, 'id');
  await upsert('grading', tables.grading, 'id');
  await upsert('backup_settings', tables.backup_settings, 'id');
  await upsert('admins', (tables.admins || []).map(row => ({ ...row, user_id: mapId(row.user_id) })), 'user_id');
  await upsert('days', tables.days, 'id');
  await upsert('profiles', (tables.profiles || []).map(row => ({ ...row, id: mapId(row.id) })), 'id');
  await upsert('evaluations', (tables.evaluations || []).map(row => remap(row, ['student_id'])), 'student_id,day_id');
  await upsert('final_scores', (tables.final_scores || []).map(row => remap(row, ['student_id'])), 'student_id');
  if (withAudit) await upsert('audit_log', (tables.audit_log || []).map(row => remap(row, ['actor_id'])), 'id');
  console.log('\nRestore finished. New users were created with random passwords: reset them from the dashboard or the app recovery flow.');
} catch (error) {
  failed = true;
  console.error('\nRestore failed:', error.message);
} finally {
  if (restoreStarted) {
    const { error } = await admin.rpc('end_restore');
    if (error) console.error('Could not re-enable validation triggers:', error.message);
  }
}
if (failed) process.exit(1);
