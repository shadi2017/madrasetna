import { useState } from 'react';
import { Student, Day, Evaluation, Settings, ScoreConfig, categories, password, validStudent } from '../core/model';
import { Switch } from '@/components/ui/switch';
import { Modal } from './ui';
export function StudentForm({ student, busy, onSave, onClose }: {
    student?: Student;
    busy: boolean;
    onSave: (v: {
        name: string;
        phone: string;
        username: string;
        password: string;
    }) => Promise<void>;
    onClose: () => void;
}) {
    const [name, setName] = useState(student?.full_name || ''), [phone, setPhone] = useState(student?.phone || ''), [username, setUsername] = useState(student?.username || ''), [pass, setPass] = useState(password);
    return <Modal title={student ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'} description={student ? 'اسم المستخدم ثابت للحفاظ على حساب الدخول.' : 'يتم إنشاء الحساب وكود الحضور مع حفظ الطالب.'} onClose={onClose}><form onSubmit={e => {
            e.preventDefault();
            if (validStudent(name, phone, username))
                void onSave({ name, phone, username, password: pass });
        }}><label>اسم الطالب<input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label><label>رقم الموبايل<input required type="tel" pattern="\+?[0-9]{8,15}" dir="ltr" value={phone} onChange={e => setPhone(e.target.value.replaceAll(' ', ''))}/></label><label>اسم المستخدم<input required dir="ltr" disabled={!!student} pattern="[a-z0-9_]{3,32}" minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value.toLowerCase())}/><small>حروف إنجليزية صغيرة وأرقام وشرطة سفلية، من 3 إلى 32 حرفًا.</small></label>{!student && <label>كلمة المرور الأولى<input required dir="ltr" minLength={6} maxLength={128} autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)}/><small>احتفظ بها لتسليمها للطالب بعد نجاح الإنشاء.</small></label>}<button className="primary" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ الطالب'}</button></form></Modal>;
}
export function DayForm({ day, busy, onSave, onClose }: {
    day?: Day;
    busy: boolean;
    onSave: (label: string, date: string, deadline: string) => Promise<void>;
    onClose: () => void;
}) { const [label, setLabel] = useState(day?.label || ''), [date, setDate] = useState(day?.date || ''), [deadline, setDeadline] = useState(day?.discipline_deadline?.slice(0,5) || ''); return <Modal title={day ? 'تعديل اليوم' : 'إضافة يوم دراسة'} description="ممكن تسيب التاريخ فاضي وتحدده قبل مسح الحضور." onClose={onClose}><form onSubmit={e => { e.preventDefault(); void onSave(label, date, deadline); }}><label>اسم اليوم<input required maxLength={100} value={label} onChange={e => setLabel(e.target.value)}/></label><label>التاريخ<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><label>آخر موعد لدرجة الالتزام — توقيت القاهرة<input type="time" value={deadline} onChange={e => setDeadline(e.target.value)}/><small>المسح في نفس التاريخ حتى الموعد يمنح درجة الالتزام كاملة. بعده حضور فقط. تركه فارغًا يلغي الالتزام التلقائي.</small></label><button className="primary" disabled={busy}>حفظ اليوم</button></form></Modal>; }
export function EvaluationForm({ record, config, busy, onSave }: {
    record?: Evaluation;
    config: ScoreConfig;
    busy: boolean;
    onSave: (present: boolean, scores: Evaluation['scores'], notes: string, version: number, next: boolean) => Promise<Evaluation>;
}) {
    const [version, setVersion] = useState(record?.version || 0), [present, setPresent] = useState(record?.present && !record.deleted_at || false), [scores, setScores] = useState(record && !record.deleted_at ? record.scores : {}), [notes, setNotes] = useState(record?.notes || '');
    return <form onSubmit={async (e) => { e.preventDefault(); const next = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'next'; try {
        const row = await onSave(present, scores, notes, version, next);
        setVersion(row.version);
    }
    catch { } }}><div className="attendance-switch"><label htmlFor="present">حضور اليوم <small>{config.daily_max.attendance} درجة عند الحضور</small></label><Switch id="present" dir="ltr" checked={present} onCheckedChange={setPresent}/></div><div className="grade-inputs">{categories.map(([key, label]) => <label key={key}>{label}<div className="score-input"><input type="number" min="0" max={config.daily_max[key]} step="any" value={scores[key] ?? ''} onChange={e => setScores({ ...scores, [key]: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="0"/><span>/ {config.daily_max[key]}</span></div></label>)}</div><details><summary>ملاحظة للطالب</summary><label>ملاحظات<textarea rows={2} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></label></details><div className="actions wrap"><button disabled={busy} className="primary" value="save">حفظ تقييم اليوم</button><button disabled={busy} className="secondary" value="next">حفظ والتالي</button></div></form>;
}
export function SettingsForm({ settings, busy, onSave }: {
    settings: Settings;
    busy: boolean;
    onSave: (s: Settings) => Promise<void>;
}) {
    const [draft, setDraft] = useState(settings), [fileError, setFileError] = useState('');
    return <form onSubmit={e => { e.preventDefault(); void onSave(draft); }}><label>اسم الدراسة<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label>الشعار النصي<input maxLength={250} value={draft.slogan} onChange={e => setDraft({ ...draft, slogan: e.target.value })}/></label><label>الآية<textarea maxLength={1000} rows={3} value={draft.verse} onChange={e => setDraft({ ...draft, verse: e.target.value })}/></label><label>اللوجو<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            if (file.size > 250000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                setFileError('اختر صورة PNG أو JPG أو WebP بحجم أقل من 250 كيلوبايت.');
                return;
            }
            const src = await new Promise<string>((res, rej) => { const reader = new FileReader(); reader.onload = () => res(String(reader.result)); reader.onerror = rej; reader.readAsDataURL(file); });
            setDraft({ ...draft, logo: src });
            setFileError('');
        }}/></label>{fileError && <p className="error">{fileError}</p>}{draft.logo && <div className="actions"><img src={draft.logo} className="logo-preview" alt="اللوجو الحالي"/><button type="button" className="secondary" onClick={() => setDraft({ ...draft, logo: '' })}>إزالة اللوجو</button></div>}<button className="primary" disabled={busy}>حفظ الإعدادات</button></form>;
}
