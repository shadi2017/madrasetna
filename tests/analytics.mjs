import assert from 'node:assert/strict';
import { emptyData } from '../app/core/model.ts';
import { allCategoryAverages, attentionStudents, attendanceCategoryAverage, attendanceForDay, attendanceTrend, cairoDate, cairoDateOffset, categoryAverages, dashboardMetrics, liveDays, liveStudents, overallAttendance, recentEvaluations, resultComposition, scoreDistribution, topStudents } from '../app/core/analytics.ts';

const base = id => ({ id, version: 1, updated_at: '2026-01-01T00:00:00Z', deleted_at: null });
const student = (id, name, status = 'active') => ({ ...base(id), username: id, full_name: name, phone: '01000000000', qr_token: id + '-qr', created_at: '2026-01-01T00:00:00Z', status });
const day = (id, label, date) => ({ ...base(id), label, date });
const evaluation = (student_id, day_id, present, scores = {}) => ({ ...base(student_id + '-' + day_id), student_id, day_id, present, attended_at: present ? '2026-01-01T10:00:00Z' : null, scores, notes: '' });

const students = [student('a', 'أحمد'), student('b', 'بطرس'), student('c', 'معلّق', 'pending')];
const days = [day('d1', 'يوم 1', '2026-01-01'), day('d2', 'يوم 2', '2026-01-02'), day('d3', 'يوم 3', '2026-01-03')];
const evaluations = [
  evaluation('a', 'd1', true, { bible: 10, quiz: 8 }),
  evaluation('a', 'd2', true, { bible: 8 }),
  evaluation('a', 'd3', true, { quiz: 9 }),
  evaluation('b', 'd3', true, { bible: 5 }),
];
const data = { ...emptyData, students, days, evaluations, finals: [], audit: [] };

assert.equal(liveDays(data).map(item => item.id).join(','), 'd1,d2,d3');
assert.equal(liveStudents(data).length, 2);
assert.match(cairoDate(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(cairoDateOffset(0, new Date('2026-10-19T10:00:00Z')), '2026-10-19');
assert.equal(cairoDateOffset(-1, new Date('2026-10-19T10:00:00Z')), '2026-10-18');
assert.equal(cairoDateOffset(-1, new Date('2026-01-01T00:30:00+02:00')), '2025-12-31');

const first = attendanceForDay(data, days[0]);
assert.equal(first.present, 1);
assert.equal(first.absent, 1);
assert.equal(first.total, 2);
assert.equal(first.rate, 50);

assert.equal(attendanceForDay(data).total, 2);
assert.equal(attendanceTrend(data, 10).length, 3);
assert.equal(attendanceTrend(data, 2).map(item => item.id).join(','), 'd2,d3');
assert.equal(overallAttendance(data), 66.67);

const cats = categoryAverages(data);
assert.equal(cats.length, 8);
assert.equal(cats.find(row => row.key === 'bible').percent, 38.3);
assert.equal(cats.find(row => row.key === 'quiz').average, 2.83);
assert.equal(allCategoryAverages(data).length, 9);
assert.equal(attendanceCategoryAverage(data).percent, 66.67);

const distribution = scoreDistribution(data);
assert.equal(distribution.length, 5);
assert.equal(distribution.reduce((sum, bucket) => sum + bucket.count, 0), 2);
assert.equal(distribution.reduce((sum, bucket) => sum + bucket.percent, 0), 100);

assert.equal(topStudents(data, 5)[0].student.id, 'a');
assert.equal(topStudents(data, 5).length, 2);

const attention = attentionStudents(data, 5);
assert.equal(attention.length, 2);
assert.ok(attention.some(row => row.student.id === 'b'));
const struggling = attention.find(row => row.student.id === 'b');
assert.ok(struggling.reasons.includes('حضور منخفض'));

assert.equal(resultComposition(data).length, 4);
assert.equal(resultComposition(data)[0].label, 'التقييم اليومي');

const metrics = dashboardMetrics(data, new Date('2026-01-02T10:00:00Z'));
assert.equal(metrics.students, 2);
assert.equal(metrics.requests, 1);
assert.equal(metrics.days, 3);
assert.equal(metrics.evaluations, 4);
assert.equal(metrics.today?.id, 'd2');

assert.equal(recentEvaluations(data, 10).length, 4);
assert.equal(recentEvaluations(data, 2).length, 2);

const empty = dashboardMetrics(emptyData, new Date('2026-01-02T10:00:00Z'));
assert.equal(empty.students, 0);
assert.equal(empty.averagePercent, 0);
assert.equal(empty.todayAttendance.rate, 0);

console.log('PASS: dashboard analytics (attendance, categories, distribution, ranking, attention list and Cairo dates).');
