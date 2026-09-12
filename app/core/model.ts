export const categories = [['discipline', 'الالتزام'], ['bible', 'الكتاب المقدس'], ['devotion', 'الخلوات'], ['memory', 'الحفظ اليومي'], ['phone', 'الموبايل'], ['hymns', 'الترانيم'], ['games', 'الألعاب'], ['quiz', 'الكويز']] as const;
export const dailyCategories = [['attendance', 'الحضور'], ...categories] as const;
export type ScoreKey = typeof categories[number][0];
export type DailyKey = typeof dailyCategories[number][0];
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
    status: 'pending' | 'active' | 'rejected';
};
export type Day = Base & {
    label: string;
    date: string | null;
    discipline_deadline?: string | null;
};
export type Evaluation = Base & {
    student_id: string;
    day_id: string;
    present: boolean;
    attended_at: string | null;
    scores: Partial<Record<ScoreKey, number>>;
    notes: string;
};
export type Part = {
    id: string;
    label: string;
    max: number;
};
export type ScoreConfig = {
    daily_max: Record<DailyKey, number>;
    daily_target: number;
    parts: Part[];
    parts_target: number;
    competition_max: number;
    competition_target: number;
    project_max: number;
    project_target: number;
};
export type Grading = {
    id: number;
    config: ScoreConfig;
    results_published: boolean;
    competition_published?: boolean;
    project_published?: boolean;
    version: number;
    updated_at: string;
};
export type FinalScore = Base & {
    student_id: string;
    part_scores: Record<string, number>;
    competition: number;
    project: number;
    notes: string;
};
export type Result = {
    student_id: string;
    daily: number;
    parts: number;
    competition: number;
    project: number;
    points: number;
    max: number;
    rank: number;
    participants: number;
};
export type Settings = {
    id: number;
    name: string;
    slogan: string;
    login_tagline?: string;
    login_title?: string;
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
    finals: FinalScore[];
    grading: Grading;
    results: Result[];
    settings: Settings;
    audit: Audit[];
    admin: boolean;
    owner?: boolean;
};
export const defaultSettings: Settings = { id: 1, name: 'مدرستنا', slogan: '', verse: '', logo: '', version: 1, updated_at: '' };
export const defaultConfig: ScoreConfig = { daily_max: { attendance: 10, discipline: 10, bible: 10, devotion: 10, memory: 10, phone: 10, hymns: 10, games: 10, quiz: 10 }, daily_target: 200, parts: [{ id: 'part_1', label: 'الجزء 1', max: 100 }, { id: 'part_2', label: 'الجزء 2', max: 100 }, { id: 'part_3', label: 'الجزء 3', max: 100 }], parts_target: 200, competition_max: 100, competition_target: 200, project_max: 100, project_target: 200 };
export const defaultGrading: Grading = { id: 1, config: defaultConfig, results_published: false, version: 1, updated_at: '' };
export const emptyData: Data = { students: [], days: [], evaluations: [], finals: [], grading: defaultGrading, results: [], settings: defaultSettings, audit: [], admin: false };
export const active = (s: Student) => !s.deleted_at && s.status === 'active';
export const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const factor = (earned: number, max: number, target: number) => max > 0 ? earned / max * target : 0;
export const dailyMax = (c: ScoreConfig) => dailyCategories.reduce((n, [k]) => n + c.daily_max[k], 0);
export const resultMax = (c: ScoreConfig) => c.daily_target + c.parts_target + c.competition_target + c.project_target;
export function total(e: Evaluation | undefined, c = defaultConfig) { return !e || e.deleted_at ? 0 : (e.present ? c.daily_max.attendance : 0) + categories.reduce((n, [k]) => n + (e.scores[k] ?? 0), 0); }
export function summary(s: Student, data: Data) { const c = data.grading?.config || defaultConfig; const days = data.days.filter(d => !d.deleted_at); const rows = data.evaluations.filter(e => e.student_id === s.id && !e.deleted_at && days.some(d => d.id === e.day_id)); const f = data.finals?.find(f => f.student_id === s.id && !f.deleted_at); const dailyRaw = rows.reduce((n, e) => n + total(e, c), 0); const daily = factor(dailyRaw, days.length * dailyMax(c), c.daily_target); const parts = factor(c.parts.reduce((n, p) => n + (f?.part_scores[p.id] || 0), 0), c.parts.reduce((n, p) => n + p.max, 0), c.parts_target); const competition = factor(f?.competition || 0, c.competition_max, c.competition_target), project = factor(f?.project || 0, c.project_max, c.project_target); const points = round(daily + parts + competition + project), max = resultMax(c); return { daily: round(daily), parts: round(parts), competition: round(competition), project: round(project), points, max, percent: max ? round(points / max * 100) : 0, present: rows.filter(e => e.present).length, days: days.length, dailyRaw }; }
export function rankings(data: Data): Result[] { const list = data.students.filter(active).map(s => ({ student_id: s.id, ...summary(s, data) })).sort((a, b) => b.points - a.points || a.student_id.localeCompare(b.student_id)); return list.map((r, i) => ({ ...r, rank: list.findIndex(other => other.points === r.points) + 1, participants: list.length })); }
export function validConfig(c: ScoreConfig) {
    if (!c || !c.daily_max || Object.keys(c.daily_max).length !== 9 || !Array.isArray(c.parts) || c.parts.length < 1 || c.parts.length > 100) return false;
    const positive = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1000000;
    return dailyCategories.every(([k]) => positive(c.daily_max[k]))
        && ['daily_target', 'parts_target', 'competition_target', 'project_target', 'competition_max', 'project_max'].every(k => positive(c[k as keyof ScoreConfig]))
        && c.parts.every(p => !!p && typeof p.id === 'string' && typeof p.label === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.id) && p.label.trim().length > 0 && p.label.trim().length <= 100 && positive(p.max))
        && new Set(c.parts.map(p => p.id)).size === c.parts.length;
}
export function localDate() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
export function parseQr(value: string) { const m = /^madrasetna:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value.trim()); if (!m)
    throw Error('INVALID_QR'); return m[1]; }
export function validStudent(name: string, phone: string, username: string) { return name.trim().length >= 2 && name.length <= 100 && /^\+?[0-9]{8,15}$/.test(phone) && /^[a-z0-9_]{3,32}$/.test(username); }
export function password() { return 'M!' + crypto.randomUUID().replaceAll('-', '').slice(0, 14); }
export function safeError(error: unknown) { const s = error instanceof Error ? error.message : String((error as {
    message?: string;
})?.message || error); const messages: Record<string, string> = { BINARY_DAILY: 'التقييم اليومي لازم يكون 0 أو 10، ما عدا الكويز.', CONFIG_BELOW_EXISTING: 'فيه درجات مسجلة أعلى من النهاية الجديدة أو جزء عليه درجات. راجع الدرجات قبل تقليل النهاية أو حذف الجزء.', INVALID_CONFIG: 'راجع نهايات الدرجات وأجزاء الحفظ. كل نهاية لازم تكون أكبر من صفر.', SCORE_OUT_OF_RANGE: 'الدرجة خارج النهاية المحددة في نظام الدرجات.', CONFLICT_REFRESH: 'البيانات اتغيرت عند أدمن تاني. حدّث الصفحة وراجع التعديل قبل الحفظ.', INVALID_QR: 'الرمز غير صالح أو حساب الطالب غير مفعل.', DAY_NEEDS_DATE: 'حدد يوم دراسة له تاريخ أولًا.', DAY_NOT_FOUND: 'اليوم محذوف أو غير موجود.', STUDENT_NOT_FOUND: 'الطالب غير مفعل أو محذوف.', ADMIN_REQUIRED: 'الحساب ده لا يملك صلاحيات الأدمن.', USERNAME_EXISTS_OR_INVALID: 'اسم المستخدم مستخدم بالفعل أو غير صالح.', OWNER_REQUIRED: 'تغيير كلمات مرور الآخرين وإدارة المشرفين للأدمن الرئيسي فقط.', ACCOUNT_NOT_FOUND: 'الحساب غير موجود. أنشئ حساب المشرف أولًا.', OWNER_PROTECTED: 'لا يمكن إزالة الأدمن الرئيسي.', PASSWORD_LENGTH: 'كلمة المرور لازم تكون من 6 إلى 128 حرف.', PASSWORD_RESET_FAILED: 'تعذر تغيير كلمة المرور.', PROFILE_CREATE_FAILED: 'تعذر إنشاء بيانات الطالب. راجع الاسم والموبايل.', INVALID_STUDENT: 'راجع الاسم والموبايل واسم المستخدم.', NO_PREVIOUS_VERSION: 'التعديل ده ملوش نسخة سابقة.', UNAUTHORIZED: 'الجلسة انتهت. سجل الدخول من جديد.', REQUEST_FAILED: 'تعذر تنفيذ الطلب. راجع الاتصال وإعداد الخادم.' }; for (const [k, v] of Object.entries(messages))
    if (s.includes(k))
        return v; if (s.includes('Invalid login'))
    return 'اسم المستخدم أو كلمة المرور غير صحيحة.'; if (s.includes('23505') || s.includes('duplicate key') || s.includes('User already registered'))
    return 'اسم المستخدم أو السجل موجود بالفعل.'; if (s.includes('check constraint'))
    return 'فيه قيمة غير صالحة. راجع حدود الدرجات والبيانات.'; if (s.includes('Failed to fetch') || s.includes('fetch'))
    return 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول تاني.'; return 'تعذر إتمام العملية. راجع إعداد الاتصال وحاول تاني.'; }
