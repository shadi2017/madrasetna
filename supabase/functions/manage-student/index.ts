import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async req => {
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 try{
 const url=Deno.env.get('SUPABASE_URL')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!;
 const text=await req.text();if(text.length>10000)return reply({error:'REQUEST_TOO_LARGE'},413);
 const b=JSON.parse(text);
 const authorization=req.headers.get('Authorization')||'';
 const token=authorization.replace(/^Bearer /i,'');
 const admin=createClient(url,service,{auth:{persistSession:false}});
 if(b.action==='recover_admin'){
  const generic={ok:true};
  if(typeof b.email!=='string'||b.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))return reply(generic);
  const {data:email,error:reserveError}=await admin.rpc('reserve_admin_recovery',{p_email:b.email.trim().toLowerCase()});
  if(reserveError)return reply({error:'RECOVERY_UNAVAILABLE'},503);
  if(email){const {error}=await admin.auth.resetPasswordForEmail(email,{redirectTo:'https://shadi2017.github.io/madrasetna/'});
   if(error){console.error('Admin recovery delivery failed',error.code||error.status);return reply({error:'RECOVERY_UNAVAILABLE'},503);}}
  return reply(generic);
 }
 // Verify every request against Auth; a decoded JWT is never trusted on its own.
 const {data:identity,error:authError}=await admin.auth.getUser(token);
 if(authError||!identity.user)return reply({error:'UNAUTHORIZED'},401);
 const user=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
 const {data:role,error:roleError}=await user.rpc('is_admin');
 if(roleError||role!==true)return reply({error:'ADMIN_REQUIRED'},403);

 if(typeof b.password!=='string'||b.password.length<6||b.password.length>128)return reply({error:'PASSWORD_LENGTH'},400);
 if(b.action==='create_staff'){
  const {data:owner,error:ownerError}=await user.rpc('is_owner');
  if(ownerError||owner!==true)return reply({error:'OWNER_REQUIRED'},403);
  if(typeof b.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||b.email.length>254)return reply({error:'INVALID_STUDENT'},400);
  const {data:created,error}=await admin.auth.admin.createUser({email:b.email.trim(),password:b.password,email_confirm:true});
  if(error)return reply({error:'USERNAME_EXISTS_OR_INVALID'},409);
  const {error:grantError}=await user.rpc('set_staff',{p_email:created.user.email,p_enabled:true});
  if(grantError){await admin.auth.admin.deleteUser(created.user.id);return reply({error:'PROFILE_CREATE_FAILED'},400)}
  return reply({ok:true});
 }
 if(b.action==='create'){

  if(!/^[a-z0-9_]{3,32}$/.test(b.username||'')||typeof b.name!=='string'||b.name.trim().length<2||b.name.length>100||!/^\+?[0-9]{8,15}$/.test(b.phone||''))return reply({error:'INVALID_STUDENT'},400);
  const {data:created,error}=await admin.auth.admin.createUser({email:b.username+'@students.invalid',password:b.password,email_confirm:true});
  if(error)return reply({error:'USERNAME_EXISTS_OR_INVALID'},409);
  const {data:profile,error:profileError}=await user.rpc('create_student_profile',{p_id:created.user.id,p_username:b.username,p_name:b.name,p_phone:b.phone});
  if(profileError){
   const cleanup=await admin.auth.admin.deleteUser(created.user.id);
   // Never log a password or token.
   if(cleanup.error)console.error('Orphan account needs administrator cleanup',created.user.id);
   return reply({error:'PROFILE_CREATE_FAILED'},400);
  }
  return reply({profile});
 }
 if(b.action==='reset'){
  const {data:owner,error:ownerError}=await user.rpc('is_owner');
  if(ownerError||owner!==true)return reply({error:'OWNER_REQUIRED'},403);
  const {data:staff}=await admin.from('admins').select('user_id').eq('user_id',b.id).maybeSingle();
  if(staff)return reply({error:'OWNER_PROTECTED'},403);
  const {data:profile,error}=await user.from('profiles').select('id').eq('id',b.id).is('deleted_at',null).single();
  if(error||!profile)return reply({error:'STUDENT_NOT_FOUND'},404);
  const {error:resetError}=await admin.auth.admin.updateUserById(profile.id,{password:b.password});
  if(resetError)return reply({error:'PASSWORD_RESET_FAILED'},400);
  const {error:logError}=await user.rpc('log_password_reset',{p_id:profile.id});
  return reply({ok:true,warning:logError?'AUDIT_WRITE_FAILED':null});
 }
 return reply({error:'INVALID_ACTION'},400);
 }catch{return reply({error:'REQUEST_FAILED'},400);}
});
