import { Data, defaultSettings, defaultGrading, Evaluation, Student, active, rankings, validConfig, categories } from './model';
export function makeDemo(): Data {
    const now = new Date().toISOString(), base = () => ({ id: crypto.randomUUID(), version: 1, updated_at: now, deleted_at: null });
    const students: Student[] = ['مينا جورج', 'مريم عادل', 'يوسف فادي', 'مارينا ممدوح', 'كيرلس سامح', 'سارة عاطف', 'بولا هاني'].map((name, i) => ({ ...base(), username: 'student_' + (i + 1), full_name: name, phone: '0100000000' + i, qr_token: crypto.randomUUID(), created_at: now, status: i === 6 ? 'pending' : 'active' }));
    const days = Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 2); return { ...base(), label: 'اليوم ' + (i + 1), date: [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }; });
    const evaluations: Evaluation[] = students.filter(active).flatMap((s, i) => days.slice(0, 3).map((d, j) => ({ ...base(), student_id: s.id, day_id: d.id, present: (i + j) % 4 !== 0, attended_at: now, scores: { discipline: 8, bible: 10, devotion: 7, memory: 6, phone: 10, hymns: 8, games: 9, quiz: 7 }, notes: '' })));
    const data: Data = { students, days, evaluations, finals: students.filter(active).map((s, i) => ({ ...base(), student_id: s.id, part_scores: { part_1: 85 - i * 3, part_2: 80 - i * 2, part_3: 90 - i * 2 }, competition: 75 - i * 3, project: 80 - i * 4, notes: '' })), grading: structuredClone(defaultGrading), results: [], settings: { ...defaultSettings, slogan: 'نكبر معًا، خطوة بخطوة', verse: 'اسم الدراسة وآيتها وشعارها يتغيروا من الإعدادات.' }, audit: [], admin: true, owner: true };
    data.results = rankings(data);
    return data;
}
export function demoRpc(data: Data, name: string, a: Record<string, any>) {
    const next = structuredClone(data), now = new Date().toISOString();
    let result: any, entity = '', before: any = null, after: any;
    const update = (table: 'students' | 'days' | 'evaluations' | 'finals', id: string, values: Record<string, any>, version?: number) => { const row = next[table].find(x => x.id === id); if (!row)
        throw Error('STUDENT_NOT_FOUND'); if (version !== undefined && row.version !== version)
        throw Error('CONFLICT_REFRESH'); before = structuredClone(row); Object.assign(row, values, { version: row.version + 1, updated_at: now }); after = row; entity = table === 'students' ? 'profiles' : table === 'finals' ? 'final_scores' : table; return row; };
    if (name === 'save_profile')
        result = update('students', a.p_id, { full_name: a.p_name, phone: a.p_phone }, a.p_version);
    else if (name === 'set_student_status')
        result = update('students', a.p_id, { status: a.p_status }, a.p_version);
    else if ((name === 'save_day' || name === 'save_day_v2')) {
        if (a.p_id)
            result = update('days', a.p_id, { label: a.p_label, date: a.p_date, discipline_deadline: a.p_deadline ?? null }, a.p_version);
        else {
            result = { id: crypto.randomUUID(), label: a.p_label, date: a.p_date, discipline_deadline: a.p_deadline ?? null, version: 1, updated_at: now, deleted_at: null };
            next.days.push(result);
            after = result;
            entity = 'days';
        }
    }
    else if ((name === 'save_settings' || name === 'save_settings_v2')) {
        if (next.settings.version !== a.p_version)
            throw Error('CONFLICT_REFRESH');
        before = structuredClone(next.settings);
        Object.assign(next.settings, { login_title: a.p_login_title ?? next.settings.login_title, login_tagline: a.p_login_tagline ?? next.settings.login_tagline, name: a.p_name, slogan: a.p_slogan, verse: a.p_verse, logo: a.p_logo, version: next.settings.version + 1 });
        after = next.settings;
        entity = 'settings';
    }
    else if ((name === 'save_grading' || name === 'save_grading_v2' || name === 'save_grading_config')) {
        const c = a.p_config;
        if (!validConfig(c))
            throw Error('INVALID_CONFIG');
        if (a.p_version !== next.grading.version)
            throw Error('CONFLICT_REFRESH');
        if (next.evaluations.some(e => categories.some(([k]) => (e.scores[k] || 0) > c.daily_max[k])) || next.finals.some(f => f.competition > c.competition_max || f.project > c.project_max || Object.entries(f.part_scores).some(([k, v]) => v > (c.parts.find((p: any) => p.id === k)?.max || 0))))
            throw Error('CONFIG_BELOW_EXISTING');
        before = structuredClone(next.grading);
        next.grading = { ...next.grading, config: c, results_published: a.p_published ?? next.grading.results_published, competition_published: a.p_competition_published ?? next.grading.competition_published, project_published: a.p_project_published ?? next.grading.project_published, version: next.grading.version + 1, updated_at: now };
        after = next.grading;
        entity = 'grading';
        result = next.grading;
    }
    else if(name==='set_publication'){if(a.p_version!==next.grading.version)throw Error('CONFLICT_REFRESH');next.grading={...next.grading,[a.p_field]:a.p_value,version:next.grading.version+1};result=next.grading;}
    else if (name === 'save_final_scores') {
        if (!next.students.some(s => s.id === a.p_student && active(s)))
            throw Error('STUDENT_NOT_FOUND');
        const c = next.grading.config;
        if (a.p_competition < 0 || a.p_project < 0 || a.p_competition > c.competition_max || a.p_project > c.project_max || Object.entries(a.p_parts).some(([k, v]) => typeof v !== 'number' || v < 0 || !c.parts.some(p => p.id === k) || v > c.parts.find(p => p.id === k)!.max))
            throw Error('SCORE_OUT_OF_RANGE');
        const old = next.finals.find(f => f.student_id === a.p_student);
        const values = { part_scores: a.p_parts, competition: a.p_competition, project: a.p_project, notes: a.p_notes, deleted_at: null };
        if (old)
            result = update('finals', old.id, values, a.p_version);
        else {
            result = { id: crypto.randomUUID(), student_id: a.p_student, ...values, version: 1, updated_at: now };
            next.finals.push(result);
            after = result;
            entity = 'final_scores';
        }
    }
    else if (name === 'save_evaluation') {
        if (!next.students.some(s => s.id === a.p_student && active(s)))
            throw Error('STUDENT_NOT_FOUND');
        if (categories.some(([k]) => (a.p_scores[k] ?? 0) < 0 || (a.p_scores[k] ?? 0) > next.grading.config.daily_max[k]))
            throw Error('SCORE_OUT_OF_RANGE');
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
        const s = next.students.find(s => s.qr_token === a.p_token && active(s));
        if (!s)
            throw Error('INVALID_QR');
        if (!next.days.some(d => d.id === a.p_day && d.date && !d.deleted_at))
            throw Error('DAY_NEEDS_DATE');
        const old = next.evaluations.find(e => e.student_id === s.id && e.day_id === a.p_day);
        const scanDay = next.days.find(d=>d.id===a.p_day)!;
        const cairo = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
        const eligible = !!scanDay.discipline_deadline && scanDay.date===cairo && time <= (scanDay.discipline_deadline.length===5 ? scanDay.discipline_deadline+':00' : scanDay.discipline_deadline);
        const scanScores = eligible ? {...old?.scores,discipline:next.grading.config.daily_max.discipline} : old?.scores || {};
        result = { discipline_awarded: eligible && !(old?.present && !old.deleted_at), name: s.full_name, duplicate: !!old?.present && !old.deleted_at };
        if (!result.duplicate) {
            if (old)
                update('evaluations', old.id, { present: true, scores: scanScores, attended_at: now, deleted_at: null });
            else {
                after = { id: crypto.randomUUID(), student_id: s.id, day_id: a.p_day, present: true, attended_at: now, scores: scanScores, notes: '', deleted_at: null, version: 1, updated_at: now };
                next.evaluations.push(after);
                entity = 'evaluations';
            }
        }
    }
    else if (name === 'set_deleted')
        update(a.p_entity === 'profiles' ? 'students' : a.p_entity === 'final_scores' ? 'finals' : a.p_entity, a.p_id, { deleted_at: a.p_deleted ? now : null }, a.p_version);
    else if (name === 'rotate_qr')
        update('students', a.p_id, { qr_token: crypto.randomUUID() });
    else if (name === 'restore_revision') {
        const audit = next.audit.find(x => x.id === a.p_audit);
        if (!audit?.before_data)
            throw Error('NO_PREVIOUS_VERSION');
        const old = audit.before_data;
        if (audit.entity === 'settings' || audit.entity === 'grading') {
            const key = audit.entity;
            if (key === 'grading') {
                const c = old.config as any;
                if (next.evaluations.some(e => categories.some(([k]) => (e.scores[k] || 0) > c.daily_max[k])) || next.finals.some(f => f.competition > c.competition_max || f.project > c.project_max || Object.entries(f.part_scores).some(([k, v]) => v > (c.parts.find((p: any) => p.id === k)?.max || 0))))
                    throw Error('CONFIG_BELOW_EXISTING');
            }
            before = structuredClone(next[key]);
            if (next[key].version !== a.p_version)
                throw Error('CONFLICT_REFRESH');
            Object.assign(next[key], old, { version: next[key].version + 1 });
            after = next[key];
            entity = key;
        }
        else {
            const values = { ...old };
            delete values.id;
            delete values.qr_token;
            update(audit.entity === 'profiles' ? 'students' : audit.entity === 'final_scores' ? 'finals' : audit.entity as any, audit.record_id, values, a.p_version);
        }
    }
    else
        throw Error('INVALID_ACTION');
    if (after)
        next.audit.unshift({ id: crypto.randomUUID(), entity, record_id: String(after.id), action: !before ? 'create' : after.deleted_at && !before.deleted_at ? 'delete' : !after.deleted_at && before.deleted_at ? 'restore' : 'update', actor_id: 'demo-admin', before_data: before, after_data: structuredClone(after), created_at: now });
    next.results = rankings(next);
    return { data: next, result };
}
export function demoAccount(data: Data, b: Record<string, any>) { if (b.action === 'reset')
    return { data, result: { ok: true } }; if (data.students.some(s => s.username === b.username))
    throw Error('USERNAME_EXISTS_OR_INVALID'); const now = new Date().toISOString(); const profile: Student = { id: crypto.randomUUID(), username: b.username, full_name: b.name, phone: b.phone, qr_token: crypto.randomUUID(), version: 1, updated_at: now, created_at: now, deleted_at: null, status: b.action === 'register' ? 'pending' : 'active' }; const next = { ...data, students: [...data.students, profile] }; next.results = rankings(next); return { data: next, result: { profile } }; }
