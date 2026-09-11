import { useState } from 'react';
import { Download, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { Data, categories, password, safeError } from '../core/model';
import { rows as fetchRows } from '../core/api';
import { ImportRow, downloadWorkbook, parseWorkbook, downloadCredentials } from '../core/excel';
import { Confirm } from './ui';
import { toast } from 'sonner';
export function ExcelPanel({ data, busy, demo, mutate, account }: {
    data: Data;
    busy: boolean;
    demo: boolean;
    mutate: (name: string, a: Record<string, unknown>, silent?: boolean) => Promise<any>;
    account: (body: Record<string, unknown>) => Promise<any>;
}) {
    const [items, setItems] = useState<ImportRow[]>([]), [working, setWorking] = useState(false), [message, setMessage] = useState(''), [report, setReport] = useState<string[]>([]), [confirm, setConfirm] = useState(false), [credentials, setCredentials] = useState<{
        username: string;
        password: string;
    }[]>([]), [done, setDone] = useState(false);
    async function download(template = false) {
        setWorking(true);
        try {
            const audit = template || demo ? data.audit : await fetchRows('audit_log');
            await downloadWorkbook(data, audit as Data['audit'], template);
        }
        catch {
            toast.error('تعذر تجهيز ملف Excel. حاول تاني.');
        }
        finally {
            setWorking(false);
        }
    }
    async function apply() {
        setWorking(true);
        setConfirm(false);
        const results: string[] = [], created: {
            username: string;
            password: string;
        }[] = [];
        for (const item of items) {
            const v = item.values;
            const str = (key: string) => String(v[key] ?? '');
            try {
                if (item.error)
                    throw Error(item.error);
                if (item.sheet === 'الطلاب') {
                    if (v.id)
                        await mutate('save_profile', { p_id: v.id, p_name: v.full_name, p_phone: str('phone'), p_version: Number(v.version) }, true);
                    else {
                        const pass = password();
                        await account({ action: 'create', username: v.username, name: v.full_name, phone: str('phone'), password: pass });
                        created.push({ username: str('username'), password: pass });
                        setCredentials([...created]);
                    }
                }
                if (item.sheet === 'الأيام')
                    await mutate('save_day', { p_id: v.id || null, p_label: v.label, p_date: v.date || null, p_version: Number(v.version || 0) }, true);
                if (item.sheet === 'التقييمات')
                    await mutate('save_evaluation', { p_student: v.student_id, p_day: v.day_id, p_present: v.present, p_scores: Object.fromEntries(categories.map(([k]) => [k, v[k] ?? 0])), p_notes: v.notes || '', p_version: Number(v.version || 0) }, true);
                if (item.sheet === 'الدرجات المستقلة')
                    await mutate('save_final_scores', { p_student: v.student_id, p_parts: Object.fromEntries(data.grading.config.parts.map(p => [p.id, v['part_' + p.id] ?? 0])), p_competition: v.competition || 0, p_project: v.project || 0, p_notes: v.notes || '', p_version: Number(v.version || 0) }, true);
                if (item.sheet === 'نظام الدرجات')
                    await mutate('save_grading', { p_config: JSON.parse(str('config')), p_published: data.grading.results_published, p_version: Number(v.version) }, true);
                if (item.sheet === 'الإعدادات')
                    await mutate('save_settings', { p_name: v.name, p_slogan: v.slogan || '', p_verse: v.verse || '', p_logo: v.logo ?? data.settings.logo, p_version: Number(v.version) }, true);
                results.push('✓ ' + item.sheet + ' · صف ' + item.row + ' — تم الحفظ');
            }
            catch (e) {
                results.push('✕ ' + item.sheet + ' · صف ' + item.row + ' — ' + safeError(e));
            }
            setReport([...results]);
        }
        setWorking(false);
        setDone(true);
        setMessage('انتهت المحاولة. راجع النتائج؛ الصفوف الفاشلة فقط تحتاج إعادة استيراد بعد التصحيح.');
    }
    return <><div className="excel-grid"><section className="panel"><FileSpreadsheet className="feature-icon"/><h2>تصدير البيانات</h2><p className="muted">الطلاب والأيام والتقييم اليومي والدرجات المستقلة والمعادلة والترتيب والسجل في ملف واحد. كلمات المرور لا تدخل في التصدير.</p><div className="actions wrap section-gap"><button className="primary" disabled={busy || working} onClick={() => void download()}><Download size={18}/>تصدير Excel</button><button className="secondary" disabled={working} onClick={() => void download(true)}>تنزيل قالب فارغ</button></div><small>السجل والترتيب وحالة الحساب ورموز QR للتصدير فقط. إعلان النتيجة من صفحة نظام الدرجات. إعادة إنشاء حساب تُصدر رمزًا وكلمة مرور جديدين.</small></section><section className="panel"><Upload className="feature-icon"/><h2>استيراد ملف</h2><p className="muted">اختر ملف XLSX، راجع المعاينة، ثم أكّد الحفظ.</p><label className="upload-zone">ملف Excel (حتى 5 ميجابايت)<input type="file" accept=".xlsx" disabled={working || busy} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            setWorking(true);
            setMessage('');
            setReport([]);
            setDone(false);
            setItems([]);
            try {
                setItems(await parseWorkbook(file, data));
            }
            catch (e) {
                setMessage(e instanceof Error ? e.message : 'تعذر قراءة الملف.');
            }
            finally {
                setWorking(false);
                e.target.value = '';
            }
        }}/></label><small>حتى 500 صف. يتم الحفظ صفًا بصف مع تقرير لكل نتيجة.</small></section></div>{message && <div className="notice" role="status">{message}</div>}{items.length > 0 && <section className="panel section-gap"><div className="panel-heading"><h2>معاينة الاستيراد</h2><span>{items.length} صف · {items.filter(x => x.error).length} خطأ</span></div><div className="import-preview">{items.map((item, i) => <div className={'import-row ' + (item.error ? 'invalid' : '')} key={i}><b>{item.sheet} · صف {item.row}</b><span>{String(item.values.full_name || item.values.label || item.values.name || item.values.student_id || '')}</span><small>{item.error || 'جاهز للاستيراد'}</small></div>)}</div><button className="primary section-gap" disabled={working || busy || done || items.some(x => x.error)} onClick={() => setConfirm(true)}><Upload size={17}/>{working ? 'جاري الاستيراد…' : 'استيراد ' + items.length + ' صف'}</button></section>}{report.length > 0 && <section className="panel section-gap"><h2>نتيجة الاستيراد</h2>{report.map((r, i) => <p className={r.startsWith('✕') ? 'error' : 'import-result'} key={i}>{r}</p>)}</section>}{credentials.length > 0 && <section className="notice"><b>بيانات دخول {credentials.length} حساب جديد</b><p>نزّل الكشف قبل مغادرة الصفحة وسلّم بيانات كل طالب له بشكل خاص. {demo ? 'هذه بيانات تجريبية فقط.' : ''}</p><button className="secondary" onClick={() => void downloadCredentials(credentials).catch(() => toast.error('تعذر تنزيل الحسابات'))}>تنزيل بيانات الحسابات الجديدة</button></section>}{confirm && <Confirm title="حفظ بيانات الملف؟" description="سيتم إنشاء الحسابات الجديدة وتحديث السجلات الموجودة. التعديلات تُسجل في السجل، وتظهر نتيجة كل صف." onClose={() => setConfirm(false)} action={() => void apply()}/>}</>;
}
