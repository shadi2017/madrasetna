import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Clock3, DatabaseBackup, Download, FileSpreadsheet, HardDriveDownload, Mail, RefreshCw, Send, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Data, safeError } from '../core/model';
import { rpc, backupAction } from '../core/api';
import { downloadWorkbook } from '../core/excel';
import { cairoDate, liveDays } from '../core/analytics';
import { deleteLocalSnapshot, downloadJsonBackup, downloadLocalSnapshot, formatBytes, listLocalSnapshots, saveLocalSnapshot, type LocalBackupMeta } from '../core/local-backup';

export type BackupSettings = {
    enabled: boolean;
    run_time: string;
    email: string;
    retention: number;
    version: number;
};

export type BackupRun = {
    id: string;
    study_date: string;
    kind: 'scheduled' | 'manual';
    status: 'running' | 'success' | 'partial' | 'failed';
    started_at: string;
    finished_at: string | null;
    size_bytes: number;
    tables: Record<string, number>;
    targets: Record<string, string>;
    error: string;
};

type BackupState = { settings: BackupSettings; runs: BackupRun[] };
type TargetState = { supabase: boolean; r2: boolean; telegram: boolean; email: boolean };

const emptySettings: BackupSettings = { enabled: false, run_time: '00:00', email: '', retention: 14, version: 1 };

function arDate(value: string | null | undefined) {
    return value ? new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}
function arDateTime(value: string | null | undefined) {
    return value ? new Date(value).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
function statusLabel(status: BackupRun['status']) {
    return ({ running: 'جاري التنفيذ', success: 'ناجح', partial: 'ناجح جزئيًا', failed: 'فشل' } as Record<string, string>)[status] || status;
}
function addDay(date: string) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
function timeLabel(value: string) { const [hour, minute] = value.slice(0, 5).split(':'); const h = Number(hour); return `${h % 12 || 12}:${minute} ${h < 12 ? 'ص' : 'م'}`; }
function nextRun(data: Data, settings: BackupSettings, runs: BackupRun[]) {
    const days = liveDays(data).filter(day => day.date);
    const today = cairoDate();
    const time = timeLabel(settings.run_time || '00:00');
    const latest = [...days].reverse().find(day => (day.date || '') < today);
    if (latest && !runs.some(run => run.study_date === latest.date && run.status === 'success' && run.kind !== 'manual'))
        return `مستحق الآن · ${latest.label}`;
    const todayDay = days.find(day => day.date === today);
    if (todayDay)
        return `${arDate(addDay(today))} · ${time} (بعد ${todayDay.label})`;
    const upcoming = days.find(day => (day.date || '') > today);
    return upcoming ? `${arDate(addDay(upcoming.date!))} · ${time} (بعد ${upcoming.label})` : 'لا يوجد يوم دراسة قادم محدد';
}

export function BackupPanel({ data, demo, onRefresh }: { data: Data; demo: boolean; onRefresh: () => Promise<unknown> }) {
    const [state, setState] = useState<BackupState>({ settings: emptySettings, runs: [] });
    const [targets, setTargets] = useState<TargetState | null>(null);
    const [settings, setSettings] = useState<BackupSettings>(emptySettings);
    const [local, setLocal] = useState<LocalBackupMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    async function load() {
        setLoading(true);
        try {
            if (!demo) {
                const result = await rpc('get_backup_state', {}) as BackupState;
                const nextSettings = result.settings || emptySettings;
                setState({ settings: nextSettings, runs: result.runs || [] });
                setSettings(nextSettings);
                try {
                    const health = await backupAction({ action: 'status' }) as { targets?: TargetState };
                    setTargets(health.targets || null);
                }
                catch {
                    setTargets(null);
                }
            }
            setLocal(await listLocalSnapshots());
            setError('');
        }
        catch (e) {
            setError(safeError(e));
        }
        finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, [demo]);

    async function saveSettings() {
        setBusy('save');
        setMessage('');
        try {
            if (demo) {
                setState(current => ({ ...current, settings: { ...settings, version: settings.version + 1 } }));
                setMessage('تم حفظ الإعدادات في النسخة التجريبية.');
                return;
            }
            const saved = await rpc('save_backup_settings', {
                p_enabled: settings.enabled,
                p_run_time: settings.run_time,
                p_email: settings.email,
                p_retention: settings.retention,
                p_version: settings.version,
            }) as BackupSettings;
            setSettings(saved);
            setState(current => ({ ...current, settings: saved }));
            setMessage('تم حفظ إعدادات النسخ الاحتياطي.');
            toast.success('تم حفظ إعدادات النسخ الاحتياطي');
        }
        catch (e) {
            setMessage(safeError(e));
        }
        finally {
            setBusy('');
        }
    }

    async function runNow() {
        setBusy('run');
        setMessage('');
        try {
            const result = await backupAction({ action: 'manual', force: true }) as { skipped?: string; study_date?: string; size?: number; targets?: Record<string, string>; notifications?: Record<string, string> };
            if (result?.skipped) {
                setMessage('لم يتم إنشاء نسخة: ' + result.skipped);
                toast.info('لم يتم إنشاء نسخة جديدة');
            }
            else {
                setMessage('تم إنشاء النسخة الاحتياطية بنجاح' + (result?.size ? ' · ' + formatBytes(result.size) : '') + '.');
                toast.success('تم إنشاء النسخة الاحتياطية');
            }
            await load();
            await onRefresh();
        }
        catch (e) {
            setMessage(safeError(e));
        }
        finally {
            setBusy('');
        }
    }

    async function snapshotLocal() {
        setBusy('local');
        setMessage('');
        try {
            const date = cairoDate();
            await saveLocalSnapshot(data, date, 'نسخة يدوية', true);
            setLocal(await listLocalSnapshots());
            setMessage('تم حفظ نسخة محلية مضغوطة داخل المتصفح.');
            toast.success('تم حفظ نسخة محلية');
        }
        catch (e) {
            setMessage(safeError(e));
        }
        finally {
            setBusy('');
        }
    }

    async function removeLocal(id: string) {
        try {
            await deleteLocalSnapshot(id);
            setLocal(await listLocalSnapshots());
            toast.success('تم حذف النسخة المحلية');
        }
        catch (e) {
            toast.error(safeError(e));
        }
    }

    const last = state.runs.find(run => run.status === 'success') || state.runs[0];
    const notConfigured = !demo && targets && !targets.supabase && !targets.r2 && !targets.telegram && !targets.email;
    return <div className="backup-page">
        <div className="backup-status-grid">
            <section className="panel backup-status-card"><span className="kpi-icon"><DatabaseBackup size={21}/></span><div><small>آخر نسخة</small><b>{last ? arDateTime(last.finished_at || last.started_at) : 'لسه مفيش نسخة'}</b><span className={'status-pill ' + (last?.status === 'success' ? 'ok' : last?.status === 'failed' ? 'danger' : 'muted')}>{last ? statusLabel(last.status) : 'بانتظار أول تشغيل'}</span></div></section>
            <section className="panel backup-status-card"><span className="kpi-icon"><Clock3 size={21}/></span><div><small>التشغيل القادم</small><b>{nextRun(data, state.settings, state.runs)}</b><span className="muted">{state.settings.enabled ? 'التشغيل التلقائي مفعّل' : 'التشغيل التلقائي متوقف'}</span></div></section>
            <section className="panel backup-status-card"><span className="kpi-icon"><Cloud size={21}/></span><div><small>أماكن الحفظ</small><div className="target-chips">{targets ? <>{targets.supabase && <span className="chip ok"><Cloud size={13}/>Supabase</span>}{targets.r2 && <span className="chip ok"><Cloud size={13}/>R2</span>}{targets.telegram && <span className="chip ok"><Send size={13}/>تلجرام</span>}{targets.email && <span className="chip ok"><Mail size={13}/>إيميل</span>}{!targets.supabase && !targets.r2 && <span className="chip warn"><AlertTriangle size={13}/>لا يوجد هدف سحابي</span>}</> : <span className="chip muted"><ShieldCheck size={13}/>غير متاح في الديمو</span>}</div></div></section>
            <section className="panel backup-status-card"><span className="kpi-icon"><HardDriveDownload size={21}/></span><div><small>النسخ المحلية</small><b>{local.length} نسخة</b><span className="muted">محفوظة داخل هذا المتصفح</span></div></section>
        </div>

        {notConfigured && <div className="notice"><AlertTriangle size={20}/><div><b>النسخ السحابي غير مكتمل الإعداد</b><p>راجع ملف <code>BACKUP.md</code> لضبط Supabase الثاني وR2 وتلجرام والإيميل. النسخة المحلية تعمل بالفعل.</p></div></div>}
        {error && <div className="error" role="alert">{error}</div>}
        {message && <div className="notice" role="status">{message}</div>}

        <div className="backup-grid">
            <section className="panel">
                <div className="panel-heading"><div><h2>إعدادات النسخ اليومي</h2><p className="muted">يعمل بعد منتصف الليل لليوم الدراسي الذي انتهى للتو.</p></div><ShieldCheck size={22} className="feature-icon"/></div>
                <form className="backup-form" onSubmit={event => { event.preventDefault(); void saveSettings(); }}>
                    <label className="switch-row"><span><b>تشغيل النسخ التلقائي</b><small>يتم الفحص كل 15 دقيقة داخل Supabase.</small></span><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })}/></label>
                    <label>وقت النسخ بعد منتصف الليل (توقيت القاهرة)<input type="time" required min="00:00" max="06:00" value={settings.run_time.slice(0, 5)} onChange={event => setSettings({ ...settings, run_time: event.target.value })}/><small>الافتراضي 12:00 ص. يُنشئ نسخة لليوم الدراسي السابق، ولا يعمل إلا في الأيام الموجودة في جدول الدراسة. الحد الأقصى 6 صباحًا.</small></label>
                    <label>بريد استلام الملخص<input type="text" inputMode="email" dir="ltr" maxLength={1000} value={settings.email} placeholder="you@example.com, parent@example.com" onChange={event => setSettings({ ...settings, email: event.target.value })}/><small>اختياري؛ أكثر من بريد مفصول بفاصلة. مع onboarding@resend.dev يصل لبريد صاحب الحساب فقط؛ وثّق دومين لإرسال لباقي العناوين.</small></label>
                    <label>عدد النسخ المحفوظة<input type="number" min={1} max={90} value={settings.retention} onChange={event => setSettings({ ...settings, retention: Number(event.target.value) })}/><small>يتم حذف الأقدم تلقائيًا من الأهداف السحابية.</small></label>
                    <div className="actions wrap"><button className="primary" disabled={!!busy}>{busy === 'save' ? 'جاري الحفظ…' : 'حفظ الإعدادات'}</button><button type="button" className="secondary" disabled={!!busy} onClick={() => void runNow()}>{busy === 'run' ? 'جاري النسخ…' : <><RefreshCw size={16}/>نسخ احتياطي الآن</>}</button></div>
                </form>
            </section>

            <section className="panel">
                <div className="panel-heading"><div><h2>نسخة محلية الآن</h2><p className="muted">تعمل بدون إنترنت وبدون إرسال بيانات لأي خدمة.</p></div><HardDriveDownload size={22} className="feature-icon"/></div>
                <p className="muted">النسخة المحلية تُحفظ داخل IndexedDB في هذا المتصفح، مع ضغط gzip. احتفظ دائمًا بنسخة خارج الجهاز كمان.</p>
                <div className="actions wrap section-gap"><button className="primary" disabled={!!busy} onClick={() => void snapshotLocal()}>{busy === 'local' ? 'جاري الحفظ…' : 'حفظ نسخة محلية'}</button><button className="secondary" disabled={!!busy} onClick={() => void downloadJsonBackup(data, cairoDate()).catch(e => toast.error(safeError(e)))}><Download size={16}/>تنزيل JSON</button><button className="secondary" disabled={!!busy} onClick={() => void downloadWorkbook(data, data.audit).catch(() => toast.error('تعذر تجهيز ملف Excel'))}><FileSpreadsheet size={16}/>تنزيل Excel</button></div>
                <div className="local-list">{local.length ? local.map(item => <div className="local-row" key={item.id}><span className="local-icon"><HardDriveDownload size={17}/></span><span className="local-info"><b>{arDate(item.study_date)}</b><small>{arDateTime(item.created_at)} · {formatBytes(item.size)} · {item.rows} سجل</small></span><span className="actions"><button className="icon-button" aria-label="تنزيل النسخة" onClick={() => void downloadLocalSnapshot(item.id).catch(e => toast.error(safeError(e)))}><Download size={16}/></button><button className="icon-button danger" aria-label="حذف النسخة" onClick={() => void removeLocal(item.id)}><Trash2 size={16}/></button></span></div>) : <div className="chart-empty">لسه مفيش نسخ محلية. اضغط «حفظ نسخة محلية».</div>}</div>
            </section>
        </div>

        <section className="panel section-gap">
            <div className="panel-heading"><div><h2>سجل التشغيل</h2><p className="muted">آخر عمليات النسخ السحابي.</p></div><span className="badge">{state.runs.length} عملية</span></div>
            {loading ? <div className="chart-empty">جاري تحميل السجل…</div> : state.runs.length ? <div className="backup-runs">{state.runs.map(run => <div className="backup-run" key={run.id}><span className={'run-status ' + run.status}>{run.status === 'success' ? <CheckCircle2 size={16}/> : run.status === 'failed' ? <XCircle size={16}/> : <Clock3 size={16}/>}</span><span className="run-main"><b>{arDate(run.study_date)} · {statusLabel(run.status)} <small className="muted">({run.kind === 'manual' ? 'يدوي' : 'تلقائي'})</small></b><small>{arDateTime(run.started_at)} · {formatBytes(run.size_bytes)}</small></span><span className="run-targets">{Object.entries(run.targets || {}).map(([key, value]) => <span className={'chip ' + (String(value).startsWith('ok') ? 'ok' : 'warn')} key={key}>{key}</span>)}</span>{run.error && <small className="error-text" title={run.error}>{run.error.slice(0, 80)}</small>}</div>)}</div> : <div className="chart-empty">أول نسخة ستظهر هنا بعد التشغيل.</div>}
        </section>

        <section className="panel section-gap backup-notes"><h2>ملاحظات مهمة</h2><ul><li>النسخة السحابية تحتوي بيانات شخصية؛ التخزين خاص والروابط الموقعة مؤقتة. لا تشارك الملفات علنًا.</li><li>المتصفح لا يستطيع الكتابة على القرص بدون تدخل منك. لذلك النسخة المحلية تُحفظ داخل المتصفح، مع أزرار تنزيل JSON وExcel.</li><li>يتم إنشاء نسخة محلية تلقائيًا عند أول فتح للوحة الأدمن بعد منتصف الليل، وتكون خاصة باليوم الدراسي الذي انتهى للتو، بحد أقصى مرة واحدة لكل يوم.</li><li>ابدأ دائمًا بتجربة استرجاع من نسخة واحدة على مشروع تجريبي قبل الاعتماد عليها.</li></ul></section>
    </div>;
}
