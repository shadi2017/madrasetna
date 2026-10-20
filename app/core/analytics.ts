import { active, categories, resultMax, round, summary } from './model.ts';
import type { Data, Day } from './model.ts';

export type AttendancePoint = {
    id: string;
    label: string;
    date: string | null;
    present: number;
    absent: number;
    total: number;
    rate: number;
};

export type CategoryAverage = {
    key: string;
    label: string;
    max: number;
    average: number;
    percent: number;
};

export type DistributionBucket = {
    label: string;
    min: number;
    max: number;
    count: number;
    percent: number;
};

export type StudentInsight = {
    student: Data['students'][number];
    points: number;
    max: number;
    percent: number;
    attendanceRate: number;
    present: number;
    days: number;
    reasons: string[];
};

export type DashboardMetrics = {
    students: number;
    requests: number;
    days: number;
    evaluations: number;
    today?: Day;
    todayAttendance: AttendancePoint;
    overallAttendance: number;
    averagePoints: number;
    averagePercent: number;
    published: boolean;
    competitionPublished: boolean;
    projectPublished: boolean;
};

const cairoDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const cairoTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false });

export function liveDays(data: Data): Day[] {
    return data.days.filter(d => !d.deleted_at).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.label.localeCompare(b.label, 'ar', { numeric: true }));
}

export function liveStudents(data: Data) {
    return data.students.filter(active);
}

export function cairoDate(date = new Date()) {
    return cairoDateFormatter.format(date);
}

export function cairoDateOffset(days: number, base = new Date()) {
    const parts = cairoDateFormatter.formatToParts(base);
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value || 0);
    const shifted = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + days, 12));
    return cairoDateFormatter.format(shifted);
}

export function cairoTime(date = new Date()) {
    const value = cairoTimeFormatter.format(date);
    return value === '24:00' ? '00:00' : value;
}

export function dayForDate(days: Day[], date: string | null) {
    return date ? days.find(d => d.date === date) : undefined;
}

export function attendanceForDay(data: Data, day?: Day): AttendancePoint {
    const students = liveStudents(data);
    const marked = day ? data.evaluations.filter(e => e.day_id === day.id && e.present && !e.deleted_at && students.some(s => s.id === e.student_id)) : [];
    const present = marked.length;
    const total = students.length;
    return {
        id: day?.id || '',
        label: day?.label || 'بدون يوم',
        date: day?.date || null,
        present,
        absent: Math.max(0, total - present),
        total,
        rate: total ? round(present / total * 100) : 0,
    };
}

export function attendanceTrend(data: Data, limit = 8): AttendancePoint[] {
    const days = liveDays(data);
    return days.slice(Math.max(0, days.length - Math.max(1, limit))).map(day => attendanceForDay(data, day));
}

export function overallAttendance(data: Data) {
    const students = liveStudents(data).length;
    const days = liveDays(data).length;
    if (!students || !days)
        return 0;
    const dayIds = new Set(liveDays(data).map(d => d.id));
    const present = data.evaluations.filter(e => e.present && !e.deleted_at && dayIds.has(e.day_id) && liveStudents(data).some(s => s.id === e.student_id)).length;
    return round(present / (students * days) * 100);
}

export function categoryAverages(data: Data): CategoryAverage[] {
    const students = liveStudents(data);
    const days = liveDays(data);
    if (!students.length || !days.length)
        return categories.map(([key, label]) => ({ key, label, max: data.grading.config.daily_max[key] || 0, average: 0, percent: 0 }));
    const dayIds = new Set(days.map(d => d.id));
    const studentIds = new Set(students.map(s => s.id));
    const rows = data.evaluations.filter(e => !e.deleted_at && dayIds.has(e.day_id) && studentIds.has(e.student_id));
    return categories.map(([key, label]) => {
        const max = data.grading.config.daily_max[key] || 0;
        const total = rows.reduce((sum, row) => sum + (row.scores[key] || 0), 0);
        const average = round(total / (students.length * days.length));
        return { key, label, max, average, percent: max ? round(average / max * 100) : 0 };
    });
}

export function attendanceCategoryAverage(data: Data): CategoryAverage {
    const max = data.grading.config.daily_max.attendance || 0;
    const rate = overallAttendance(data);
    return { key: 'attendance', label: 'الحضور', max, average: round(max * rate / 100), percent: rate };
}

export function allCategoryAverages(data: Data): CategoryAverage[] {
    return [attendanceCategoryAverage(data), ...categoryAverages(data)];
}

export function resultComposition(data: Data) {
    const students = liveStudents(data);
    const config = data.grading.config;
    const totals = { daily: 0, parts: 0, competition: 0, project: 0 };
    const rows = students.map(student => summary(student, data));
    for (const row of rows) {
        totals.daily += row.daily;
        totals.parts += row.parts;
        totals.competition += row.competition;
        totals.project += row.project;
    }
    const count = Math.max(1, students.length);
    return [
        { key: 'daily', label: 'التقييم اليومي', value: round(totals.daily / count), target: config.daily_target, percent: config.daily_target ? round(totals.daily / count / config.daily_target * 100) : 0 },
        { key: 'parts', label: 'أجزاء الحفظ', value: round(totals.parts / count), target: config.parts_target, percent: config.parts_target ? round(totals.parts / count / config.parts_target * 100) : 0 },
        { key: 'competition', label: 'المسابقة', value: round(totals.competition / count), target: config.competition_target, percent: config.competition_target ? round(totals.competition / count / config.competition_target * 100) : 0 },
        { key: 'project', label: 'المشروع', value: round(totals.project / count), target: config.project_target, percent: config.project_target ? round(totals.project / count / config.project_target * 100) : 0 },
    ];
}

export function scoreDistribution(data: Data): DistributionBucket[] {
    const students = liveStudents(data);
    const buckets: DistributionBucket[] = [
        { label: 'أقل من 20%', min: 0, max: 20, count: 0, percent: 0 },
        { label: '20% – 40%', min: 20, max: 40, count: 0, percent: 0 },
        { label: '40% – 60%', min: 40, max: 60, count: 0, percent: 0 },
        { label: '60% – 80%', min: 60, max: 80, count: 0, percent: 0 },
        { label: '80% – 100%', min: 80, max: 100, count: 0, percent: 0 },
    ];
    for (const student of students) {
        const row = summary(student, data);
        const percent = row.max ? row.points / row.max * 100 : 0;
        const index = Math.min(buckets.length - 1, Math.max(0, Math.floor(percent / 20)));
        buckets[index].count++;
    }
    return buckets.map(bucket => ({ ...bucket, percent: students.length ? round(bucket.count / students.length * 100) : 0 }));
}

export function topStudents(data: Data, limit = 5) {
    const days = liveDays(data);
    const dayIds = new Set(days.map(d => d.id));
    return liveStudents(data).map(student => {
        const row = summary(student, data);
        const present = data.evaluations.filter(e => e.student_id === student.id && e.present && !e.deleted_at && dayIds.has(e.day_id)).length;
        return { student, ...row, present, attendanceRate: days.length ? round(present / days.length * 100) : 0 };
    }).sort((a, b) => b.points - a.points || a.student.full_name.localeCompare(b.student.full_name, 'ar')).slice(0, Math.max(1, limit));
}

export function attentionStudents(data: Data, limit = 6): StudentInsight[] {
    const days = liveDays(data);
    const dayIds = new Set(days.map(d => d.id));
    return liveStudents(data).map(student => {
        const row = summary(student, data);
        const present = data.evaluations.filter(e => e.student_id === student.id && e.present && !e.deleted_at && dayIds.has(e.day_id)).length;
        const attendanceRate = days.length ? round(present / days.length * 100) : 0;
        const percent = row.max ? round(row.points / row.max * 100) : 0;
        const reasons: string[] = [];
        if (attendanceRate < 50)
            reasons.push('حضور منخفض');
        if (percent < 40)
            reasons.push('مستوى درجات منخفض');
        return { student, points: row.points, max: row.max, percent, attendanceRate, present, days: days.length, reasons };
    }).filter(row => row.reasons.length).sort((a, b) => a.percent - b.percent || a.attendanceRate - b.attendanceRate).slice(0, Math.max(1, limit));
}

export function dashboardMetrics(data: Data, now = new Date()): DashboardMetrics {
    const students = liveStudents(data);
    const days = liveDays(data);
    const today = dayForDate(days, cairoDate(now));
    const rows = students.map(student => summary(student, data));
    const averagePoints = students.length ? round(rows.reduce((sum, row) => sum + row.points, 0) / students.length) : 0;
    const averagePercent = students.length ? round(rows.reduce((sum, row) => sum + (row.max ? row.points / row.max * 100 : 0), 0) / students.length) : 0;
    const dayIds = new Set(days.map(d => d.id));
    return {
        students: students.length,
        requests: data.students.filter(s => !s.deleted_at && s.status !== 'active').length,
        days: days.length,
        evaluations: data.evaluations.filter(e => !e.deleted_at && dayIds.has(e.day_id) && students.some(s => s.id === e.student_id)).length,
        today,
        todayAttendance: attendanceForDay(data, today || days[days.length - 1]),
        overallAttendance: overallAttendance(data),
        averagePoints,
        averagePercent,
        published: data.grading.results_published,
        competitionPublished: !!data.grading.competition_published,
        projectPublished: !!data.grading.project_published,
    };
}

export function recentEvaluations(data: Data, limit = 6) {
    const students = liveStudents(data);
    const days = liveDays(data);
    return data.evaluations.filter(e => !e.deleted_at && students.some(s => s.id === e.student_id) && days.some(d => d.id === e.day_id)).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, Math.max(1, limit)).map(evaluation => ({
        evaluation,
        student: students.find(s => s.id === evaluation.student_id),
        day: days.find(d => d.id === evaluation.day_id),
    }));
}

export function maxTotal(data: Data) {
    return resultMax(data.grading.config);
}
