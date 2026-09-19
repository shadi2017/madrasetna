import { supabase } from './client';
import { changed, fullFetch, mergeRows, type Manifest } from './sync';
import { type Data, emptyData, rankings } from './model';
export async function rows(table: string) { const result: Record<string, unknown>[] = []; for (let offset = 0;; offset += 1000) {
    const { data, error } = await supabase!.from(table).select('*').order('id').range(offset, offset + 999);
    if (error)
        throw error;
    result.push(...data);
    if (data.length < 1000)
        break;
} return result; }
export function createDataLoader() {
 let cached:Data|undefined, manifest:Manifest|undefined;
 return async ({audit=false,force=false}:{audit?:boolean;force?:boolean}={}):Promise<Data>=>{
  const next=await rpc('sync_manifest',{p_audit:audit}) as Manifest;
  const reset=force||!cached||!manifest||manifest.admin!==next.admin||manifest.owner!==next.owner;
  const before=reset?undefined:manifest;
  const data:Data=reset?{...emptyData}: {...cached!};
  const tables=[['profiles','students'],['days','days'],['evaluations','evaluations'],['settings','settings'],['grading','grading'],['final_scores','finals']] as const;
  await Promise.all(tables.map(async([table,key])=>{
   if(before&&!changed(before[table],next[table]))return;
   if(table==='final_scores'&&!next.admin){data.finals=await rpc('get_final_scores',{});return}
   const all=reset||fullFetch(before?.[table],next[table])||table==='settings'||table==='grading';
   let incoming:any[]=[];
   for(let offset=0;;offset+=1000){let q=supabase!.from(table).select('*');
    if(!all)q=q.gte('updated_at',before![table].stamp!);
    if(next[table].stamp)q=q.lte('updated_at',next[table].stamp!);
    const {data:batch,error}=await q.order('updated_at').order('id').range(offset,offset+999);if(error)throw error;
    incoming.push(...batch);if(batch.length<1000)break;
   }
   if(table==='settings')data.settings=incoming[0]||emptyData.settings;
   else if(table==='grading')data.grading=incoming[0]||emptyData.grading;
   else (data as any)[key]=all?incoming:mergeRows((data as any)[key],incoming);
  }));
  data.admin=next.admin;data.owner=next.owner;
  // A publication change can alter masked fields even when the final score row didn't change.
  if(!next.admin && !reset && changed(before?.grading,next.grading))data.finals=await rpc('get_final_scores',{});
  if(next.admin)data.results=rankings(data);
  else if(!data.grading.results_published)data.results=[];
  else if(reset||next.revision!==before?.revision)data.results=await rpc('get_results',{});
  if(audit&&next.admin&&(reset||changed(before?.audit,next.audit))){const {data:logs,error}=await supabase!.from('audit_log').select('*').order('created_at',{ascending:false}).limit(200);if(error)throw error;data.audit=logs||[]}
  else if(!audit)data.audit=[];
  manifest=next;cached=data;return data;
 };
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
