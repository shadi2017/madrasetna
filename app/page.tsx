import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, QrCode, ShieldCheck, Users, ArrowLeft, LayoutDashboard, CalendarDays, ClipboardList, History, Settings as SettingsIcon, LogOut, Plus, Search, ChevronLeft, Download, FileSpreadsheet, RotateCcw, Trash2, KeyRound, Pencil, RefreshCw, Check, WifiOff, GraduationCap, UserCheck, Calculator } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { supabase, configured } from './core/client';
import { loadData, rpc, account } from './core/api';
import { makeDemo, demoRpc, demoAccount } from './core/demo';
import { Data, Student, Day, Audit, emptyData, defaultSettings, summary, total, categories, localDate, safeError, password } from './core/model';
import { Modal, Picker, Confirm, Empty } from './features/ui';
import { QrCard, Scanner } from './features/qr';
import { StudentForm, DayForm, EvaluationForm, SettingsForm } from './features/forms';
import { GradingForm, FinalScoresForm } from './features/grading';
import { Login, registrationLink, Registration } from './features/auth';
import { StudentProfile } from './features/profile';
import { active, dailyMax, resultMax, Evaluation } from './core/model';
import { ExcelPanel } from './features/excel';
import { AccountPanel, StaffPanel } from './features/account';
type View = 'home' | 'students' | 'scan' | 'grades' | 'days' | 'history' | 'settings' | 'excel' | 'profile' | 'approvals' | 'grading' | 'account' | 'staff';
const nav = [['home', 'نظرة عامة', LayoutDashboard], ['students', 'الطلاب', Users], ['approvals', 'طلبات التسجيل', UserCheck], ['scan', 'تسجيل الحضور', QrCode], ['grades', 'التقييمات', ClipboardList], ['days', 'أيام الدراسة', CalendarDays], ['excel', 'استيراد وتصدير', FileSpreadsheet], ['history', 'السجل والمحذوفات', History], ['grading', 'نظام الدرجات والنتيجة', Calculator], ['settings', 'إعدادات الدراسة', SettingsIcon], ['account', 'حسابي', KeyRound], ['staff', 'المشرفون', ShieldCheck]] as const;
const arDate = (s: string | null) => s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'بدون تاريخ';
export default function App() {
    const [data, setData] = useState<Data>(emptyData), [user, setUser] = useState<string | null>(null), [authReady, setAuthReady] = useState(!configured), [demo, setDemo] = useState(false), [demoStudent, setDemoStudent] = useState(false), [view, setView] = useState<View>('home'), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [online, setOnline] = useState(navigator.onLine), [sync, setSync] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0), [filter, setFilter] = useState('all'), [selectedDay, setSelectedDay] = useState(''), [selectedStudent, setSelectedStudent] = useState('');
    const [demoUserId, setDemoUserId] = useState<string | null>(null);
    const [gradeTab, setGradeTab] = useState("daily");
    const [auditDetail, setAuditDetail] = useState<Audit | null>(null);
    const [editStudent, setEditStudent] = useState<Student | 'new' | null>(null), [editDay, setEditDay] = useState<Day | 'new' | null>(null), [profile, setProfile] = useState<Student | null>(null), [resetStudent, setResetStudent] = useState<Student | null>(null), [newPassword, setNewPassword] = useState(''), [credentials, setCredentials] = useState<{
        username: string;
        password: string;
    } | null>(null), [confirm, setConfirm] = useState<{
        title: string;
        description: string;
        action: () => void;
    } | null>(null);
    const dataRef = useRef(data), request = useRef(0), working = useRef(false);
    dataRef.current = data;
    const update = (d: Data) => { dataRef.current = d; setData(d); };
    useEffect(() => {
        if (!supabase)
            return;
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user.id || null); setAuthReady(true); });
        return () => listener.subscription.unsubscribe();
    }, []);
    useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
    const refresh = useCallback(async () => {
        if (demo || !user)
            return;
        const serial = ++request.current;
        try {
            const next = await loadData();
            if (serial === request.current) {
                setData(next);
                dataRef.current = next;
                setError('');
            }
        }
        catch (e) {
            if (serial === request.current)
                setError(safeError(e));
        }
        finally {
            if (serial === request.current)
                setLoading(false);
        }
    }, [demo, user]);
    useEffect(() => {
        if (!user || demo)
            return;
        setLoading(true);
        void refresh();
        return () => { request.current++; };
    }, [user, demo, refresh]);
    useEffect(() => {
        if (user || !supabase || demo)
            return;
        let alive = true;
        supabase.from('settings').select('*').eq('id', 1).single().then(({ data: s }) => {
            if (alive && s)
                setData(d => ({ ...d, settings: s }));
        });
        return () => { alive = false; };
    }, [user, demo]);
    useEffect(() => {
        if (!user || demo || !supabase)
            return;
        const client = supabase;
        let timer: ReturnType<typeof setTimeout>;
        const channel = client.channel('school-' + user);
        for (const table of ['profiles', 'days', 'evaluations', 'settings', 'grading', 'final_scores', 'results_signal'])
            channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); });
        channel.subscribe(status => setSync(status));
        const fallback = setInterval(() => {
            if (navigator.onLine)
                void refresh();
        }, 30000);
        const focus = () => void refresh();
        window.addEventListener('focus', focus);
        window.addEventListener('online', focus);
        return () => { clearTimeout(timer); clearInterval(fallback); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); void client.removeChannel(channel); };
    }, [user, demo, refresh]);
    const admin = demo ? !demoStudent : data.admin;
    const owner = demo ? !demoStudent : !!data.owner;
    const days = data.days.filter(d => !d.deleted_at).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.label.localeCompare(b.label, 'ar', { numeric: true }));
    const students = data.students.filter(active);
    const requests = data.students.filter(s => !s.deleted_at && s.status !== "active");
    const day = days.find(d => d.id === selectedDay) || days.find(d => d.date === localDate()) || days[0];
    const gradeStudent = students.find(s => s.id === selectedStudent) || students[0];
    const disabled = busy || (!demo && (!online || !!error));
    useEffect(() => {
        const context = (document as unknown as {
            modelContext?: {
                registerTool: (t: unknown, o: unknown) => Promise<void>;
            };
        }).modelContext;
        if (!context || (!user && !demo))
            return;
        const lifecycle = new AbortController();
        void Promise.resolve(context.registerTool({ name: 'show_student_search', title: 'البحث عن طالب', description: 'Open the visible student search. This does not edit records.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 100 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: (input: unknown) => {
                if (!admin)
                    throw Error('ADMIN_REQUIRED');
                const q = (input as {
                    query?: unknown;
                })?.query;
                if (typeof q !== 'string' || q.length > 100)
                    throw Error('INVALID_QUERY');
                setQuery(q);
                setPage(0);
                setView('students');
                return { opened: true, query: q };
            } }, { signal: lifecycle.signal })).catch(() => { });
        return () => lifecycle.abort();
    }, [admin, user, demo]);
    async function mutate(name: string, args: Record<string, unknown>, silent = false) {
        if (working.current)
            throw Error('BUSY');
        if (!demo && !navigator.onLine)
            throw Error('Failed to fetch');
        working.current = true;
        setBusy(true);
        try {
            let result;
            if (demo) {
                const r = demoRpc(dataRef.current, name, args);
                update(r.data);
                result = r.result;
            }
            else {
                result = await rpc(name, args);
                await refresh();
            }
            if (!silent)
                toast.success('تم الحفظ');
            return result;
        }
        catch (e) {
            if (!silent)
                toast.error(safeError(e));
            throw e;
        }
        finally {
            working.current = false;
            setBusy(false);
        }
    }
    async function manage(body: Record<string, unknown>) {
        if (working.current)
            throw Error('BUSY');
        working.current = true;
        setBusy(true);
        try {
            let result;
            if (demo) {
                const r = demoAccount(dataRef.current, body);
                update(r.data);
                result = r.result;
            }
            else {
                result = await account(body);
                await refresh();
            }
            return result;
        }
        finally {
            working.current = false;
            setBusy(false);
        }
    }
    function startDemo(student = false) { setDemoUserId(null); const d = makeDemo(); update(d); setDemo(true); setDemoStudent(student); setView(student ? 'profile' : 'home'); setError(''); }
    function demoRegister(v: Registration) { try {
        const d = makeDemo(), r = demoAccount(d, { action: 'register', ...v });
        update(r.data);
        setDemoUserId(r.result.profile!.id);
        setDemo(true);
        setDemoStudent(true);
        setView('profile');
        setError('');
    }
    catch (e) {
        toast.error(safeError(e));
    } }
    async function logout() {
        request.current++;
        update(emptyData);
        setUser(null);
        setDemo(false);
        setDemoStudent(false);
        setView('home');
        setProfile(null);
        setCredentials(null);
        if (supabase) {
            const { error: e } = await supabase.auth.signOut();
            if (e)
                toast.error('تعذر إنهاء جلسة الخادم. حاول تسجيل الخروج تاني.');
        }
    }
    function navigate(v: View) { setView(v); setQuery(''); setPage(0); }
    function remove(entity: string, row: {
        id: string;
        version: number;
    }, title: string) { setConfirm({ title: 'حذف ' + title + '؟', description: 'هينتقل للمحذوفات وتقدر ترجعه من السجل. البيانات المرتبطة بيه محفوظة.', action: () => void mutate('set_deleted', { p_entity: entity, p_id: row.id, p_deleted: true, p_version: row.version }).catch(() => { }) }); }
    const presence = day ? data.evaluations.filter(e => e.day_id === day.id && e.present && !e.deleted_at && students.some(s => s.id === e.student_id)).length : 0;
    const filtered = students.filter(s => (s.full_name + ' ' + s.phone + ' ' + s.username).toLowerCase().includes(query.toLowerCase())).filter(s => filter === 'all' || (data.evaluations.some(e => e.student_id === s.id && e.day_id === day?.id && e.present && !e.deleted_at)) === (filter === 'present'));
    const studentSelf = demo ? data.students.find(s => s.id === demoUserId) || students[0] : data.students.find(s => s.id === user && !s.deleted_at);
    const statCards = <div className="stats"><Stat label="إجمالي الطلاب" value={students.length} icon={<Users />} hint="طالب مسجل في الدراسة"/><Stat label="الحضور" value={presence} icon={<Check />} hint={day?.label || 'لم يتم تحديد يوم'}/><Stat label="لم يسجلوا الحضور" value={day ? students.length - presence : '—'} icon={<ClipboardList />} hint="في يوم الدراسة المختار"/><Stat label="أيام الدراسة" value={days.length} icon={<CalendarDays />} hint="تحددها من جدول الدراسة"/></div>;
    if (!authReady)
        return <div className="full-loading">جاري التحقق من تسجيل الدخول…</div>;
    if (!user && !demo)
        return <><Login settings={data.settings} onDemo={startDemo} onDemoRegister={demoRegister}/><Toaster dir="rtl" richColors position="top-center"/></>;
    return <><SidebarProvider dir="rtl"><Sidebar side="right"><SidebarHeader><div className="brand sidebar-brand">{data.settings.logo ? <img src={data.settings.logo} alt="لوجو الدراسة"/> : <BookOpen />}<b>{data.settings.name}</b></div><small className="sidebar-subtitle">{admin ? 'مساحة الأدمن' : 'مساحة الطالب'}</small></SidebarHeader><SidebarContent><SidebarMenu>{(admin ? nav.filter(n => n[0] !== 'staff' || owner) : [['profile', 'بروفايلي', GraduationCap] as const]).map(([key, label, Icon]) => <SidebarMenuItem key={key}><SidebarMenuButton onClick={() => navigate(key)} isActive={view === key}><Icon /><span>{label}{key === 'approvals' && requests.some(s => s.status === 'pending') ? ' (' + requests.filter(s => s.status === 'pending').length + ')' : ''}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent><SidebarFooter><div className="sidebar-verse">{data.settings.slogan || 'معًا في كل خطوة'}{data.settings.verse && <small>{data.settings.verse}</small>}</div><button className="logout" onClick={() => void logout()}><LogOut size={18}/>تسجيل الخروج</button></SidebarFooter></Sidebar><SidebarInset><header className="topbar"><div className="actions"><SidebarTrigger /><span>{admin ? 'إدارة الدراسة' : 'بروفايل الطالب'} <ChevronLeft size={14}/> {nav.find(n => n[0] === view)?.[1] || 'بياناتي'}</span></div><div className="actions"><span className={'sync ' + (!online ? 'offline' : '')}>{demo ? 'نسخة تجريبية' : !online ? 'غير متصل' : sync === 'SUBSCRIBED' ? 'تحديث لحظي متصل' : 'إعادة اتصال • تحديث كل 30 ثانية'}</span><button className="icon-button" aria-label="تحديث البيانات" disabled={demo || loading} onClick={() => void refresh()}><RefreshCw size={18}/></button><div className="avatar small">{admin ? 'أ' : studentSelf?.full_name[0] || 'ط'}</div></div></header>
    {demo && <div className="demo-banner">بيانات توضيحية للتجربة فقط. التعديلات هنا مؤقتة، ولا تُحفظ على السحابة.<button onClick={() => { setDemoStudent(!demoStudent); setView(demoStudent ? 'home' : 'profile'); }}>{demoStudent ? 'عرض الأدمن' : 'عرض الطالب'}</button></div>}
    {!online && !demo && <div className="warning" role="status"><WifiOff size={18}/>الاتصال مقطوع. المعروض آخر بيانات تم تحميلها؛ الحفظ ومسح الحضور متوقفان.</div>}
    {error && <div className="error" role="alert">{error}<button className="secondary" onClick={() => void refresh()}>إعادة المحاولة</button></div>}
    <main className="workspace">{loading ? <div className="empty">جاري تحميل البيانات…</div> : !admin && (!studentSelf || studentSelf.status !== 'active') ? <Empty title={studentSelf?.status === 'pending' ? 'طلبك بانتظار التفعيل' : studentSelf?.status === 'rejected' ? 'طلبك لم تتم الموافقة عليه' : 'الحساب غير نشط'}>{studentSelf?.status === 'pending' ? 'تم تسجيل بياناتك. الأدمن هيراجع الطلب ويفعّل حسابك؛ الصفحة هتتحدث تلقائيًا بعد الموافقة.' : 'تواصل مع أدمن الدراسة لمراجعة حسابك.'}</Empty> : <>
        {(view === 'home' && admin) && <><div className="page-heading"><div><span className="eyebrow">متابعة الدراسة</span><h1>كل طالب، وكل خطوة.</h1><p>نظرة على الحضور والتقدم في الدراسة.</p></div><button className="primary" onClick={() => navigate('scan')}><QrCode size={19}/>تسجيل الحضور</button></div><div className="day-bar"><div><CalendarDays size={20}/><b>يوم المتابعة</b></div><Picker label="يوم المتابعة" value={day?.id || ''} onChange={setSelectedDay} options={days.map(d => ({ value: d.id, label: d.label + ' · ' + arDate(d.date) }))}/></div>{statCards}<div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>الطلاب</h2><button className="text-button" onClick={() => navigate('students')}>عرض الكل <ChevronLeft size={16}/></button></div><StudentTable students={students.slice(0, 5)} data={data} day={day} onOpen={setProfile}/>{!students.length && <Empty title="نبدأ بأول طالب"><button className="primary" onClick={() => setEditStudent('new')}>إضافة طالب</button></Empty>}</section><aside className="stack"><section className="quick-scan"><QrCode size={36}/><h2>الحضور في ثانية</h2><p>افتح الكاميرا وامسح كود الطالب لتسجيل حضوره.</p><button className="primary" onClick={() => navigate('scan')}>فتح ماسح QR <ArrowLeft size={18}/></button></section><section className="panel"><h3>حساب الدرجة النهائية</h3><p className="muted">اليومي {data.grading.config.daily_target} + أجزاء الحفظ {data.grading.config.parts_target} + المسابقة {data.grading.config.competition_target} + المشروع {data.grading.config.project_target}. الإجمالي {resultMax(data.grading.config)} درجة.</p><small>كل مجموعة تتحول بالنسبة من نهايتها الأصلية. {data.grading.results_published ? "النتائج معلنة للطلاب." : "النتيجة والترتيب مخفيان عن الطلاب."}</small><button className="text-button" onClick={() => navigate("grading")}>تعديل المعادلة وإعلان النتيجة</button></section></aside></div></>}
        {view === 'students' && admin && <><PageHeading title="الطلاب" subtitle="بيانات الطلاب وحساباتهم، في مكان واحد."/><div className="toolbar"><div className="search-box"><Search size={19}/><input aria-label="البحث عن طالب" placeholder="ابحث بالاسم، الموبايل أو اسم المستخدم…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div><button className="secondary" onClick={() => navigate('excel')}><FileSpreadsheet size={18}/>Excel</button><button className="primary" disabled={disabled} onClick={() => setEditStudent('new')}><Plus size={18}/>إضافة طالب</button></div><div className="day-bar"><span>{filtered.length} طالب</span><div className="actions"><Picker label="اليوم" value={day?.id || ''} onChange={v => { setSelectedDay(v); setPage(0); }} options={days.map(d => ({ value: d.id, label: d.label }))}/><Picker label="فلتر الحضور" value={filter} onChange={v => { setFilter(v); setPage(0); }} options={[{ value: 'all', label: 'كل الطلاب' }, { value: 'present', label: 'حاضر' }, { value: 'absent', label: 'لم يسجل الحضور' }]}/></div></div><section className="panel no-pad"><StudentTable students={filtered.slice(page * 15, page * 15 + 15)} data={data} day={day} onOpen={setProfile}/>{!filtered.length && <Empty title="لا توجد نتائج">جرّب اسمًا مختلفًا أو أضف طالبًا جديدًا.</Empty>}<div className="pagination"><span>صفحة {page + 1} من {Math.max(1, Math.ceil(filtered.length / 15))}</span><div className="actions"><button className="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>السابق</button><button className="secondary" disabled={(page + 1) * 15 >= filtered.length} onClick={() => setPage(p => p + 1)}>التالي</button></div></div></section></>}
        {view === 'scan' && admin && <><PageHeading title="تسجيل الحضور" subtitle="اختر اليوم، وبعدها امسح كود الطالب."/><div className="day-bar"><b>تسجيل الحضور ليوم</b><Picker label="يوم تسجيل الحضور" value={day?.id || ''} onChange={setSelectedDay} options={days.map(d => ({ value: d.id, label: d.label + ' · ' + arDate(d.date) }))}/></div>{!day?.date && <div className="warning">حدد تاريخ اليوم من «أيام الدراسة» قبل تسجيل الحضور.</div>}{day?.date && day.date !== localDate() && <div className="warning">أنت بتسجل حضور يوم {arDate(day.date)}، وهو مختلف عن تاريخ النهارده.</div>}<div className="scan-grid"><Scanner key={day?.id} disabled={disabled || !day?.date} onScan={token => mutate('scan_attendance', { p_token: token, p_day: day?.id }, true)}/><section className="panel"><div className="panel-heading"><h2>حضور اليوم</h2><span className="badge">{presence} طالب</span></div>{data.evaluations.filter(e => e.day_id === day?.id && e.present && !e.deleted_at && students.some(s => s.id === e.student_id)).sort((a, b) => (b.attended_at || '').localeCompare(a.attended_at || '')).map(e => <div className="attendance-row" key={e.id}><div className="avatar">{students.find(s => s.id === e.student_id)?.full_name[0]}</div><b>{students.find(s => s.id === e.student_id)?.full_name}</b><small>{e.attended_at ? new Date(e.attended_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : 'مسجل'}</small></div>)}{!presence && <Empty title="لسه مفيش حضور مسجل">أول طالب هيتضاف هنا بعد مسح رمزه.</Empty>}</section></div></>}
        {view === 'grades' && admin && <><PageHeading title="سجل الدرجات" subtitle="التقييم اليومي سريع، وباقي الدرجات تُسجل مرة واحدة."/><div className="toolbar"><Picker label="الطالب" value={gradeStudent?.id || ''} onChange={setSelectedStudent} options={students.map(s => ({ value: s.id, label: s.full_name }))}/>{gradeTab === 'daily' && <Picker label="اليوم" value={day?.id || ''} onChange={setSelectedDay} options={days.map(d => ({ value: d.id, label: d.label + ' · ' + arDate(d.date) }))}/>}</div><Tabs dir="rtl" value={gradeTab} onValueChange={setGradeTab}><TabsList><TabsTrigger value="daily">التقييم اليومي</TabsTrigger><TabsTrigger value="once">أجزاء الحفظ · المسابقة · المشروع</TabsTrigger></TabsList><TabsContent value="daily">{gradeStudent && day ? <section className="panel form-panel"><div className="panel-heading"><div><h2>{gradeStudent.full_name}</h2><p className="muted">{day.label} · مجموع اليوم الأصلي من {dailyMax(data.grading.config)}</p></div><span className="badge">{students.indexOf(gradeStudent) + 1} / {students.length}</span></div><EvaluationForm key={gradeStudent.id + day.id} config={data.grading.config} record={data.evaluations.find(e => e.student_id === gradeStudent.id && e.day_id === day.id)} busy={disabled} onSave={async (present, scores, notes, version, next) => { const r = await mutate('save_evaluation', { p_student: gradeStudent.id, p_day: day.id, p_present: present, p_scores: scores, p_notes: notes, p_version: version }); if (next) {
            const following = students[students.indexOf(gradeStudent) + 1];
            if (following)
                setSelectedStudent(following.id);
            else
                toast.success('وصلت لآخر طالب');
        } return r as Evaluation; }}/>{data.evaluations.some(e => e.student_id === gradeStudent.id && e.day_id === day.id && !e.deleted_at) && <button className="danger section-gap" disabled={disabled} onClick={() => { const row = data.evaluations.find(e => e.student_id === gradeStudent.id && e.day_id === day.id && !e.deleted_at); if (row)
            remove('evaluations', row, 'تقييم اليوم'); }}><Trash2 size={16}/>حذف تقييم اليوم</button>}</section> : <Empty title="أضف الطلاب وأيام الدراسة أولًا"/>}</TabsContent><TabsContent value="once">{gradeStudent ? <section className="panel form-panel"><h2 className="section-gap">{gradeStudent.full_name}</h2><FinalScoresForm key={gradeStudent.id} record={data.finals.find(f => f.student_id === gradeStudent.id)} config={data.grading.config} busy={disabled} onSave={(parts, competition, project, notes, version) => mutate('save_final_scores', { p_student: gradeStudent.id, p_parts: parts, p_competition: competition, p_project: project, p_notes: notes, p_version: version })}/>{data.finals.some(f => f.student_id === gradeStudent.id && !f.deleted_at) && <button className="danger section-gap" disabled={disabled} onClick={() => { const row = data.finals.find(f => f.student_id === gradeStudent.id && !f.deleted_at); if (row)
            remove('final_scores', row, 'الدرجات المستقلة'); }}>حذف الدرجات المستقلة</button>}</section> : <Empty title="أضف طالبًا أو فعّل طلبات التسجيل أولًا"/>}</TabsContent></Tabs></>}
        {view === 'account' && admin && <AccountPanel demo={demo}/>}
        {view === 'staff' && owner && <StaffPanel demo={demo} onChange={refresh}/>}
        {view === 'grading' && admin && <><PageHeading title="نظام الدرجات وإعلان النتيجة" subtitle="حدد النهايات الأصلية والتحويل، وعدد أجزاء الحفظ."/><div className="form-panel"><GradingForm grading={data.grading} busy={disabled} onSave={async (config, published, version, competitionPublished, projectPublished) => { try {
            await mutate('save_grading_v2', { p_config: config, p_published: published, p_competition_published: competitionPublished, p_project_published: projectPublished, p_version: version });
            setView('home');
        }
        catch { } }}/></div></>}
        {view === 'approvals' && admin && <><PageHeading title="طلبات التسجيل" subtitle="الطالب يسجل بنفسه، وأنت توافق على تفعيل حسابه."/><section className="panel section-gap"><h3>رابط تسجيل الطلاب</h3><div className="actions wrap section-gap"><input aria-label="رابط التسجيل" readOnly dir="ltr" value={registrationLink()}/><button className="secondary" onClick={() => void navigator.clipboard.writeText(registrationLink()).then(() => toast.success('تم نسخ الرابط')).catch(() => toast.error('انسخ الرابط من الخانة مباشرة.'))}>نسخ الرابط</button></div>{demo && <small>الرابط الحالي نسخة تجريبية خاصة؛ التسجيل الحقيقي يحتاج ربط Supabase ونشر الرابط العام.</small>}</section><section className="panel"><div className="panel-heading"><h2>طلبات بانتظار قرارك</h2><span className="badge">{requests.filter(s => s.status === 'pending').length} طلب جديد</span></div>{requests.map(s => <div className="approval-row" key={s.id}><div className="avatar">{s.full_name[0]}</div><div><b>{s.full_name}</b><p dir="ltr">{s.phone} · @{s.username}</p><small>{s.status === 'pending' ? 'بانتظار التفعيل' : 'لم تتم الموافقة'}</small></div><div className="actions wrap"><button className="primary" disabled={disabled} onClick={() => void mutate('set_student_status', { p_id: s.id, p_status: 'active', p_version: s.version }).catch(() => { })}>تفعيل الحساب</button>{s.status === 'pending' && <button className="secondary" disabled={disabled} onClick={() => setConfirm({ title: 'رفض طلب التسجيل؟', description: 'الطالب هيشوف إن طلبه لم تتم الموافقة عليه. تقدر تفعّله لاحقًا.', action: () => void mutate('set_student_status', { p_id: s.id, p_status: 'rejected', p_version: s.version }).catch(() => { }) })}>رفض الطلب</button>}<button className="icon-button danger" disabled={disabled} aria-label={'حذف طلب ' + s.full_name} onClick={() => remove('profiles', s, s.full_name)}><Trash2 size={17}/></button></div></div>)}{!requests.length && <Empty title="كل الطلبات اتراجعت"/>}</section></>}
            {view === 'days' && admin && <><div className="page-heading"><PageHeading title="أيام الدراسة" subtitle="عدد الأيام مفتوح؛ أضف 10 أيام أو المدة اللي تناسبك."/><button className="primary" disabled={disabled} onClick={() => setEditDay('new')}><Plus size={18}/>إضافة يوم</button></div>{!days.length && <div className="notice"><button className="secondary" disabled={disabled} onClick={async () => {
                        try {
                            for (let i = 1; i <= 10; i++)
                                await mutate('save_day', { p_id: null, p_label: 'اليوم ' + i, p_date: null, p_version: 0 }, true);
                            toast.success('تمت إضافة 10 أيام بدون تواريخ');
                        }
                        catch (e) {
                            toast.error(safeError(e));
                        }
                    }}>إضافة 10 أيام بتواريخ مفتوحة</button></div>}<div className="days-grid">{days.map((d, i) => <section className="panel day-card" key={d.id}><span className="day-number">{String(i + 1).padStart(2, '0')}</span><h2>{d.label}</h2><p>{arDate(d.date)}</p><div className="actions"><button className="secondary" disabled={disabled} onClick={() => setEditDay(d)}><Pencil size={16}/>تعديل</button><button className="icon-button danger" aria-label={'حذف ' + d.label} disabled={disabled} onClick={() => remove('days', d, d.label)}><Trash2 size={17}/></button></div></section>)}</div></>}
        {view === 'settings' && admin && <><PageHeading title="إعدادات الدراسة" subtitle="الاسم واللوجو والشعار والآية، زي ما تحبهم."/><section className="panel form-panel"><SettingsForm key={view} settings={data.settings} busy={disabled} onSave={async (s) => { await mutate('save_settings', { p_name: s.name, p_slogan: s.slogan, p_verse: s.verse, p_logo: s.logo, p_version: s.version }).then(() => setView('home')).catch(() => { }); }}/></section></>}
        {view === 'excel' && admin && <><PageHeading title="استيراد وتصدير Excel" subtitle="نزّل البيانات أو راجع ملف Excel قبل استيراده."/><ExcelPanel data={data} busy={disabled} demo={demo} mutate={mutate} account={manage}/></>}
        {view === 'history' && admin && <><PageHeading title="السجل والمحذوفات" subtitle="راجع التعديلات، واسترجع البيانات عند الحاجة."/><Tabs defaultValue="history" dir="rtl"><TabsList><TabsTrigger value="history">سجل التعديلات</TabsTrigger><TabsTrigger value="deleted">المحذوفات</TabsTrigger></TabsList><TabsContent value="history"><section className="panel"><p className="muted section-gap">آخر 200 تعديل. التصدير يشمل السجل الكامل. كلمات المرور لا تُحفظ في السجل.</p>{data.audit.map(a => <div key={a.id} className="history-row"><div className="history-icon"><History size={19}/></div><div><b>{({ create: 'إضافة', update: 'تعديل', delete: 'حذف', restore: 'استرجاع', password_reset: 'تغيير كلمة مرور' } as Record<string, string>)[a.action] || a.action} · {entityLabel(a.entity)}</b><p>{String(a.after_data?.full_name || a.before_data?.full_name || a.after_data?.label || a.before_data?.label || a.after_data?.name || 'سجل بيانات')}</p><small>{new Date(a.created_at).toLocaleString('ar-EG')} · {a.actor_id === user ? 'أنت' : a.actor_id === 'demo-admin' ? 'أدمن تجريبي' : a.actor_id || 'إعداد النظام'}</small></div><div className="actions"><button className="text-button" onClick={() => setAuditDetail(a)}>تفاصيل</button><button className="text-button" onClick={() => {
                        setConfirm({ title: 'استرجاع النسخة السابقة؟', description: 'سيتم استرجاع القيم السابقة مع تسجيل عملية الاسترجاع. راجع تفاصيل التعديل قبل التأكيد.', action: () => {
                                const row = a.entity === 'profiles' ? data.students.find(s => s.id === a.record_id) : a.entity === 'days' ? data.days.find(d => d.id === a.record_id) : a.entity === 'evaluations' ? data.evaluations.find(e => e.id === a.record_id) : a.entity === 'final_scores' ? data.finals.find(f => f.id === a.record_id) : a.entity === 'grading' ? data.grading : data.settings;
                                if (row)
                                    void mutate('restore_revision', { p_audit: a.id, p_version: row.version }).catch(() => { });
                            } });
                    }} disabled={!a.before_data || disabled}><RotateCcw size={15}/>استرجاع السابق</button></div></div>)}{!data.audit.length && <Empty title="مفيش تعديلات لسه"/>}</section></TabsContent><TabsContent value="deleted"><section className="panel">{[...data.students.filter(s => s.deleted_at).map(s => ({ row: s, title: s.full_name, entity: 'profiles' })), ...data.finals.filter(f => f.deleted_at).map(f => ({ row: f, title: (data.students.find(s => s.id === f.student_id)?.full_name || 'طالب') + ' · الدرجات المستقلة', entity: 'final_scores' })), ...data.days.filter(d => d.deleted_at).map(d => ({ row: d, title: d.label, entity: 'days' })), ...data.evaluations.filter(e => e.deleted_at).map(e => ({ row: e, title: (data.students.find(s => s.id === e.student_id)?.full_name || 'طالب') + ' · ' + (data.days.find(d => d.id === e.day_id)?.label || 'يوم'), entity: 'evaluations' }))].map(({ row, title, entity }) => <div className="history-row" key={row.id}><Trash2 /><div><b>{title}</b><p>{entityLabel(entity)} · {arDate(row.deleted_at)}</p></div><button className="secondary" disabled={disabled} onClick={() => void mutate('set_deleted', { p_entity: entity, p_id: row.id, p_deleted: false, p_version: row.version }).catch(() => { })}><RotateCcw size={16}/>استرجاع</button></div>)}{![...data.students, ...data.days, ...data.evaluations, ...data.finals].some(r => r.deleted_at) && <Empty title="المحذوفات فارغة"/>}</section></TabsContent></Tabs></>}
        {!admin && studentSelf && <><PageHeading title={'أهلًا، ' + studentSelf.full_name} subtitle="حضورك وتقييماتك في الدراسة."/><StudentProfile student={studentSelf} showResult={data.grading.results_published} data={{ ...data, admin: false, students: [studentSelf], evaluations: data.evaluations.filter(e => e.student_id === studentSelf.id), finals: data.finals.filter(f => f.student_id === studentSelf.id), results: data.grading.results_published ? data.results.filter(r => r.student_id === studentSelf.id) : [], audit: [] }}/></>}
        </>}</main><footer className="app-footer">{data.settings.name} · كل خطوة بتفرق</footer></SidebarInset></SidebarProvider>
    {admin && editStudent && <StudentForm student={editStudent === 'new' ? undefined : editStudent} busy={disabled} onClose={() => !busy && setEditStudent(null)} onSave={async (v) => {
                try {
                    if (editStudent === 'new') {
                        await manage({ action: 'create', ...v });
                        setCredentials({ username: v.username, password: v.password });
                        toast.success('تم إنشاء حساب الطالب');
                    }
                    else
                        await mutate('save_profile', { p_id: editStudent.id, p_name: v.name, p_phone: v.phone, p_version: editStudent.version });
                    setEditStudent(null);
                }
                catch (e) {
                    toast.error(safeError(e));
                }
            }}/>}
    {admin && editDay && <DayForm day={editDay === 'new' ? undefined : editDay} busy={disabled} onClose={() => !busy && setEditDay(null)} onSave={async (label, date, deadline) => { await mutate('save_day_v2', { p_deadline: deadline || null, p_id: editDay === 'new' ? null : editDay.id, p_label: label, p_date: date || null, p_version: editDay === 'new' ? 0 : editDay.version }).then(() => setEditDay(null)).catch(() => { }); }}/>}
    {admin && profile && <Modal title="بروفايل الطالب" onClose={() => setProfile(null)} wide description="بيانات الطالب وكود الحضور وتفاصيل التقييم."><StudentProfile student={data.students.find(s => s.id === profile.id) || profile} data={data} showResult/><div className="actions wrap"><button className="secondary" disabled={disabled} onClick={() => { setEditStudent(data.students.find(s => s.id === profile.id) || profile); setProfile(null); }}><Pencil size={16}/>تعديل البيانات</button><button className="secondary" disabled={disabled} onClick={() => { setSelectedStudent(profile.id); setProfile(null); setView('grades'); }}>تقييم الطالب</button>{owner && <button className="secondary" disabled={disabled} onClick={() => { setResetStudent(profile); setNewPassword(password()); setProfile(null); }}><KeyRound size={16}/>باسورد جديد</button>}<button className="secondary" disabled={disabled} onClick={() => setConfirm({ title: 'تغيير كود الحضور؟', description: 'الكود القديم هيتوقف عن العمل. الطالب هيستخدم الكود الجديد من بروفايله.', action: () => void mutate('rotate_qr', { p_id: profile.id }).catch(() => { }) })}>تجديد QR</button><button className="danger" disabled={disabled} onClick={() => { remove('profiles', data.students.find(s => s.id === profile.id) || profile, profile.full_name); setProfile(null); }}><Trash2 size={16}/>حذف</button></div></Modal>}
    {admin && resetStudent && <Modal title={'كلمة مرور جديدة · ' + resetStudent.full_name} description="بعد الحفظ، سلّم كلمة المرور الجديدة للطالب بشكل خاص." onClose={() => !busy && setResetStudent(null)}><form onSubmit={async (e) => {
                e.preventDefault();
                try {
                    const r = await manage({ action: 'reset', id: resetStudent.id, password: newPassword });
                    setCredentials({ username: resetStudent.username, password: newPassword });
                    setResetStudent(null);
                    if (r.warning)
                        toast.warning('تم تغيير الباسورد، لكن تعذر تسجيل العملية في السجل.');
                    else
                        toast.success('تم تغيير كلمة المرور');
                }
                catch (e) {
                    toast.error(safeError(e));
                }
            }}><label>كلمة المرور الجديدة<input required minLength={6} maxLength={128} value={newPassword} dir="ltr" autoComplete="new-password" onChange={e => setNewPassword(e.target.value)}/></label><button className="primary" disabled={disabled}>حفظ كلمة المرور</button></form></Modal>}
    {credentials && <Modal title={demo ? 'بيانات حساب تجريبي' : 'بيانات الدخول جاهزة'} description={demo ? 'هذه البيانات توضيحية ولا تنشئ حسابًا حقيقيًا.' : 'احتفظ بكلمة المرور الآن. لن تظهر مرة أخرى بعد إغلاق هذه النافذة.'} onClose={() => setCredentials(null)}><label>اسم المستخدم<input readOnly dir="ltr" value={credentials.username}/></label><label>كلمة المرور<input readOnly dir="ltr" value={credentials.password}/></label><button className="primary" onClick={() => setCredentials(null)}>تم، احتفظت بالبيانات</button></Modal>}
    {auditDetail && <Modal title="تفاصيل التعديل" description="القيم المسجلة قبل العملية وبعدها. كلمات المرور لا تدخل السجل." onClose={() => setAuditDetail(null)} wide><div className="audit-detail"><section><h3>قبل</h3><pre>{JSON.stringify(auditDetail.before_data, (k, v) => k === 'logo' && v ? '[صورة اللوجو]' : v, 2)}</pre></section><section><h3>بعد</h3><pre>{JSON.stringify(auditDetail.after_data, (k, v) => k === 'logo' && v ? '[صورة اللوجو]' : v, 2)}</pre></section></div></Modal>}
    {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)}/>}<Toaster dir="rtl" richColors position="top-center"/></>;
}
function PageHeading({ title, subtitle }: {
    title: string;
    subtitle: string;
}) { return <div className="heading"><h1>{title}</h1><p>{subtitle}</p></div>; }
function Stat({ label, value, icon, hint }: {
    label: string;
    value: number | string;
    icon: React.ReactNode;
    hint: string;
}) { return <section className="stat-card"><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div><div className="stat-icon">{icon}</div></section>; }
function StudentTable({ students, data, day, onOpen }: {
    students: Student[];
    data: Data;
    day?: Day;
    onOpen: (s: Student) => void;
}) { return <Table><TableHeader><TableRow><TableHead>الطالب</TableHead><TableHead>رقم الموبايل</TableHead><TableHead>الحضور</TableHead><TableHead>الدرجة النهائية</TableHead><TableHead>الترتيب</TableHead><TableHead><span className="sr-only">فتح البروفايل</span></TableHead></TableRow></TableHeader><TableBody>{students.map(s => { const sum = summary(s, data), present = data.evaluations.some(e => e.student_id === s.id && e.day_id === day?.id && e.present && !e.deleted_at); return <TableRow key={s.id}><TableCell><button className="student-name" onClick={() => onOpen(s)}><span className="avatar">{s.full_name[0]}</span><span><b>{s.full_name}</b><small dir="ltr">@{s.username}</small></span></button></TableCell><TableCell><span dir="ltr">{s.phone}</span></TableCell><TableCell><span className={'badge ' + (present ? 'success' : 'neutral')}>{!day ? 'بدون يوم' : present ? 'حاضر' : 'لم يسجل'}</span></TableCell><TableCell><b>{sum.points}</b><small className="muted"> / {sum.max}</small></TableCell><TableCell><span className="badge">#{data.results.find(r => r.student_id === s.id)?.rank || "—"}</span></TableCell><TableCell><button className="icon-button" aria-label={'فتح بروفايل ' + s.full_name} onClick={() => onOpen(s)}><ChevronLeft size={18}/></button></TableCell></TableRow>; })}</TableBody></Table>; }
function entityLabel(entity: string) { return ({ profiles: 'طالب', days: 'يوم دراسة', evaluations: 'تقييم', settings: 'إعدادات الدراسة', grading: 'نظام الدرجات', final_scores: 'الدرجات المستقلة' } as Record<string, string>)[entity] || entity; }
