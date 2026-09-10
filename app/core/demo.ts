import { Data, defaultSettings, Evaluation, Student, localDate } from './model';
export function makeDemo(): Data {
    const now = new Date().toISOString();
    const base = () => ({ id: crypto.randomUUID(), version: 1, updated_at: now, deleted_at: null });
    const names = ['مينا جورج', 'مريم عادل', 'يوسف فادي', 'مارينا ممدوح', 'كيرلس سامح', 'سارة عاطف'];
    const students = names.map((name, i) => ({ ...base(), username: 'student_' + (i + 1), full_name: name, phone: '0100000000' + i, qr_token: crypto.randomUUID(), created_at: now }));
    const days = Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 2); return { ...base(), label: 'اليوم ' + (i + 1), date: [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }; });
    const evaluations: Evaluation[] = students.flatMap((s, i) => days.slice(0, 3).map((d, j) => ({ ...base(), student_id: s.id, day_id: d.id, present: (i + j) % 4 !== 0, attended_at: now, scores: { discipline: 8, bible: 10, devotion: 7, memory: 6, phone: 10, hymns: 8, games: 9, quiz: 7, competition: 8, project: 5 }, notes: '' })));
    return { students, days, evaluations, settings: { ...defaultSettings, slogan: 'نكبر معًا، خطوة بخطوة', verse: 'اسم الدراسة وآيتها وشعارها يتغيروا من الإعدادات.' }, audit: [], admin: true };
}
export function demoRpc(data: Data, name: string, a: Record<string, any>) {
    const next = structuredClone(data);
    const now = new Date().toISOString();
    let result: any;
    let entity = '', before: any = null, after: any;
    const update = (table: 'students' | 'days' | 'evaluations', id: string, values: Record<string, any>, version?: number) => { const row = next[table].find(x => x.id === id); if (!row)
        throw Error('STUDENT_NOT_FOUND'); if (version !== undefined && row.version !== version)
        throw Error('CONFLICT_REFRESH'); before = structuredClone(row); Object.assign(row, values, { version: row.version + 1, updated_at: now }); after = row; entity = table === 'students' ? 'profiles' : table; return row; };
    if (name === 'save_profile')
        result = update('students', a.p_id, { full_name: a.p_name, phone: a.p_phone }, a.p_version);
    else if (name === 'save_day') {
        if (a.p_id)
            result = update('days', a.p_id, { label: a.p_label, date: a.p_date }, a.p_version);
        else {
            result = { id: crypto.randomUUID(), label: a.p_label, date: a.p_date, version: 1, updated_at: now, deleted_at: null };
            next.days.push(result);
            after = result;
            entity = 'days';
        }
    }
    else if (name === 'save_settings') {
        if (next.settings.version !== a.p_version)
            throw Error('CONFLICT_REFRESH');
        before = structuredClone(next.settings);
        Object.assign(next.settings, { name: a.p_name, slogan: a.p_slogan, verse: a.p_verse, logo: a.p_logo, version: next.settings.version + 1 });
        after = next.settings;
        entity = 'settings';
    }
    else if (name === 'save_evaluation') {
        const old = next.evaluations.find(e => e.student_id === a.p_student && e.day_id === a.p_day);
        const values = { present: a.p_present, scores: a.p_scores, notes: a.p_notes, deleted_at: null, attended_at: a.p_present ? old?.attended_at || now : null };
        if (old)
            result = update('evaluations', old.id, values, a.p_version);
        else {
            result = { id: crypto.randomUUID(), student_id: a.p_student, day_id: a.p_day, ...values, version: 1, updated_at: now };
            next.evaluations.push(result);
            after = result;
            entity = 'evaluations';
        }
    }
    else if (name === 'scan_attendance') {
        const s = next.students.find(s => s.qr_token === a.p_token && !s.deleted_at);
        if (!s)
            throw Error('INVALID_QR');
        if (!next.days.some(d => d.id === a.p_day && d.date && !d.deleted_at))
            throw Error('DAY_NEEDS_DATE');
        const old = next.evaluations.find(e => e.student_id === s.id && e.day_id === a.p_day);
        result = { name: s.full_name, duplicate: !!old?.present && !old.deleted_at };
        if (!result.duplicate) {
            if (old)
                update('evaluations', old.id, { present: true, attended_at: now, deleted_at: null });
            else {
                after = { id: crypto.randomUUID(), student_id: s.id, day_id: a.p_day, present: true, attended_at: now, scores: {}, notes: '', deleted_at: null, version: 1, updated_at: now };
                next.evaluations.push(after);
                entity = 'evaluations';
            }
        }
    }
    else if (name === 'set_deleted')
        update(a.p_entity === 'profiles' ? 'students' : a.p_entity, a.p_id, { deleted_at: a.p_deleted ? now : null }, a.p_version);
    else if (name === 'rotate_qr')
        update('students', a.p_id, { qr_token: crypto.randomUUID() });
    else if (name === 'restore_revision') {
        const audit = next.audit.find(x => x.id === a.p_audit);
        if (!audit?.before_data)
            throw Error('NO_PREVIOUS_VERSION');
        const old = audit.before_data;
        if (audit.entity === 'settings') {
            before = structuredClone(next.settings);
            Object.assign(next.settings, old, { version: next.settings.version + 1 });
            after = next.settings;
            entity = 'settings';
        }
        else {
            const values = { ...old };
            delete values.id;
            delete values.qr_token;
            update(audit.entity === 'profiles' ? 'students' : audit.entity as any, audit.record_id, values, a.p_version);
        }
    }
    else
        throw Error('INVALID_ACTION');
    if (after)
        next.audit.unshift({ id: crypto.randomUUID(), entity, record_id: String(after.id), action: !before ? 'create' : after.deleted_at && !before.deleted_at ? 'delete' : !after.deleted_at && before.deleted_at ? 'restore' : 'update', actor_id: 'demo-admin', before_data: before, after_data: structuredClone(after), created_at: now });
    return { data: next, result };
}
export function demoAccount(data: Data, b: Record<string, any>) { if (b.action === 'reset')
    return { data, result: { ok: true } }; if (data.students.some(s => s.username === b.username))
    throw Error('USERNAME_EXISTS_OR_INVALID'); const now = new Date().toISOString(); const profile: Student = { id: crypto.randomUUID(), username: b.username, full_name: b.name, phone: b.phone, qr_token: crypto.randomUUID(), version: 1, updated_at: now, created_at: now, deleted_at: null }; return { data: { ...data, students: [...data.students, profile] }, result: { profile } }; }
