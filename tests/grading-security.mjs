import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {defaultConfig,summary} from '../app/core/model.ts';
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.query||'');process.exit(1)});
const db=new PGlite();let checks=0;
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of ['001_initial.sql','002_registration_grading.sql']){let s=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');s=s.replace('create extension if not exists pgcrypto;','').replace(/alter publication supabase_realtime add table[^;]+;/g,'');await db.exec(s)}
const admin='10000000-0000-4000-8000-000000000001',a='20000000-0000-4000-8000-000000000002',b='30000000-0000-4000-8000-000000000003',c='40000000-0000-4000-8000-000000000004',pending='50000000-0000-4000-8000-000000000005';
await db.query('insert into auth.users(id,email) values($1,$2)',[admin,'admin@example.com']);await db.query('insert into public.admins(user_id) values($1)',[admin]);
for(const [id,username]of [[a,'student_a'],[b,'student_b'],[c,'student_c'],[pending,'pending_1']])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,username+'@students.invalid',{registration:'student',username,full_name:'طالب '+username,phone:'01012345678',status:'active',role:'admin'}]);
async function login(id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role)}
async function one(q,p=[]){return (await db.query(q,p)).rows[0]}
async function scalar(q,p=[]){return Object.values(await one(q,p)||{})[0]}
async function denied(q,p=[],pattern=/ADMIN_REQUIRED|permission denied/){await assert.rejects(()=>db.query(q,p),pattern);checks++}
function eq(x,y,label){assert.deepEqual(x,y,label);checks++}
await login(pending);
eq(await scalar('select status from public.profiles'),'pending','metadata cannot self-approve');
eq(await scalar('select public.is_admin()'),false,'metadata cannot grant admin');
eq(await scalar('select count(*)::int from public.profiles'),1,'pending reads only own profile');
eq(await scalar('select count(*)::int from public.days'),0);
eq(await scalar('select count(*)::int from public.grading'),0);
eq((await db.query('select * from public.get_results()')).rows,[]);
await denied("select public.set_student_status($1,'active',1)",[pending]);
await denied("update public.profiles set status='active' where id=$1",[pending]);
await denied('select public.on_student_signup()');
await login(admin);
for(const id of [a,b,c])await db.query("select public.set_student_status($1,'active',1)",[id]);
const day1=await scalar("select to_jsonb(public.save_day(null,'الأول','2026-09-11',0))"),day2=await scalar("select to_jsonb(public.save_day(null,'الثاني','2026-09-12',0))");
const pendingToken=await scalar('select qr_token from public.profiles where id=$1',[pending]);
await denied('select public.scan_attendance($1,$2)',[pendingToken,day1.id],/INVALID_QR/);
await denied("select public.save_evaluation($1,$2,true,'{}','',0)",[pending,day1.id],/STUDENT_NOT_FOUND/);
const config=structuredClone(defaultConfig);config.daily_max.quiz=20;config.parts=[{id:'part_1',label:'الأول',max:100},{id:'part_2',label:'الثاني',max:100}];config.project_max=40;
await db.query('select public.save_grading($1,false,1)',[config]);
const scores={discipline:10,bible:10,devotion:10,memory:10,phone:10,hymns:10,games:10,quiz:20};
for(const id of [a,b]){for(const day of [day1,day2])await db.query("select public.save_evaluation($1,$2,true,$3,'',0)",[id,day.id,scores]);await db.query("select public.save_final_scores($1,$2,50,20,'',0)",[id,{part_1:100,part_2:50}])}
const results=(await db.query('select * from public.get_results()')).rows;
eq(results.length,3,'pending excluded from ranking');
eq(Number(results[0].daily),200);eq(Number(results[0].parts),150);eq(Number(results[0].competition),100);eq(Number(results[0].project),100);eq(Number(results[0].points),550);eq(Number(results[0].max),800);
eq(results.map(r=>Number(r.rank)),[1,1,3],'competition ranking handles ties');
const sample={students:[{id:a}],days:[day1,day2],evaluations:[day1,day2].map(d=>({student_id:a,day_id:d.id,present:true,scores,deleted_at:null})),finals:[{student_id:a,part_scores:{part_1:100,part_2:50},competition:50,project:20,deleted_at:null}],grading:{config}};
eq(summary({id:a},sample).points,Number(results[0].points),'JS and PostgreSQL factors agree');
await denied("select public.save_final_scores($1,$2,101,20,'',1)",[a,{}],/SCORE_OUT_OF_RANGE/);
await denied("select public.save_final_scores($1,$2,50,20,'',1)",[a,{fake:10}],/SCORE_OUT_OF_RANGE/);
await denied("select public.save_evaluation($1,$2,true,$3,'',1)",[a,day1.id,{quiz:21}],/SCORE_OUT_OF_RANGE/);
await denied("select public.save_evaluation($1,$2,true,$3,'',1)",[a,day1.id,{competition:10}],/SCORE_OUT_OF_RANGE/);
const bad=structuredClone(config);bad.daily_max.quiz=0;await denied('select public.save_grading($1,false,2)',[bad],/INVALID_CONFIG/);
bad.daily_max.quiz=10;await denied('select public.save_grading($1,false,2)',[bad],/CONFIG_BELOW_EXISTING/);
const removed=structuredClone(config);removed.parts=removed.parts.slice(0,1);await denied('select public.save_grading($1,false,2)',[removed],/CONFIG_BELOW_EXISTING/);
await login(a);
eq((await db.query('select * from public.get_results()')).rows,[],'results inaccessible before publication');
eq(await scalar('select count(*)::int from public.final_scores'),1,'one-time scores are private');
await denied('select public.save_grading($1,true,2)',[config]);
await denied("select public.save_final_scores($1,'{}',0,0,'',1)",[a]);
await denied('select public.valid_grading($1)',[config]);
await login(admin);await db.query('select public.save_grading($1,true,2)',[config]);
await login(a);const own=(await db.query('select * from public.get_results()')).rows;
eq(own.length,1,'only own published result returned');eq(own[0].student_id,a);eq(Number(own[0].rank),1);eq(Number(own[0].participants),3);
await login(pending);eq((await db.query('select * from public.get_results()')).rows,[],'pending cannot access published results');
await login(null,'anon');await denied('select * from public.get_results()');await denied('select * from public.final_scores');await denied('select * from public.grading');
await login(admin);await db.query('select public.save_grading($1,false,3)',[config]);await login(a);eq((await db.query('select * from public.get_results()')).rows,[],'unpublish revokes results');
await login(admin);await db.query("select public.set_student_status($1,'rejected',2)",[b]);await login(b);eq(await scalar('select count(*)::int from public.evaluations'),0,'deactivation blocks grades');eq(await scalar('select count(*)::int from public.final_scores'),0);
await login(admin);const final=await one('select * from public.final_scores where student_id=$1',[a]);await db.query("select public.set_deleted('final_scores',$1,true,$2)",[final.id,final.version]);
eq(Number((await db.query('select * from public.get_results() where student_id=$1',[a])).rows[0].points),200,'deleted finals excluded');
await db.query("select public.set_deleted('final_scores',$1,false,$2)",[final.id,final.version+1]);
eq(Number((await db.query('select * from public.get_results() where student_id=$1',[a])).rows[0].points),550,'finals restoration recalculates total');
eq(await scalar("select count(*)::int from public.audit_log where entity='grading'"),3,'grading changes audited');
await db.exec('reset role');
await denied("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'other@example.com',$1)",[{registration:'student',username:'forged_1',full_name:'طالب مزور',phone:'01012345678'}],/INVALID_STUDENT/);
console.log('PASS: '+checks+' registration, approval, publication, privacy, factor, ranking and dynamic-limit checks.');await db.close();

