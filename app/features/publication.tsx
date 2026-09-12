import { Grading } from '../core/model';
import { Switch } from '@/components/ui/switch';
export function PublicationControls({grading,busy,onSave}:{grading:Grading,busy:boolean,onSave:(field:string,value:boolean)=>Promise<void>}) {
 return <section className="panel"><h2>عرض الدرجات للطلاب</h2><p className="muted">كل تغيير هنا يُحفظ فورًا. أجزاء الحفظ ظاهرة دائمًا بعد تفعيل الحساب.</p>{[['competition_published','عرض المسابقة'],['project_published','عرض المشروع'],['results_published','إعلان المجموع النهائي والترتيب']].map(([field,label])=><div className="attendance-switch" key={field}><label htmlFor={field}>{label}<small>{grading[field as keyof Grading]?'ظاهر للطلاب':'مخفي عن الطلاب'}</small></label><Switch id={field} dir="ltr" disabled={busy} checked={!!grading[field as keyof Grading]} onCheckedChange={value=>void onSave(field,value).catch(()=>{})}/></div>)}</section>
}
