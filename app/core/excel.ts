import { Data, categories, validStudent, validConfig, active } from './model';
export type ImportRow = {
    sheet: string;
    row: number;
    values: Record<string, string | number | boolean>;
    error?: string;
};
const specs = (data: Data): Record<string, [
    string,
    string
][]> => ({
    'الطلاب': [['id', 'المعرف'], ['version', 'الإصدار'], ['username', 'اسم المستخدم'], ['full_name', 'الاسم'], ['phone', 'الموبايل'], ['deleted_at', 'تاريخ الحذف'], ['qr_token', 'رمز QR'], ['status', 'حالة الحساب']],
    'الأيام': [['id', 'المعرف'], ['version', 'الإصدار'], ['label', 'اليوم'], ['date', 'التاريخ'], ['discipline_deadline', 'آخر موعد للالتزام'], ['deleted_at', 'تاريخ الحذف']],
    'التقييمات': [['id', 'المعرف'], ['version', 'الإصدار'], ['student_id', 'معرف الطالب'], ['day_id', 'معرف اليوم'], ['present', 'حاضر'], ...categories.map(([k, l]) => [k, l] as [
            string,
            string
        ]), ['notes', 'ملاحظات'], ['deleted_at', 'تاريخ الحذف']],
    'الإعدادات': [['name', 'الاسم'], ['slogan', 'الشعار'], ['verse', 'الآية'], ['login_tagline', 'عبارة الدخول'], ['login_title', 'عنوان الدخول'], ['version', 'الإصدار']],
    'الدرجات المستقلة': [['id', 'المعرف'], ['version', 'الإصدار'], ['student_id', 'معرف الطالب'], ...data.grading.config.parts.map((p, i) => ['part_' + p.id, 'حفظ ' + (i + 1) + ' · ' + p.label] as [
            string,
            string
        ]), ['competition', 'المسابقة'], ['project', 'المشروع'], ['notes', 'ملاحظات'], ['deleted_at', 'تاريخ الحذف']],
    'نظام الدرجات': [['config', 'الإعدادات JSON'], ['version', 'الإصدار']]
});
export async function downloadWorkbook(data: Data, audit = data.audit, template = false) {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'مدرستنا';
    const records: Record<string, Record<string, unknown>[]> = { 'الطلاب': data.students, 'الأيام': data.days, 'التقييمات': data.evaluations.map(e => ({ ...e, ...e.scores })), 'الإعدادات': [data.settings], 'الدرجات المستقلة': data.finals.map(f => ({ ...f, ...Object.fromEntries(Object.entries(f.part_scores).map(([k, v]) => ['part_' + k, v])) })), 'نظام الدرجات': [{ config: JSON.stringify(data.grading.config), version: data.grading.version }] };
    for (const [name, columns] of Object.entries(specs(data))) {
        const sheet = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
        sheet.columns = columns.map(([key, header]) => ({ key, header, width: key === 'full_name' || key === 'verse' ? 32 : 22 }));
        if (!template)
            for (const row of records[name])
                sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, row[key] ?? ''])));
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153B50' } };
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
    if (!template) {
        const results = wb.addWorksheet('النتائج والترتيب', { views: [{ rightToLeft: true }] });
        results.columns = [{ key: 'name', header: 'الطالب', width: 30 }, { key: 'daily', header: 'اليومي', width: 18 }, { key: 'parts', header: 'أجزاء الحفظ', width: 18 }, { key: 'competition', header: 'المسابقة', width: 18 }, { key: 'project', header: 'المشروع', width: 18 }, { key: 'points', header: 'المجموع النهائي', width: 20 }, { key: 'max', header: 'من', width: 16 }, { key: 'rank', header: 'الترتيب', width: 16 }];
        data.results.forEach(r => results.addRow({ ...r, name: data.students.find(s => s.id === r.student_id)?.full_name }));
        const history = wb.addWorksheet('السجل', { views: [{ rightToLeft: true }] });
        history.columns = [{ header: 'الوقت', key: 'created_at', width: 25 }, { header: 'العملية', key: 'action', width: 20 }, { header: 'النوع', key: 'entity', width: 20 }, { header: 'المعرف', key: 'record_id', width: 38 }, { header: 'الأدمن', key: 'actor_id', width: 38 }, { header: 'قبل', key: 'before', width: 60 }, { header: 'بعد', key: 'after', width: 60 }];
        for (const a of audit) {
            const json = (v: unknown) => JSON.stringify(v, (key, value) => key === 'logo' && value ? '[صورة اللوجو محفوظة في ورقة اللوجو]' : value);
            history.addRow({ ...a, before: json(a.before_data), after: json(a.after_data) });
        }
        const logo = wb.addWorksheet('اللوجو');
        logo.addRow(['الجزء', 'المحتوى']);
        for (let i = 0; i < data.settings.logo.length; i += 30000)
            logo.addRow([i / 30000 + 1, data.settings.logo.slice(i, i + 30000)]);
    }
    const help = wb.addWorksheet('تعليمات');
    help.getColumn(1).width = 110;
    ['استخدم ملف القالب لإضافة بيانات جديدة، أو عدل نسخة التصدير لتحديث السجلات.', 'الطلاب: الاسم والموبايل واسم المستخدم مطلوبون. احتفظ بصفر الموبايل الأول واستخدم تنسيق نص.', 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط، من 3 إلى 32 حرفًا.', 'للسجلات الجديدة اترك المعرف والإصدار فارغين. لتعديل سجل موجود احتفظ بالمعرف والإصدار الحالي.', 'التقييمات: استخدم معرف الطالب ومعرف اليوم من ورقتيهما. كل درجة حسب النهاية المحددة في نظام الدرجات، وحاضر TRUE أو FALSE.', 'أيام الدراسة: التاريخ بصيغة YYYY-MM-DD، أو اتركه فارغًا.', 'تاريخ الحذف: فارغ للسجلات النشطة، أو تاريخ ISO للسجلات المحذوفة. استرجع المحذوفات من التطبيق أولًا.', 'حساب الطالب الجديد يحصل على كلمة مرور مولدة وقت الاستيراد وتظهر في كشف منفصل.', 'رمز QR والمعرف واسم مستخدم الحساب الموجود والسجل للتصدير والربط؛ لا يتم تغييرها بالاستيراد.', 'يتم الاستيراد صفًا بصف. يظهر تقرير النجاح والفشل لتصحيح الصفوف المتبقية.', 'الحد: 500 صف لكل استيراد، وحجم الملف 5 ميجابايت. السجل للتصدير فقط.'].forEach(x => help.addRow([x]));
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), template ? 'قالب-مدرستنا.xlsx' : 'مدرستنا-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
export function saveBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function parseWorkbook(file: File, data: Data): Promise<ImportRow[]> {
    if (file.size > 5 * 1024 * 1024)
        throw Error('حجم الملف أكبر من 5 ميجابايت.');
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const rows: ImportRow[] = [];
    const seen = new Set<string>();
    const dates = new Set<string>();
    let settingsCount = 0;
    let gradingCount = 0;
    for (const [name, columns] of Object.entries(specs(data))) {
        const sheet = wb.getWorksheet(name);
        if (!sheet)
            continue;
        const headers = new Map<number, string>();
        sheet.getRow(1).eachCell((cell, index) => {
            const match = columns.find(([key, label]) => cell.text === label || cell.text === key);
            if (match)
                headers.set(index, match[0]);
        });
        sheet.eachRow((row, index) => {
            if (index === 1)
                return;
            const values: ImportRow['values'] = {};
            let error = '';
            row.eachCell((cell, col) => {
                const key = headers.get(col);
                if (!key)
                    return;
                if (cell.type === ExcelJS.ValueType.Formula) {
                    error = 'الصيغ غير مقبولة؛ استخدم قيمًا ثابتة.';
                    return;
                }
                values[key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : typeof cell.value === 'number' || typeof cell.value === 'boolean' ? cell.value : cell.text.trim();
            });
            if (!Object.values(values).some(v => v !== ''))
                return;
            const str = (k: string) => String(values[k] ?? '');
            const id = str('id'), version = Number(values.version || 0);
            if (name === 'الطلاب') {
                if (!validStudent(str('full_name'), str('phone'), str('username')))
                    error = 'راجع الاسم والموبايل واسم المستخدم.';
                const old = data.students.find(s => s.id === id || s.username === str('username'));
                if (old) {
                    if (id !== old.id || version !== old.version || str('username') !== old.username)
                        error = 'احتفظ بمعرف الطالب واسم مستخدمه وإصداره الحالي من تصدير حديث.';
                    if (old.deleted_at)
                        error = 'استرجع الطالب من المحذوفات أولًا.';
                }
                else if (id)
                    error = 'معرف الطالب غير موجود؛ اتركه فارغًا لطالب جديد.';
                const duplicate = 'student:' + str('username');
                if (seen.has(duplicate))
                    error = 'اسم المستخدم مكرر في الملف.';
                seen.add(duplicate);
            }
            if (name === 'الأيام') {
                if (!str('label') || str('label').length > 100)
                    error = 'اسم اليوم مطلوب (حتى 100 حرف).';
                const deadline = str('discipline_deadline');
                if (deadline && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(deadline)) error = 'موعد الالتزام لازم يكون HH:MM بتوقيت القاهرة.';
                const date = str('date');
                if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))
                    error = 'التاريخ لازم يكون YYYY-MM-DD صحيح.';
                if (date && (dates.has(date) || data.days.some(d => d.date === date && !d.deleted_at && d.id !== id)))
                    error = 'تاريخ اليوم مكرر.';
                if (date)
                    dates.add(date);
                if (id) {
                    const old = data.days.find(d => d.id === id);
                    if (!old || old.version !== version || old.deleted_at)
                        error = 'معرف أو إصدار اليوم غير صالح؛ استخدم تصديرًا حديثًا.';
                }
            }
            if (name === 'التقييمات') {
                if (!data.students.some(s => s.id === str('student_id') && active(s)) || !data.days.some(d => d.id === str('day_id') && !d.deleted_at))
                    error = 'معرف الطالب أو اليوم غير موجود؛ استورد الطلاب والأيام أولًا ثم صدّر المعرفات.';
                for (const [k] of categories) {
                    const n = Number(values[k] ?? 0);
                    if (!Number.isFinite(n) || n < 0 || n > data.grading.config.daily_max[k])
                        error = 'كل درجة لازم تكون ضمن النهاية المحددة في نظام الدرجات.';
                    if(k!=='quiz' && n!==0 && n!==10) error = 'التقييم اليومي 0 أو 10 فقط، ما عدا الكويز.';
                    values[k] = n;
                }
                const p = str('present').toLowerCase();
                if (!['true', 'false', '1', '0', 'نعم', 'لا', ''].includes(p))
                    error = 'حاضر: TRUE أو FALSE.';
                values.present = ['true', '1', 'نعم'].includes(p);
                const old = data.evaluations.find(e => e.student_id === str('student_id') && e.day_id === str('day_id'));
                if (old && (old.version !== version || old.id !== id || old.deleted_at))
                    error = 'استخدم معرف وإصدار التقييم من تصدير حديث، واسترجع المحذوف أولًا.';
                if (!old && id)
                    error = 'التقييم غير موجود؛ اترك المعرف فارغًا.';
                const duplicate = 'eval:' + str('student_id') + ':' + str('day_id');
                if (seen.has(duplicate))
                    error = 'تقييم الطالب لنفس اليوم مكرر.';
                seen.add(duplicate);
                if (str('notes').length > 2000)
                    error = 'الملاحظات أطول من 2000 حرف.';
            }
            if (name === 'الدرجات المستقلة') {
                if (!data.students.some(s => s.id === str('student_id') && active(s)))
                    error = 'الطالب غير موجود أو غير مفعل.';
                const old = data.finals.find(f => f.student_id === str('student_id'));
                if (old && (old.id !== id || old.version !== version || old.deleted_at))
                    error = 'استخدم معرف وإصدار الدرجات من تصدير حديث واسترجع المحذوف أولًا.';
                if (!old && id)
                    error = 'المعرف غير موجود. اتركه فارغًا للدرجات الجديدة.';
                const duplicate = 'final:' + str('student_id');
                if (seen.has(duplicate))
                    error = 'درجات الطالب المستقلة مكررة.';
                seen.add(duplicate);
                const limits = [...data.grading.config.parts.map(p => ['part_' + p.id, p.max] as [
                        string,
                        number
                    ]), ['competition', data.grading.config.competition_max], ['project', data.grading.config.project_max]] as [
                    string,
                    number
                ][];
                for (const [key, max] of limits) {
                    const n = Number(values[key] || 0);
                    if (!Number.isFinite(n) || n < 0 || n > max)
                        error = 'درجة خارج النهاية المحددة.';
                    values[key] = n;
                }
                if (str('notes').length > 2000)
                    error = 'الملاحظات أطول من 2000 حرف.';
            }
            if (name === 'نظام الدرجات') {
                gradingCount++;
                try {
                    if (gradingCount > 1 || !validConfig(JSON.parse(str('config'))) || version !== data.grading.version)
                        error = 'راجع إعدادات المعادلة والإصدار. يسمح بصف واحد فقط.';
                }
                catch {
                    error = 'إعدادات المعادلة غير صالحة.';
                }
            }
            if (name === 'الإعدادات') {
                settingsCount++;
                if (settingsCount > 1 || !str('name') || str('name').length > 100 || str('slogan').length > 250 || str('verse').length > 1000 || version !== data.settings.version)
                    error = 'راجع الاسم وأطوال النصوص وإصدار الإعدادات؛ يسمح بصف واحد.';
            }
            if (str('deleted_at'))
                error = 'الصف محذوف؛ استرجعه من التطبيق أو احذفه من ملف الاستيراد.';
            if (id) {
                const duplicate = name + ':' + id;
                if (seen.has(duplicate))
                    error = 'المعرف مكرر.';
                seen.add(duplicate);
            }
            rows.push({ sheet: name, row: index, values, error: error || undefined });
            if (rows.length > 500)
                throw Error('الملف فيه أكتر من 500 صف. قسمه لملفات أصغر.');
        });
    }
    const logoSheet = wb.getWorksheet('اللوجو');
    if (logoSheet) {
        let logo = '';
        logoSheet.eachRow((r, i) => {
            if (i > 1)
                logo += r.getCell(2).text;
        });
        const setting = rows.find(r => r.sheet === 'الإعدادات');
        if (setting) {
            if (logo.length > 400000 || (logo && !/^data:image\/(png|jpeg|webp);base64,/.test(logo)))
                setting.error = 'بيانات اللوجو غير صالحة.';
            else
                setting.values.logo = logo;
        }
    }
    if (!rows.length)
        throw Error('الملف مفيهوش بيانات قابلة للاستيراد. استخدم القالب.');
    return rows;
}
export async function downloadCredentials(rows: {
    username: string;
    password: string;
}[]) { const { default: ExcelJS } = await import('exceljs'); const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('حسابات جديدة'); sheet.columns = [{ header: 'اسم المستخدم', key: 'username', width: 30 }, { header: 'كلمة المرور', key: 'password', width: 30 }]; rows.forEach(r => sheet.addRow(r)); const b = await wb.xlsx.writeBuffer(); saveBlob(new Blob([b as BlobPart]), 'حسابات-جديدة-احتفظ-بها-بشكل-خاص.xlsx'); }
