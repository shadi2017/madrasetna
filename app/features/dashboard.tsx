import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Check, ClipboardList, FileSpreadsheet, GraduationCap, Plus, QrCode, Sparkles, TrendingUp, UserCheck, Users, AlertTriangle, Clock3 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Data, Student, contentText } from '../core/model';
import { allCategoryAverages, attentionStudents, attendanceTrend, cairoTime, dashboardMetrics, maxTotal, recentEvaluations, resultComposition, scoreDistribution, topStudents } from '../core/analytics';

type DashboardProps = {
    data: Data;
    onNavigate: (view: string) => void;
    onOpenStudent: (student: Student) => void;
    onAddStudent: () => void;
    onScan: () => void;
};

const palette = ['#168168', '#2f637e', '#d69e2e', '#b45b6b', '#6b7fd7'];

function arDate(date: string | null) {
    return date ? new Date(date.length === 10 ? date + 'T12:00:00' : date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'بدون تاريخ';
}

function greeting() {
    const hour = Number(cairoTime().slice(0, 2));
    if (hour < 12)
        return 'صباح الخير';
    if (hour < 17)
        return 'مساء الخير';
    return 'مساء الخير';
}

function Kpi({ label, value, hint, icon, tone = 'teal', progress }: { label: string; value: ReactNode; hint: ReactNode; icon: ReactNode; tone?: string; progress?: number }) {
    return <section className={'kpi-card kpi-' + tone}><div className="kpi-top"><span className="kpi-icon">{icon}</span><span className="kpi-label">{label}</span></div><strong className="kpi-value">{value}</strong><span className="kpi-hint">{hint}</span>{progress !== undefined && <Progress value={Math.max(0, Math.min(100, progress))} aria-label={label}/>}</section>;
}

export function Dashboard({ data, onNavigate, onOpenStudent, onAddStudent, onScan }: DashboardProps) {
    const metrics = useMemo(() => dashboardMetrics(data), [data]);
    const trend = useMemo(() => attendanceTrend(data, 10), [data]);
    const categoryRows = useMemo(() => allCategoryAverages(data), [data]);
    const composition = useMemo(() => resultComposition(data), [data]);
    const distribution = useMemo(() => scoreDistribution(data), [data]);
    const leaders = useMemo(() => topStudents(data, 5), [data]);
    const attention = useMemo(() => attentionStudents(data, 5), [data]);
    const recent = useMemo(() => recentEvaluations(data, 5), [data]);
    const pending = data.students.filter(s => !s.deleted_at && s.status === 'pending');
    const today = metrics.today;
    const total = maxTotal(data);
    let cursor = 0;
    const gradient = distribution.map((bucket, index) => {
        const start = cursor;
        cursor += bucket.percent;
        return `${palette[index % palette.length]} ${start}% ${cursor}%`;
    });
    const donutBackground = distribution.some(bucket => bucket.count) ? `conic-gradient(${gradient.join(', ')})` : '#e6eef1';
    return <div className="dashboard">
        <section className="dash-hero">
            <div className="dash-hero-copy">
                <span className="eyebrow">{greeting()} · {greeting() === 'صباح الخير' ? 'بداية يوم جديد' : 'متابعة آخر اليوم'}</span>
                <h1>{contentText(data.settings, 'dashboard_title', (data.settings.name || 'مدرستنا') + ' في صورة واحدة.')}</h1>
                <p>{contentText(data.settings, 'dashboard_subtitle', 'نظرة على الحضور والتقدم في الدراسة.')}</p>
                <p className="dash-date">{today ? <><CalendarDays size={16}/> {today.label} · {arDate(today.date)}</> : 'ابدأ بإضافة أيام الدراسة والطلاب لعرض التحليلات.'}</p>
                <div className="dash-hero-meta">{contentText(data.settings, 'academic_year', '') && <span className="status-pill muted"><GraduationCap size={14}/>{contentText(data.settings, 'academic_year', '')}</span>}<span className={'status-pill ' + (metrics.published ? 'ok' : 'muted')}><Check size={14}/>{metrics.published ? 'النتيجة معلنة للطلاب' : 'النتيجة مخفية عن الطلاب'}</span><span className="status-pill muted"><Users size={14}/>{metrics.students} طالب نشط</span>{pending.length > 0 && <span className="status-pill warn"><Clock3 size={14}/>{pending.length} طلب بانتظارك</span>}</div>
            </div>
            <div className="dash-hero-actions">
                <button className="primary" onClick={onScan}><QrCode size={18}/>تسجيل حضور</button>
                <button className="secondary" onClick={onAddStudent}><Plus size={18}/>طالب جديد</button>
                <button className="secondary" onClick={() => onNavigate('excel')}><FileSpreadsheet size={18}/>تصدير Excel</button>
            </div>
        </section>

        <div className="kpi-grid">
            <Kpi label="الطلاب النشطون" value={metrics.students} hint={pending.length ? pending.length + ' طلب بانتظار الموافقة' : 'كل الطلبات تمت مراجعتها'} icon={<Users size={20}/>} tone="teal"/>
            <Kpi label={metrics.today ? 'حضور اليوم' : 'حضور آخر يوم'} value={metrics.todayAttendance.rate + '%'} hint={metrics.todayAttendance.total ? metrics.todayAttendance.present + ' من ' + metrics.todayAttendance.total + ' طالب' : 'لا يوجد يوم محدد'} icon={<Check size={20}/>} tone="blue" progress={metrics.todayAttendance.rate}/>
            <Kpi label="متوسط الدرجات" value={metrics.averagePercent + '%'} hint={metrics.averagePoints + ' من ' + total + ' درجة'} icon={<TrendingUp size={20}/>} tone="gold" progress={metrics.averagePercent}/>
            <Kpi label="أيام الدراسة" value={metrics.days} hint={metrics.evaluations + ' تقييم مسجل'} icon={<CalendarDays size={20}/>} tone="rose"/>
        </div>

        <div className="dash-grid">
            <section className="panel chart-card trend-card">
                <div className="panel-heading"><div><h2>اتجاه الحضور</h2><p className="muted">نسبة الحضور في آخر {trend.length || 0} أيام دراسة</p></div><span className="badge">{metrics.overallAttendance}% إجمالي</span></div>
                {trend.length ? <div className="trend-chart" role="img" aria-label="رسم بياني لنسبة الحضور في أيام الدراسة">
                    {trend.map(point => <div className="trend-col" key={point.id} title={point.label + ': ' + point.present + ' من ' + point.total + ' (' + point.rate + '%)'}>
                        <span className="trend-rate">{point.rate}%</span>
                        <div className="trend-bar-wrap"><div className="trend-bar" style={{ height: Math.max(4, point.rate) + '%' }}/></div>
                        <b>{point.label}</b>
                        <small>{point.present}/{point.total}</small>
                    </div>)}
                </div> : <div className="chart-empty">أضف أيام دراسة وطلاب لعرض اتجاه الحضور.</div>}
            </section>

            <section className="panel chart-card">
                <div className="panel-heading"><div><h2>توزيع المستوى</h2><p className="muted">نسبة الطلاب في كل شريحة من المجموع</p></div><GraduationCap size={22} className="feature-icon"/></div>
                <div className="donut-layout">
                    <div className="donut" style={{ background: donutBackground }}><div className="donut-center"><b>{metrics.students}</b><span>طالب</span></div></div>
                    <ul className="legend">{distribution.map((bucket, index) => <li key={bucket.label}><i style={{ background: palette[index % palette.length] }}/><span>{bucket.label}</span><b>{bucket.count}</b><small>{bucket.percent}%</small></li>)}</ul>
                </div>
            </section>

            <section className="panel chart-card">
                <div className="panel-heading"><div><h2>مكونات الدرجة</h2><p className="muted">متوسط ما حصله الطلاب في كل مجموعة</p></div><span className="badge">{total} درجة</span></div>
                <div className="composition-list">{composition.map((row, index) => <div className="composition-row" key={row.key}><div className="composition-head"><span><i style={{ background: palette[index % palette.length] }}/>{row.label}</span><b>{row.value} <small>/ {row.target}</small></b></div><Progress value={row.percent} aria-label={row.label}/><small>{row.percent}% من النهاية</small></div>)}</div>
            </section>

            <section className="panel chart-card">
                <div className="panel-heading"><div><h2>أداء البنود اليومية</h2><p className="muted">متوسط الدرجة كنسبة من النهاية</p></div><ClipboardList size={22} className="feature-icon"/></div>
                <div className="category-list">{categoryRows.map((row, index) => <div className="category-row" key={row.key}><div className="category-head"><span>{row.label}</span><b>{row.percent}%</b></div><div className="category-track"><div className="category-fill" style={{ width: Math.max(0, Math.min(100, row.percent)) + '%', background: palette[index % palette.length] }}/></div><small>{row.average} من {row.max}</small></div>)}</div>
            </section>

            <section className="panel chart-card leaderboard-card">
                <div className="panel-heading"><div><h2>أفضل الطلاب</h2><p className="muted">حسب المجموع النهائي الحالي</p></div><Sparkles size={22} className="feature-icon"/></div>
                {leaders.length ? <div className="leaderboard">{leaders.map((row, index) => <button className="leader-row" key={row.student.id} onClick={() => onOpenStudent(row.student)}><span className={'leader-rank rank-' + (index + 1)}>{index + 1}</span><span className="avatar">{row.student.full_name[0]}</span><span className="leader-info"><b>{row.student.full_name}</b><small>{row.present} يوم حضور · {row.attendanceRate}%</small></span><strong>{row.points}<small> / {row.max}</small></strong></button>)}{!leaders.length && <div className="chart-empty">لا يوجد طلاب نشطون بعد.</div>}</div> : <div className="chart-empty">أضف أول طالب لعرض الترتيب.</div>}
                <button className="text-button" onClick={() => onNavigate('students')}>كل الطلاب <ArrowLeft size={15}/></button>
            </section>

            <section className="panel chart-card attention-card">
                <div className="panel-heading"><div><h2>محتاجين متابعة</h2><p className="muted">حضور أقل من 50% أو مستوى أقل من 40%</p></div><AlertTriangle size={22} className="feature-icon warn"/></div>
                {attention.length ? <div className="insight-list">{attention.map(row => <button className="insight-row" key={row.student.id} onClick={() => onOpenStudent(row.student)}><span className="avatar">{row.student.full_name[0]}</span><span className="insight-info"><b>{row.student.full_name}</b><small>{row.reasons.join(' · ')}</small></span><span className="insight-values"><b>{row.percent}%</b><small>{row.attendanceRate}% حضور</small></span></button>)}</div> : <div className="chart-empty good"><Check size={26}/>كل الطلاب في نطاق آمن حاليًا.</div>}
            </section>

            {pending.length > 0 && <section className="panel chart-card pending-panel"><div className="panel-heading"><div><h2>طلبات تسجيل جديدة</h2><p className="muted">بانتظار قرارك</p></div><UserCheck size={22} className="feature-icon"/></div><div className="pending-list">{pending.slice(0, 4).map(student => <div className="pending-row" key={student.id}><span className="avatar">{student.full_name[0]}</span><span><b>{student.full_name}</b><small dir="ltr">@{student.username}</small></span></div>)}{pending.length > 4 && <small>+{pending.length - 4} طلب آخر</small>}</div><button className="primary" onClick={() => onNavigate('approvals')}>مراجعة الطلبات <ArrowLeft size={16}/></button></section>}

            <section className="panel chart-card recent-card"><div className="panel-heading"><div><h2>آخر التقييمات</h2><p className="muted">أحدث ما تم تسجيله</p></div><ClipboardList size={22} className="feature-icon"/></div>{recent.length ? <div className="recent-list">{recent.map(({ evaluation, student, day }) => <div className="recent-row" key={evaluation.id}><span className={'status-dot ' + (evaluation.present ? 'ok' : 'muted')}/><span><b>{student?.full_name || 'طالب'}</b><small>{day?.label || 'يوم'} · {evaluation.present ? 'حاضر' : 'غائب'}</small></span><small>{evaluation.updated_at ? new Date(evaluation.updated_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}</small></div>)}{!recent.length && <div className="chart-empty">لسه مفيش تقييمات مسجلة.</div>}</div> : <div className="chart-empty">لسه مفيش تقييمات مسجلة.</div>}</section>
        </div>
    </div>;
}
