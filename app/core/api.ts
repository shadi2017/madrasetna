import { supabase } from './client';
import { Data, emptyData } from './model';
export async function rows(table: string) { const result: Record<string, unknown>[] = []; for (let offset = 0;; offset += 1000) {
    const { data, error } = await supabase!.from(table).select('*').order('id').range(offset, offset + 999);
    if (error)
        throw error;
    result.push(...data);
    if (data.length < 1000)
        break;
} return result; }
export async function loadData(): Promise<Data> {
    const { data: admin, error } = await supabase!.rpc('is_admin');
    if (error)
        throw error;
    const [students, days, evaluations, settings, audit, grading, finals, results] = await Promise.all([rows('profiles'), rows('days'), rows('evaluations'), rows('settings'), admin ? supabase!.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200).then(({ data, error }) => { if (error)
            throw error; return data; }) : Promise.resolve([]), rows('grading'), rows('final_scores'), rpc('get_results', {})]);
    return { ...emptyData, students, days, evaluations, settings: settings[0] || emptyData.settings, audit, grading: grading[0] || emptyData.grading, finals, results, admin: !!admin } as Data;
}
export async function rpc(name: string, args: Record<string, unknown>) { if (!supabase)
    throw Error('NOT_CONFIGURED'); const { data, error } = await supabase.rpc(name, args); if (error)
    throw error; return data; }
export async function account(body: Record<string, unknown>) { const { data, error } = await supabase!.functions.invoke('manage-student', { body }); if (error) {
    let message = error.message;
    try {
        const b = await error.context.json();
        message = b.error || message;
    }
    catch { }
    throw Error(message);
} if (data.error)
    throw Error(data.error); return data; }
export async function registerStudent(v: {
    name: string;
    phone: string;
    username: string;
    password: string;
}) { if (!supabase)
    throw Error('NOT_CONFIGURED'); const { data, error } = await supabase.auth.signUp({ email: v.username + '@students.invalid', password: v.password, options: { data: { registration: 'student', username: v.username, full_name: v.name, phone: v.phone } } }); if (error)
    throw error; return data; }
