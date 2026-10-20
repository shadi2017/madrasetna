import { useEffect, useState } from 'react';
import { supabase } from '../core/client';
import { account, rpc } from '../core/api';
import { safeError } from '../core/model';
import { Modal } from './ui';
export function AccountPanel({demo}:{demo:boolean}) {
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[current,setCurrent]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(!demo)void supabase!.auth.getUser().then(({data})=>setEmail(data.user?.email||''))},[demo]);
 async function save(kind:'email'|'password') {setBusy(true);setMessage('');try {
  if(demo){setMessage('تعديل الحساب متاح في النسخة المتصلة فقط.');return}
  const {data,error}=await supabase!.auth.getUser();if(error||!data.user?.email)throw error||Error('UNAUTHORIZED');
  const login=await supabase!.auth.signInWithPassword({email:data.user.email,password:current});if(login.error)throw login.error;
  const update=await supabase!.auth.updateUser(kind==='email'?{email:email.trim()}:{password});if(update.error)throw update.error;
  setMessage(kind==='email'?'تم إرسال طلب تغيير البريد. راجع بريدك القديم والجديد لو مطلوب تأكيد.':'تم تغيير كلمة المرور.');setPassword('');setCurrent('');
 }catch(e){setMessage(safeError(e))}finally{setBusy(false)}}
 return <section className="panel"><h2>حسابي</h2><p className="muted">لتغيير بيانات حسابك، اكتب كلمة المرور الحالية.</p><form onSubmit={e=>e.preventDefault()} className="form-stack"><label>كلمة المرور الحالية<input autoComplete="current-password" type="password" value={current} onChange={e=>setCurrent(e.target.value)}/></label><label>البريد الإلكتروني<input type="email" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)}/></label><button type="button" className="secondary" disabled={busy||!current||!email} onClick={()=>save('email')}>تغيير البريد</button><label>كلمة المرور الجديدة<input type="password" autoComplete="new-password" minLength={6} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/><small>٦ حروف أو أرقام على الأقل.</small></label><button className="primary" type="button" disabled={busy||!current||password.length<6} onClick={()=>save('password')}>تغيير كلمة المرور</button>{message&&<p className="notice" role="status">{message}</p>}</form></section>
}
type Staff={user_id:string,email:string,is_owner:boolean,permissions?:Record<string,boolean>};
const permissionOptions = [
 ['home','نظرة عامة'],
 ['students','الطلاب'],
 ['approvals','طلبات التسجيل'],
 ['scan','تسجيل الحضور'],
 ['grades','التقييمات'],
 ['days','أيام الدراسة'],
 ['excel','استيراد وتصدير'],
 ['history','السجل والمحذوفات'],
 ['backup','النسخ الاحتياطي'],
 ['grading','نظام الدرجات والنتيجة'],
 ['settings','إعدادات الدراسة'],
] as const;
export function StaffPanel({demo,onChange}:{demo:boolean,onChange:()=>Promise<unknown>}) {
 const [staff,setStaff]=useState<Staff[]>([]),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[create,setCreate]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [permTarget,setPermTarget]=useState<Staff|null>(null),[perms,setPerms]=useState<Record<string,boolean>>({});
 async function load(){if(!demo)setStaff(await rpc('list_staff',{}))}
 useEffect(()=>{void load().catch(e=>setMessage(safeError(e)))},[demo]);
 async function change(target:string,enabled:boolean){setBusy(true);setMessage('');try {if(demo){setMessage('إدارة المشرفين متاحة في النسخة المتصلة فقط.');return}
  if(enabled&&create)await account({action:'create_staff',email:target,password});else await rpc('set_staff',{p_email:target,p_enabled:enabled});
  setEmail('');setPassword('');await load();await onChange();setMessage(enabled?'تمت إضافة المشرف.':'تم إلغاء صلاحية المشرف.');
 }catch(e){setMessage(safeError(e))}finally{setBusy(false)}}
 function openPermissions(s:Staff){setPermTarget(s);setPerms(Object.fromEntries(permissionOptions.map(([key])=>[key,s.permissions?.[key]!==false])))}
 async function savePermissions(){if(!permTarget)return;setBusy(true);setMessage('');try{if(demo){setMessage('الصلاحيات متاحة في النسخة المتصلة فقط.');return}
  await rpc('set_staff_permissions',{p_email:permTarget.email,p_permissions:perms});
  setPermTarget(null);await load();await onChange();setMessage('تم تحديث صلاحيات المشرف.');
 }catch(e){setMessage(safeError(e))}finally{setBusy(false)}}
 return <section className="panel"><h2>المشرفون</h2><p className="muted">المشرف يشوف الصفحات اللي تحددها له. الأدمن الرئيسي فقط يقدر يعدّل الصلاحيات، ويشوف كل الصفحات دايمًا.</p><form className="form-stack" onSubmit={e=>{e.preventDefault();void change(email.trim(),true)}}><label>بريد المشرف<input type="email" required dir="ltr" value={email} onChange={e=>setEmail(e.target.value)}/></label><label><input type="checkbox" checked={create} onChange={e=>setCreate(e.target.checked)}/> إنشاء حساب جديد</label>{create&&<label>كلمة مرور مبدئية<input type="password" minLength={6} maxLength={128} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>}<button className="primary" disabled={busy}>إضافة مشرف</button></form>{message&&<p className="notice" role="status">{message}</p>}<div className="section-gap">{staff.map(s=><div className="attendance-row staff-row" key={s.user_id}><b dir="ltr">{s.email}</b><span className="badge">{s.is_owner?'أدمن رئيسي':'مشرف'}</span>{!s.is_owner&&<div className="actions wrap"><button className="secondary" disabled={busy} onClick={()=>openPermissions(s)}>الصلاحيات</button><button className="secondary" disabled={busy} onClick={()=>change(s.email,false)}>إلغاء الصلاحية</button></div>}</div>)}</div>
 {permTarget&&<Modal title={'صلاحيات ' + permTarget.email} description="اختار الصفحات التي يشوفها المشرف. الصفحات غير المحددة مش هتظهر له في القائمة." onClose={()=>!busy&&setPermTarget(null)}><div className="permission-grid">{permissionOptions.map(([key,label])=><label className="permission-row" key={key}><input type="checkbox" checked={perms[key]!==false} onChange={e=>setPerms({...perms,[key]:e.target.checked})}/><span>{label}</span></label>)}</div><div className="actions wrap section-gap"><button className="primary" disabled={busy} onClick={()=>void savePermissions()}>{busy?'جاري الحفظ…':'حفظ الصلاحيات'}</button><button className="secondary" disabled={busy} onClick={()=>setPermTarget(null)}>إلغاء</button></div></Modal>}
 </section>
}
