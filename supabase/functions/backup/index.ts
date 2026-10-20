// Madrasetna daily backup function.
// Runs from pg_cron (x-backup-secret) or from the admin UI (user JWT with is_admin).
// It never trusts a decoded token on its own and never logs secrets or student data.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type,x-backup-secret', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const MAGIC = new TextEncoder().encode('MADB1');
const TABLES = ['admins', 'profiles', 'days', 'evaluations', 'final_scores', 'audit_log', 'backup_settings'] as const;

function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function env(name: string) {
    return (Deno.env.get(name) || '').trim();
}
function cairoDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function cairoDateOffset(days: number) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function cairoTime() {
    const value = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    return value === '24:00' ? '00:00' : value;
}
async function gzip(bytes: Uint8Array) {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function sha256(bytes: Uint8Array) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function base64Bytes(value: string) {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
async function encryptBackup(bytes: Uint8Array, base64Key: string) {
    const raw = base64Bytes(base64Key);
    if (raw.byteLength !== 32)
        throw Error('BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as base64');
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as unknown as ArrayBuffer));
    const output = new Uint8Array(MAGIC.byteLength + iv.byteLength + cipher.byteLength);
    output.set(MAGIC, 0);
    output.set(iv, MAGIC.byteLength);
    output.set(cipher, MAGIC.byteLength + iv.byteLength);
    return output;
}
function targetStates(email = '') {
    return {
        supabase: Boolean(env('BACKUP_SUPABASE_URL') && env('BACKUP_SUPABASE_SERVICE_ROLE_KEY')),
        r2: Boolean(env('R2_ACCOUNT_ID') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET')),
        telegram: Boolean(env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_CHAT_ID')),
        email: Boolean(env('RESEND_API_KEY') && (email || env('BACKUP_EMAIL_TO'))),
    };
}
async function requireAdmin(req: Request, admin: ReturnType<typeof createClient>, url: string, anon: string) {
    const authorization = req.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer /i, '');
    if (!token)
        return reply({ error: 'UNAUTHORIZED' }, 401);
    const { data: identity, error } = await admin.auth.getUser(token);
    if (error || !identity.user)
        return reply({ error: 'UNAUTHORIZED' }, 401);
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: role, error: roleError } = await user.rpc('is_admin');
    if (roleError || role !== true)
        return reply({ error: 'ADMIN_REQUIRED' }, 403);
    return undefined;
}
async function fetchAll(client: ReturnType<typeof createClient>, table: string, order: string) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0;; from += 1000) {
        const { data, error } = await client.from(table).select('*').order(order, { ascending: true }).range(from, from + 999);
        if (error)
            throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000)
            break;
    }
    return rows;
}
async function fetchAuthUsers(admin: ReturnType<typeof createClient>) {
    const users: Record<string, unknown>[] = [];
    for (let page = 1;; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error)
            throw error;
        users.push(...data.users.map(user => ({ id: user.id, email: user.email, created_at: user.created_at, email_confirmed_at: user.email_confirmed_at, last_sign_in_at: user.last_sign_in_at, user_metadata: user.user_metadata })));
        if (data.users.length < 1000)
            break;
    }
    return users;
}
async function collect(admin: ReturnType<typeof createClient>, day: { label?: string } | null, studyDate: string) {
    const tables: Record<string, unknown> = {};
    tables.admins = await fetchAll(admin, 'admins', 'user_id');
    tables.profiles = await fetchAll(admin, 'profiles', 'id');
    tables.days = await fetchAll(admin, 'days', 'id');
    tables.evaluations = await fetchAll(admin, 'evaluations', 'id');
    tables.final_scores = await fetchAll(admin, 'final_scores', 'id');
    tables.audit_log = await fetchAll(admin, 'audit_log', 'id');
    tables.backup_settings = await fetchAll(admin, 'backup_settings', 'id');
    const { data: settings } = await admin.from('settings').select('*').eq('id', 1).maybeSingle();
    const { data: grading } = await admin.from('grading').select('*').eq('id', 1).maybeSingle();
    tables.grading = grading ? [grading] : [];
    tables.settings = settings ? [settings] : [];
    const auth_users = await fetchAuthUsers(admin);
    const counts: Record<string, number> = { auth_users: auth_users.length };
    for (const table of TABLES)
        counts[table] = (tables[table] as unknown[]).length;
    counts.grading = (tables.grading as unknown[]).length;
    counts.settings = (tables.settings as unknown[]).length;
    return {
        payload: {
            format: 'madrasetna-cloud-backup-v1',
            version: 1,
            created_at: new Date().toISOString(),
            study_date: studyDate,
            study_day: day?.label || null,
            app: { name: 'madrasetna', version: '0.1.0' },
            counts,
            tables,
            auth_users,
        },
        counts,
    };
}
async function uploadSupabase(path: string, bytes: Uint8Array, contentType: string, studyDate: string, hash: string, targets: Record<string, string>) {
    const url = env('BACKUP_SUPABASE_URL');
    const key = env('BACKUP_SUPABASE_SERVICE_ROLE_KEY');
    const bucket = env('BACKUP_BUCKET') || 'madrasetna-backups';
    if (!url || !key) {
        targets.supabase = 'skipped';
        return null;
    }
    try {
        const client = createClient(url, key, { auth: { persistSession: false } });
        await client.storage.createBucket(bucket, { public: false });
        const { error } = await client.storage.from(bucket).upload(path, new Blob([bytes as unknown as BlobPart], { type: contentType }), { contentType, upsert: true });
        if (error)
            throw error;
        await client.from('backup_snapshots').insert({ study_date: studyDate, file_path: path, size_bytes: bytes.byteLength, sha256: hash }).then(() => { }, () => { });
        targets.supabase = 'ok';
        return { client, bucket };
    }
    catch (error) {
        targets.supabase = 'error:' + String((error as { message?: string }).message || error).slice(0, 80);
        return null;
    }
}
async function uploadR2(path: string, bytes: Uint8Array, contentType: string, targets: Record<string, string>) {
    const account = env('R2_ACCOUNT_ID');
    const access = env('R2_ACCESS_KEY_ID');
    const secret = env('R2_SECRET_ACCESS_KEY');
    const bucket = env('R2_BUCKET');
    if (!account || !access || !secret || !bucket) {
        targets.r2 = 'skipped';
        return null;
    }
    try {
        const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: access, secretAccessKey: secret }, forcePathStyle: true });
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: path, Body: bytes, ContentType: contentType }));
        targets.r2 = 'ok';
        return { client, bucket };
    }
    catch (error) {
        targets.r2 = 'error:' + String((error as { message?: string }).message || error).slice(0, 80);
        return null;
    }
}
function retentionCutoff(studyDate: string, retention: number) {
    const date = new Date(studyDate + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - Math.max(1, retention - 1));
    return date.toISOString().slice(0, 10);
}
async function pruneSupabase(target: { client: ReturnType<typeof createClient>; bucket: string }, cutoff: string) {
    try {
        const { data } = await target.client.storage.from(target.bucket).list('daily', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
        const old = (data || []).filter(file => /^\d{4}-\d{2}-\d{2}/.test(file.name) && file.name.slice(0, 10) < cutoff).map(file => 'daily/' + file.name);
        if (old.length)
            await target.client.storage.from(target.bucket).remove(old);
    }
    catch { /* retention is best effort */ }
}
async function pruneR2(target: { client: S3Client; bucket: string }, cutoff: string) {
    try {
        const listed = await target.client.send(new ListObjectsV2Command({ Bucket: target.bucket, Prefix: 'daily/' }));
        const old = (listed.Contents || []).filter(item => item.Key && /^daily\/\d{4}-\d{2}-\d{2}/.test(item.Key) && item.Key.slice(6, 16) < cutoff).map(item => ({ Key: item.Key! }));
        if (old.length)
            await target.client.send(new DeleteObjectsCommand({ Bucket: target.bucket, Delete: { Objects: old } }));
    }
    catch { /* retention is best effort */ }
}
async function notifyTelegram(filename: string, bytes: Uint8Array, contentType: string, caption: string, targets: Record<string, string>) {
    const token = env('TELEGRAM_BOT_TOKEN');
    const chat = env('TELEGRAM_CHAT_ID');
    if (!token || !chat) {
        targets.telegram = 'skipped';
        return;
    }
    try {
        const small = bytes.byteLength <= 49 * 1024 * 1024;
        const form = new FormData();
        form.append('chat_id', chat);
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
        if (small)
            form.append('document', new Blob([bytes as unknown as BlobPart], { type: contentType }), filename);
        else
            form.append('text', caption + '\nالملف أكبر من 50 ميجابايت، استلمه من التخزين السحابي.');
        const response = await fetch(`https://api.telegram.org/bot${token}/${small ? 'sendDocument' : 'sendMessage'}`, { method: 'POST', body: form });
        const json = await response.json().catch(() => ({}));
        targets.telegram = response.ok && json.ok ? 'ok' : 'error:' + String(json.description || response.status).slice(0, 80);
    }
    catch (error) {
        targets.telegram = 'error:' + String((error as { message?: string }).message || error).slice(0, 80);
    }
}
async function notifyEmail(studyDate: string, caption: string, link: string | null, targets: Record<string, string>, recipient = '') {
    const key = env('RESEND_API_KEY');
    const to = (recipient || env('BACKUP_EMAIL_TO')).trim();
    const from = env('BACKUP_EMAIL_FROM') || 'onboarding@resend.dev';
    if (!key || !to) {
        targets.email = 'skipped';
        return;
    }
    try {
        const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><h2>نسخة احتياطية — مدرستنا</h2><p>${caption}</p>${link ? `<p><a href="${link}">تحميل ملف النسخة (رابط صالح 7 أيام)</a></p>` : `<p>${String(targets.telegram).startsWith('ok') ? 'الملف متاح على تلجرام.' : 'الملف محفوظ في التخزين السحابي (R2 / Supabase).'}</p>`}<p style="color:#888;font-size:12px">هذا البريد آلي من تطبيق مدرستنا. لا تشاركه.</p></div>`;
        const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject: `نسخة احتياطية مدرستنا — ${studyDate}`, html }) });
        targets.email = response.ok ? 'ok' : 'error:' + response.status;
    }
    catch (error) {
        targets.email = 'error:' + String((error as { message?: string }).message || error).slice(0, 80);
    }
}

async function latestStudyDay(admin: ReturnType<typeof createClient>, onOrBefore: string) {
    const { data } = await admin.from('days').select('date').is('deleted_at', null).not('date', 'is', null).lte('date', onOrBefore).order('date', { ascending: false }).limit(1).maybeSingle();
    return (data?.date as string | null) || onOrBefore;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
        return new Response('ok', { headers: cors });
    if (req.method !== 'POST')
        return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    try {
        const url = env('SUPABASE_URL');
        const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
        const anon = env('SUPABASE_ANON_KEY');
        if (!url || !serviceKey || !anon)
            return reply({ error: 'NOT_CONFIGURED' }, 500);
        const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
        const body = await req.json().catch(() => ({})) as { action?: string; force?: boolean; study_date?: string };
        const secret = req.headers.get('x-backup-secret') || '';
        const cronSecret = env('BACKUP_CRON_SECRET');
        const isCron = Boolean(cronSecret) && secret === cronSecret;
        if (!isCron) {
            const denied = await requireAdmin(req, admin, url, anon);
            if (denied)
                return denied;
        }
        if (body.action === 'status') {
            const { data: statusSettings } = await admin.from('backup_settings').select('email').eq('id', 1).maybeSingle();
            return reply({ ok: true, targets: targetStates(String(statusSettings?.email || '')) });
        }

        const force = body.action === 'manual' || body.force === true;
        const requestedDate = typeof body.study_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.study_date) ? body.study_date : '';
        // Scheduled runs at 00:00 Cairo time target the study day that just ended.
        // Manual runs target the latest study day up to today, or an explicit date.
        const studyDate = force ? (requestedDate || await latestStudyDay(admin, cairoDate())) : cairoDateOffset(-1);
        const { data: settings, error: settingsError } = await admin.from('backup_settings').select('*').eq('id', 1).maybeSingle();
        if (settingsError)
            throw settingsError;
        if (!force && (!settings || !settings.enabled))
            return reply({ ok: true, skipped: 'disabled' });
        const { data: day } = await admin.from('days').select('id,label,date').eq('date', studyDate).is('deleted_at', null).maybeSingle();
        if (!force && !day)
            return reply({ ok: true, skipped: 'not_study_day', study_date: studyDate });
        const runTime = String(settings?.run_time || '00:00').slice(0, 5);
        if (!force && cairoTime() < runTime)
            return reply({ ok: true, skipped: 'before_run_time', run_time: runTime });
        const { data: begin, error: beginError } = await admin.rpc('begin_backup', { p_date: studyDate, p_force: force, p_kind: force ? 'manual' : 'scheduled' });
        if (beginError)
            throw beginError;
        if (begin?.skip)
            return reply({ ok: true, skipped: begin.skip, study_date: studyDate });
        const runId = begin.id as string;
        try {
            const { payload, counts } = await collect(admin, day, studyDate);
            const rawBytes = new TextEncoder().encode(JSON.stringify(payload));
            const compressed = await gzip(rawBytes);
            const encryptionKey = env('BACKUP_ENCRYPTION_KEY');
            const bytes = encryptionKey ? await encryptBackup(compressed, encryptionKey) : compressed;
            const hash = await sha256(bytes);
            const encrypted = Boolean(encryptionKey);
            const extension = encrypted ? 'json.gz.enc' : 'json.gz';
            const filename = `madrasetna-${studyDate}.${extension}`;
            const path = `daily/${studyDate}.${extension}`;
            const contentType = encrypted ? 'application/octet-stream' : 'application/gzip';
            const targets: Record<string, string> = {};
            const remote = await uploadSupabase(path, bytes, contentType, studyDate, hash, targets);
            const r2 = await uploadR2(path, bytes, contentType, targets);
            let link: string | null = null;
            if (remote) {
                const { data: signed } = await remote.client.storage.from(remote.bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
                link = signed?.signedUrl || null;
            }
            const caption = `نسخة احتياطية مدرستنا\nالتاريخ: ${studyDate}\nالحجم: ${(bytes.byteLength / 1024).toFixed(1)} KB\nالطلاب: ${counts.profiles} · الأيام: ${counts.days} · التقييمات: ${counts.evaluations}${encrypted ? '\nالملف مشفر AES-256-GCM' : ''}`;
            await notifyTelegram(filename, bytes, contentType, caption, targets);
            await notifyEmail(studyDate, caption, link, targets, String(settings?.email || ''));
            const retention = Number(settings?.retention || 14);
            const cutoff = retentionCutoff(studyDate, retention);
            if (remote)
                await pruneSupabase(remote, cutoff);
            if (r2)
                await pruneR2(r2, cutoff);
            const storageOk = ['supabase', 'r2'].some(key => String(targets[key]).startsWith('ok'));
            const anyOk = Object.values(targets).some(value => String(value).startsWith('ok'));
            const status = storageOk ? 'success' : anyOk ? 'partial' : 'failed';
            await admin.rpc('finish_backup', { p_id: runId, p_status: status, p_size: bytes.byteLength, p_tables: counts, p_targets: targets, p_error: status === 'failed' ? 'NO_STORAGE_TARGET' : status === 'partial' ? 'DELIVERED_WITHOUT_STORAGE_TARGET' : '' });
            return reply({ ok: true, study_date: studyDate, size: bytes.byteLength, raw_size: rawBytes.byteLength, encrypted, hash, targets, counts });
        }
        catch (error) {
            const message = String((error as { message?: string }).message || error).slice(0, 500);
            await admin.rpc('finish_backup', { p_id: runId, p_status: 'failed', p_size: 0, p_tables: {}, p_targets: {}, p_error: message });
            return reply({ error: 'BACKUP_FAILED', detail: message }, 500);
        }
    }
    catch (error) {
        console.error('Backup request failed', String((error as { message?: string }).message || error).slice(0, 200));
        return reply({ error: 'REQUEST_FAILED' }, 400);
    }
});
