-- Apply after 001_initial.sql. Existing students remain active; self signups start pending.
alter table public.profiles add column status text not null default 'active' check(status in ('pending','active','rejected'));
create function public.is_active_student() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null and status='active') $$;
create function public.on_student_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=NEW.raw_user_meta_data; u text;
begin
 if m->>'registration'='student' then
  u=lower(m->>'username');
  if u is null or NEW.email is distinct from u||'@students.invalid' then raise exception 'INVALID_STUDENT';end if;
  -- User-provided role/status fields are intentionally ignored.
  insert into public.profiles(id,username,full_name,phone,status) values(NEW.id,u,trim(m->>'full_name'),m->>'phone','pending');
 end if;return NEW;
end $$;
create trigger student_signup after insert on auth.users for each row execute function public.on_student_signup();
create function public.set_student_status(p_id uuid,p_status text,p_version integer) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_admin();
 if p_status not in ('active','rejected','pending') then raise exception 'INVALID_STUDENT';end if;
 update public.profiles set status=p_status where id=p_id and version=p_version and deleted_at is null;
 if not found then raise exception 'CONFLICT_REFRESH';end if;end $$;
drop policy profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated using(public.is_admin() or (id=auth.uid() and deleted_at is null));
drop policy day_read on public.days;
create policy day_read on public.days for select to authenticated using(public.is_admin() or (deleted_at is null and public.is_active_student()));
drop policy evaluation_read on public.evaluations;
create policy evaluation_read on public.evaluations for select to authenticated using(public.is_admin() or
(student_id=auth.uid() and deleted_at is null and public.is_active_student() and exists(select 1 from public.days where id=day_id and deleted_at is null)));

create table public.grading(
 id integer primary key default 1 check(id=1),config jsonb not null,
 results_published boolean not null default false,version integer not null default 1,updated_at timestamptz not null default now()
);
insert into public.grading(config) values('{"daily_max":{"attendance":10,"discipline":10,"bible":10,"devotion":10,"memory":10,"phone":10,"hymns":10,"games":10,"quiz":10},"daily_target":200,"parts":[{"id":"part_1","label":"الجزء 1","max":100},{"id":"part_2","label":"الجزء 2","max":100},{"id":"part_3","label":"الجزء 3","max":100}],"parts_target":200,"competition_max":100,"competition_target":200,"project_max":100,"project_target":200}'::jsonb);
create table public.final_scores(
 id uuid primary key default gen_random_uuid(),student_id uuid not null unique references public.profiles(id),
 part_scores jsonb not null default '{}',competition numeric not null default 0 check(competition>=0),project numeric not null default 0 check(project>=0),
 notes text not null default '' check(length(notes)<=2000),deleted_at timestamptz,version integer not null default 1,updated_at timestamptz not null default now()
);
-- Preserve old competition/project entries: aggregate them into a one-time score.
-- The old daily JSON remains intact for history; new daily calculations exclude those keys.
update public.grading set config=jsonb_set(jsonb_set(config,'{competition_max}',to_jsonb(greatest(100,(select count(*)::int*10 from public.days)))),'{project_max}',to_jsonb(greatest(100,(select count(*)::int*10 from public.days))));
insert into public.final_scores(student_id,competition,project)
 select e.student_id,coalesce(sum((e.scores->>'competition')::numeric),0),coalesce(sum((e.scores->>'project')::numeric),0)
 from public.evaluations e join public.days d on d.id=e.day_id and d.deleted_at is null where e.deleted_at is null
 group by e.student_id having count(*) filter(where e.scores?'competition' or e.scores?'project')>0;

create function public.valid_grading(c jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;p jsonb;ids text[]:='{}';n integer;
begin
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'daily_max') is distinct from 'object' or jsonb_typeof(c->'parts') is distinct from 'array' then return false;end if;
 select count(*) into n from jsonb_object_keys(c->'daily_max');if n<>9 then return false;end if;
 foreach k in array array['attendance','discipline','bible','devotion','memory','phone','hymns','games','quiz'] loop
  v=c->'daily_max'->k;if jsonb_typeof(v) is distinct from 'number' then return false;end if;
  if v::text::numeric<=0 or v::text::numeric>1000000 then return false;end if;
 end loop;
 foreach k in array array['daily_target','parts_target','competition_max','competition_target','project_max','project_target'] loop
  v=c->k;if jsonb_typeof(v) is distinct from 'number' then return false;end if;
  if v::text::numeric<=0 or v::text::numeric>1000000 then return false;end if;
 end loop;
 if jsonb_array_length(c->'parts') not between 1 and 100 then return false;end if;
 for p in select * from jsonb_array_elements(c->'parts') loop
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'id') is distinct from 'string' or jsonb_typeof(p->'label') is distinct from 'string' or coalesce(p->>'id','')!~'^[a-zA-Z0-9_-]{1,64}$' or length(trim(coalesce(p->>'label',''))) not between 1 and 100 or p->>'id'=any(ids) then return false;end if;
  ids=array_append(ids,p->>'id');v=p->'max';
  if jsonb_typeof(v) is distinct from 'number' then return false;end if;
  if v::text::numeric<=0 or v::text::numeric>1000000 then return false;end if;
 end loop;return true;
end $$;
alter table public.grading add constraint valid_grading_config check(public.valid_grading(config));
create or replace function public.valid_scores(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;n jsonb;
begin
 if jsonb_typeof(v) is distinct from 'object' then return false;end if;
 for k,n in select * from jsonb_each(v) loop
  if not(k=any(array['discipline','bible','devotion','memory','phone','hymns','games','quiz','competition','project'])) or jsonb_typeof(n)<>'number' then return false;end if;
  if n::text::numeric<0 or n::text::numeric>1000000 then return false;end if;
 end loop;return true;
end $$;
create function public.validate_score_bounds() returns trigger language plpgsql security definer set search_path='' as $$
declare c jsonb;k text;v jsonb;cap numeric;
begin
 select config into c from public.grading where id=1 for share;
 if TG_TABLE_NAME='evaluations' then
  for k,v in select * from jsonb_each(NEW.scores) loop
   if c->'daily_max'?k and (jsonb_typeof(v)<>'number' or v::text::numeric<0 or v::text::numeric>(c->'daily_max'->>k)::numeric) then raise exception 'SCORE_OUT_OF_RANGE';end if;
  end loop;
 else
  if jsonb_typeof(NEW.part_scores) is distinct from 'object' then raise exception 'SCORE_OUT_OF_RANGE';end if;
  if NEW.competition>(c->>'competition_max')::numeric or NEW.project>(c->>'project_max')::numeric then raise exception 'SCORE_OUT_OF_RANGE';end if;
  for k,v in select * from jsonb_each(NEW.part_scores) loop
   select (p->>'max')::numeric into cap from jsonb_array_elements(c->'parts') p where p->>'id'=k;
   if jsonb_typeof(v)<>'number' then raise exception 'SCORE_OUT_OF_RANGE';end if;
   if cap is null then if v::text::numeric=0 then continue;else raise exception 'SCORE_OUT_OF_RANGE';end if;end if;
   if v::text::numeric<0 or v::text::numeric>cap then raise exception 'SCORE_OUT_OF_RANGE';end if;
  end loop;
 end if;return NEW;
end $$;
create trigger evaluations_bounds before insert or update on public.evaluations for each row execute function public.validate_score_bounds();
create trigger final_scores_bounds before insert or update on public.final_scores for each row execute function public.validate_score_bounds();
create function public.validate_grading_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not public.valid_grading(NEW.config) then raise exception 'INVALID_CONFIG';end if;
 if exists(select 1 from public.evaluations e cross join lateral jsonb_each(e.scores) s where NEW.config->'daily_max'?s.key and s.value::text::numeric>(NEW.config->'daily_max'->>s.key)::numeric)
 or exists(select 1 from public.final_scores f where f.competition>(NEW.config->>'competition_max')::numeric or f.project>(NEW.config->>'project_max')::numeric)
 or exists(select 1 from public.final_scores f cross join lateral jsonb_each(f.part_scores) s where s.value::text::numeric>coalesce((select (p->>'max')::numeric from jsonb_array_elements(NEW.config->'parts') p where p->>'id'=s.key),0))
 then raise exception 'CONFIG_BELOW_EXISTING';end if;
 return NEW;
end $$;
create trigger grading_bounds before update on public.grading for each row execute function public.validate_grading_change();
create trigger grading_version before update on public.grading for each row execute function public.bump_version();
create trigger grading_audit after update on public.grading for each row execute function public.track_change();
create trigger final_scores_version before update on public.final_scores for each row execute function public.bump_version();
create trigger final_scores_audit after insert or update on public.final_scores for each row execute function public.track_change();
alter table public.grading enable row level security;
alter table public.final_scores enable row level security;
revoke all on public.grading,public.final_scores from anon,authenticated;
grant select on public.grading,public.final_scores to authenticated;
create policy grading_read on public.grading for select to authenticated using(public.is_admin() or public.is_active_student());
create policy final_read on public.final_scores for select to authenticated using(public.is_admin() or(student_id=auth.uid() and deleted_at is null and public.is_active_student()));

create function public.save_grading(p_config jsonb,p_published boolean,p_version integer) returns public.grading language plpgsql security definer set search_path='' as $$
declare r public.grading;
begin perform public.require_admin();
 update public.grading set config=p_config,results_published=p_published where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;return r;end $$;
create function public.save_final_scores(p_student uuid,p_parts jsonb,p_competition numeric,p_project numeric,p_notes text,p_version integer default 0) returns public.final_scores language plpgsql security definer set search_path='' as $$
declare r public.final_scores;
begin perform public.require_admin();
 perform 1 from public.profiles where id=p_student and status='active' and deleted_at is null for share;if not found then raise exception 'STUDENT_NOT_FOUND';end if;
 if p_version=0 then insert into public.final_scores(student_id,part_scores,competition,project,notes) values(p_student,p_parts,p_competition,p_project,p_notes) returning * into r;
 else update public.final_scores set part_scores=p_parts,competition=p_competition,project=p_project,notes=p_notes,deleted_at=null
 where student_id=p_student and version=p_version returning * into r;if not found then raise exception 'CONFLICT_REFRESH';end if;end if;
 return r;
end $$;
create function public.get_results() returns table(student_id uuid,daily numeric,parts numeric,competition numeric,project numeric,points numeric,max numeric,rank bigint,participants bigint)
language sql stable security definer set search_path='' as $$
with cfg as(select config c from public.grading where id=1 and (public.is_admin() or(results_published and public.is_active_student()))),
raw as(
 select p.id,
 coalesce((select sum(case when e.present then (c->'daily_max'->>'attendance')::numeric else 0 end+
 coalesce((select sum(v.value::text::numeric) from jsonb_each(e.scores) v where c->'daily_max'?v.key),0))
 from public.evaluations e join public.days d on d.id=e.day_id and d.deleted_at is null where e.student_id=p.id and e.deleted_at is null),0) daily_raw,
 (select count(*) from public.days where deleted_at is null)*(select sum(value::text::numeric) from jsonb_each(c->'daily_max')) daily_max,
 coalesce((select sum(coalesce((f.part_scores->>(v->>'id'))::numeric,0)) from jsonb_array_elements(c->'parts') v),0) parts_raw,
 (select sum((v->>'max')::numeric) from jsonb_array_elements(c->'parts') v) parts_max,
 coalesce(f.competition,0) comp_raw,coalesce(f.project,0) proj_raw,c
 from public.profiles p cross join cfg left join public.final_scores f on f.student_id=p.id and f.deleted_at is null
 where p.status='active' and p.deleted_at is null
), factored as(
 select id,coalesce(daily_raw/nullif(daily_max,0),0)*(c->>'daily_target')::numeric d,
 coalesce(parts_raw/nullif(parts_max,0),0)*(c->>'parts_target')::numeric m,
 comp_raw/(c->>'competition_max')::numeric*(c->>'competition_target')::numeric co,
 proj_raw/(c->>'project_max')::numeric*(c->>'project_target')::numeric pr,
 (c->>'daily_target')::numeric+(c->>'parts_target')::numeric+(c->>'competition_target')::numeric+(c->>'project_target')::numeric mx from raw
), totals as(select *,round(d+m+co+pr,2) pts from factored),
ranked as(select *,rank() over(order by pts desc) r,count(*) over() n from totals)
select id,round(d,2),round(m,2),round(co,2),round(pr,2),pts,mx,r,n from ranked where public.is_admin() or id=auth.uid() order by r,id
$$;


create or replace function public.save_evaluation(p_student uuid,p_day uuid,p_present boolean,p_scores jsonb,p_notes text,p_version integer default 0) returns public.evaluations language plpgsql security definer set search_path='' as $$
declare r public.evaluations;begin perform public.require_admin();
 if not public.valid_scores(p_scores) or p_scores?'competition' or p_scores?'project' then raise exception 'SCORE_OUT_OF_RANGE';end if;
 perform 1 from public.profiles where id=p_student and deleted_at is null and status='active' for share;if not found then raise exception 'STUDENT_NOT_FOUND';end if;
 perform 1 from public.days where id=p_day and deleted_at is null for share;if not found then raise exception 'DAY_NOT_FOUND';end if;
 if p_version=0 then
 insert into public.evaluations(student_id,day_id,present,attended_at,scores,notes)
 values(p_student,p_day,p_present,case when p_present then now() end,p_scores,p_notes) returning * into r;
 else
 update public.evaluations set present=p_present,attended_at=case when p_present then coalesce(attended_at,now()) end,scores=p_scores,notes=p_notes,deleted_at=null
 where student_id=p_student and day_id=p_day and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;
 end if;return r;end $$;
create or replace function public.scan_attendance(p_token uuid,p_day uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.profiles; r public.evaluations;changed boolean;
begin perform public.require_admin();
 select * into s from public.profiles where qr_token=p_token and deleted_at is null and status='active' for share;
 if not found then raise exception 'INVALID_QR';end if;
 perform 1 from public.days where id=p_day and deleted_at is null and date is not null for share;
 if not found then raise exception 'DAY_NEEDS_DATE';end if;
 insert into public.evaluations(student_id,day_id,present,attended_at) values(s.id,p_day,true,now())
 on conflict(student_id,day_id) do update set present=true,attended_at=now(),deleted_at=null
 where not evaluations.present or evaluations.deleted_at is not null returning * into r;
 changed=found;
 return jsonb_build_object('name',s.full_name,'duplicate',not changed);
end $$;
create or replace function public.rotate_qr(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_admin();update public.profiles set qr_token=gen_random_uuid() where id=p_id and deleted_at is null and status='active';
if not found then raise exception 'STUDENT_NOT_FOUND';end if;end $$;
create or replace function public.set_deleted(p_entity text,p_id uuid,p_deleted boolean,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;begin perform public.require_admin();
 if p_entity not in ('profiles','days','evaluations','final_scores') then raise exception 'INVALID_ENTITY';end if;
 execute format('update public.%I set deleted_at=$1 where id=$2 and version=$3',p_entity) using case when p_deleted then now() end,p_id,p_version;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;end $$;
create or replace function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();select * into a from public.audit_log where id=p_audit;
 if not found or a.before_data is null then raise exception 'NO_PREVIOUS_VERSION';end if;
 if a.entity='profiles' then update public.profiles set status=coalesce(a.before_data->>'status',status),full_name=a.before_data->>'full_name',phone=a.before_data->>'phone',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='days' then update public.days set label=a.before_data->>'label',date=(a.before_data->>'date')::date,deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='evaluations' then update public.evaluations set scores=a.before_data->'scores',present=(a.before_data->>'present')::boolean,attended_at=(a.before_data->>'attended_at')::timestamptz,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='final_scores' then update public.final_scores set part_scores=a.before_data->'part_scores',competition=(a.before_data->>'competition')::numeric,project=(a.before_data->>'project')::numeric,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='grading' then update public.grading set config=a.before_data->'config',results_published=(a.before_data->>'results_published')::boolean where id=1 and version=p_version;
 elsif a.entity='settings' then update public.settings set name=a.before_data->>'name',slogan=a.before_data->>'slogan',verse=a.before_data->>'verse',logo=a.before_data->>'logo' where id=1 and version=p_version;
 else raise exception 'INVALID_ENTITY';end if;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;
end $$;
revoke execute on function public.is_active_student(),public.on_student_signup(),public.set_student_status(uuid,text,integer),public.valid_grading(jsonb),public.validate_score_bounds(),public.validate_grading_change(),public.save_grading(jsonb,boolean,integer),public.save_final_scores(uuid,jsonb,numeric,numeric,text,integer),public.get_results() from public,anon,authenticated;
grant execute on function public.is_active_student(),public.set_student_status(uuid,text,integer),public.save_grading(jsonb,boolean,integer),public.save_final_scores(uuid,jsonb,numeric,numeric,text,integer),public.get_results() to authenticated;
alter publication supabase_realtime add table public.grading,public.final_scores;

-- Publish a payload-free revision so another student's score can refresh rankings
-- without exposing that student's protected evaluation through Realtime.
create table public.results_signal(id integer primary key default 1 check(id=1),revision bigint not null default 0);
insert into public.results_signal(id) values(1);
alter table public.results_signal enable row level security;
revoke all on public.results_signal from anon,authenticated;
grant select on public.results_signal to authenticated;
create policy results_signal_read on public.results_signal for select to authenticated using(public.is_admin() or public.is_active_student());
create function public.signal_results_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.results_signal set revision=revision+1 where id=1;return NEW;end $$;
revoke execute on function public.signal_results_changed() from public,anon,authenticated;
create trigger evaluations_signal after insert or update on public.evaluations for each row execute function public.signal_results_changed();
create trigger finals_signal after insert or update on public.final_scores for each row execute function public.signal_results_changed();
create trigger profiles_signal after insert or update on public.profiles for each row execute function public.signal_results_changed();
create trigger days_signal after insert or update on public.days for each row execute function public.signal_results_changed();
create trigger grading_signal after update on public.grading for each row execute function public.signal_results_changed();
alter publication supabase_realtime add table public.results_signal;

