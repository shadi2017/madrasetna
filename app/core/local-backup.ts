import { Data } from './model';

export type LocalBackupMeta = {
    id: string;
    created_at: string;
    study_date: string;
    size: number;
    hash: string;
    rows: number;
    label: string;
};

type LocalBackupRecord = LocalBackupMeta & { blob: Blob };

const DB_NAME = 'madrasetna-local-backups';
const STORE = 'snapshots';
const DB_VERSION = 1;
const KEEP = 14;

export function localBackupSupported() {
    return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error || new Error('INDEXED_DB_ERROR'));
    });
}

function transactionDone(tx: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('INDEXED_DB_ERROR'));
        tx.onabort = () => reject(tx.error || new Error('INDEXED_DB_ABORTED'));
    });
}

function openDb() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('study_date', 'study_date', { unique: true });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error || new Error('INDEXED_DB_ERROR'));
    });
}

async function gzip(bytes: Uint8Array) {
    if (typeof CompressionStream === 'undefined')
        return bytes;
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256(bytes: Uint8Array) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function strip(record: LocalBackupRecord): LocalBackupMeta {
    const { blob: _blob, ...meta } = record;
    return meta;
}

export function backupPayload(data: Data, studyDate: string) {
    return {
        format: 'madrasetna-local-backup-v1',
        version: 1,
        source: 'browser',
        created_at: new Date().toISOString(),
        study_date: studyDate,
        tables: {
            students: data.students,
            days: data.days,
            evaluations: data.evaluations,
            finals: data.finals,
            grading: data.grading,
            settings: data.settings,
            audit: data.audit,
        },
        results: data.results,
    };
}

export async function saveLocalSnapshot(data: Data, studyDate: string, label = 'نسخة محلية', overwrite = false) {
    if (!localBackupSupported())
        throw new Error('LOCAL_BACKUP_UNSUPPORTED');
    const payload = backupPayload(data, studyDate);
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzip(raw);
    const hash = await sha256(compressed);
    const record: LocalBackupRecord = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        study_date: studyDate,
        size: compressed.byteLength,
        hash,
        rows: data.students.length + data.days.length + data.evaluations.length + data.finals.length + data.audit.length,
        label,
        blob: new Blob([compressed as unknown as BlobPart], { type: 'application/gzip' }),
    };
    const db = await openDb();
    try {
        const existing = await request<LocalBackupRecord | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).index('study_date').get(studyDate));
        if (existing && !overwrite)
            return strip(existing);
        if (existing)
            record.id = existing.id;
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        await transactionDone(tx);
        await prune(db, KEEP);
        return strip(record);
    }
    finally {
        db.close();
    }
}

async function prune(db: IDBDatabase, keep: number) {
    const all = await request<LocalBackupRecord[]>(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    const old = all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(keep);
    if (!old.length)
        return;
    const tx = db.transaction(STORE, 'readwrite');
    for (const record of old)
        tx.objectStore(STORE).delete(record.id);
    await transactionDone(tx);
}

export async function listLocalSnapshots(): Promise<LocalBackupMeta[]> {
    if (!localBackupSupported())
        return [];
    const db = await openDb();
    try {
        const all = await request<LocalBackupRecord[]>(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
        return all.map(strip).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    finally {
        db.close();
    }
}

export async function localSnapshot(id: string) {
    if (!localBackupSupported())
        throw new Error('LOCAL_BACKUP_UNSUPPORTED');
    const db = await openDb();
    try {
        return await request<LocalBackupRecord | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
    }
    finally {
        db.close();
    }
}

export async function deleteLocalSnapshot(id: string) {
    if (!localBackupSupported())
        return;
    const db = await openDb();
    try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        await transactionDone(tx);
    }
    finally {
        db.close();
    }
}

export async function downloadLocalSnapshot(id: string) {
    const record = await localSnapshot(id);
    if (!record)
        throw new Error('BACKUP_NOT_FOUND');
    saveBlob(record.blob, 'madrasetna-local-' + record.study_date + '.json.gz');
}

export async function downloadJsonBackup(data: Data, studyDate: string) {
    const payload = backupPayload(data, studyDate);
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'madrasetna-local-' + studyDate + '.json');
}

export function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes: number) {
    if (!bytes)
        return '0 B';
    if (bytes < 1024)
        return bytes + ' B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
