export const categories = [['discipline', 'الالتزام'], ['bible', 'الكتاب المقدس'], ['devotion', 'الخلوة'], ['memory', 'الحفظ'], ['phone', 'الموبايل'], ['hymns', 'الترانيم'], ['games', 'الألعاب'], ['quiz', 'الكويز'], ['competition', 'المسابقة'], ['project', 'المشروع']] as const;
export type ScoreKey = typeof categories[number][0];
export type Base = {
    id: string;
    version: number;
    updated_at: string;
    deleted_at: string | null;
};
export type Student = Base & {
    username: string;
    full_name: string;
    phone: string;
    qr_token: string;
    created_at: string;
};
export type Day = Base & {
    label: string;
    date: string | null;
};
export type Evaluation = Base & {
    student_id: string;
    day_id: string;
    present: boolean;
    attended_at: string | null;
    scores: Partial<Record<ScoreKey, number>>;
    notes: string;
};
export type Settings = {
    id: number;
    name: string;
    slogan: string;
    verse: string;
    logo: string;
    version: number;
    updated_at: string;
};
export type Audit = {
    id: string;
    entity: string;
    record_id: string;
    action: string;
    actor_id: string | null;
    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown> | null;
    created_at: string;
};
export type Data = {
    students: Student[];
    days: Day[];
    evaluations: Evaluation[];
    settings: Settings;
    audit: Audit[];
    admin: boolean;
};
export const defaultSettings: Settings = { id: 1, name: 'مدرستنا', slogan: '', verse: '', logo: '', version: 1, updated_at: '' };
export const emptyData: Data = { students: [], days: [], evaluations: [], settings: defaultSettings, audit: [], admin: false };
export function total(e: Evaluation | undefined) { return !e || e.deleted_at ? 0 : (e.present ? 10 : 0) + categories.reduce((n, [k]) => n + (e.scores[k] ?? 0), 0); }
export function summary(s: Student, data: Data) { const days = data.days.filter(d => !d.deleted_at); const rows = data.evaluations.filter(e => e.student_id === s.id && !e.deleted_at && days.some(d => d.id === e.day_id)); const points = rows.reduce((n, e) => n + total(e), 0); const max = days.length * 110; return { points, max, percent: max ? Math.round(points / max * 100) : 0, present: rows.filter(e => e.present).length, days: days.length }; }
export function localDate() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
export function parseQr(value: string) { const m = /^madrasetna:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value.trim()); if (!m)
    throw Error('INVALID_QR'); return m[1]; }
export function validStudent(name: string, phone: string, username: string) { return name.trim().length >= 2 && name.length <= 100 && /^\+?[0-9]{8,15}$/.test(phone) && /^[a-z0-9_]{3,32}$/.test(username); }
export function password() { return 'M!' + crypto.randomUUID().replaceAll('-', '').slice(0, 14); }
export function safeError(error: unknown) { const s = error instanceof Error ? error.message : String((error as {
    message?: string;
})?.message || error); const messages: Record<string, string> = { CONFLICT_REFRESH: 'البيانات اتغيرت عند أدمن تاني. حدّث الصفحة وراجع التعديل قبل الحفظ.', INVALID_QR: 'الرمز غير صالح أو الطالب غير مسجل.', DAY_NEEDS_DATE: 'حدد يوم دراسة له تاريخ أولًا.', DAY_NOT_FOUND: 'اليوم محذوف أو غير موجود.', STUDENT_NOT_FOUND: 'الطالب محذوف أو غير موجود.', ADMIN_REQUIRED: 'الحساب ده لا يملك صلاحيات الأدمن.', USERNAME_EXISTS_OR_INVALID: 'اسم المستخدم مستخدم بالفعل أو غير صالح.', PASSWORD_LENGTH: 'كلمة المرور لازم تكون من 10 إلى 128 حرف.', PASSWORD_RESET_FAILED: 'تعذر تغيير كلمة المرور.', PROFILE_CREATE_FAILED: 'تعذر إنشاء بيانات الطالب. راجع الاسم والموبايل.', INVALID_STUDENT: 'راجع الاسم والموبايل واسم المستخدم.', NO_PREVIOUS_VERSION: 'التعديل ده ملوش نسخة سابقة.', UNAUTHORIZED: 'الجلسة انتهت. سجل الدخول من جديد.', REQUEST_FAILED: 'تعذر تنفيذ الطلب. راجع الاتصال وإعداد الخادم.' }; for (const [k, v] of Object.entries(messages))
    if (s.includes(k))
        return v; if (s.includes('Invalid login'))
    return 'اسم المستخدم أو كلمة المرور غير صحيحة.'; if (s.includes('23505') || s.includes('duplicate key'))
    return 'السجل موجود بالفعل. راجع التكرار وحدّث البيانات.'; if (s.includes('check constraint'))
    return 'فيه قيمة غير صالحة. الدرجات من صفر إلى 10.'; if (s.includes('Failed to fetch') || s.includes('fetch'))
    return 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول تاني.'; return 'تعذر إتمام العملية. راجع إعداد الاتصال وحاول تاني.'; }
