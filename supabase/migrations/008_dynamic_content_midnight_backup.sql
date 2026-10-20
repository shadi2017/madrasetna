-- Apply after 007_backups.sql.
-- 1) Editable site content (dashboard texts, announcement, contact, login features).
-- 2) Backup runs after midnight for the study day that just ended.

alter table public.settings add column content jsonb not null default '{}'::jsonb
 check(jsonb_typeof(content)='object' and length(content::text)<=20000);

create function public.save_settings_v3(p_name text,p_slogan text,p_verse text,p_logo text,p_login_tagline text,p_login_title text,p_content jsonb,p_version integer) returns public.settings language plpgsql security definer set search_path='' as $$
declare r public.settings;
begin perform public.require_admin();
 if p_content is not null and (jsonb_typeof(p_content)<>'object' or length(p_content::text)>20000) then raise exception 'INVALID_CONFIG'; end if;
 update public.settings set name=trim(p_name),slogan=p_slogan,verse=p_verse,logo=p_logo,
 login_tagline=p_login_tagline,login_title=p_login_title,content=coalesce(p_content,content)
 where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;
 return r;
end $$;
revoke execute on function public.save_settings_v3(text,text,text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_settings_v3(text,text,text,text,text,text,jsonb,integer) to authenticated;

-- Backups run at 00:00 Cairo time for the previous study day.
alter table public.backup_settings alter column run_time set default '00:00';
update public.backup_settings set run_time='00:00' where run_time='23:30';
alter table public.backup_settings drop constraint if exists backup_settings_run_time_check;
alter table public.backup_settings add constraint backup_settings_run_time_check check(run_time >= '00:00' and run_time <= '06:00');

-- Compatibility for projects that applied an earlier copy of 007.
alter table public.backup_runs add column if not exists kind text not null default 'scheduled' check(kind in ('scheduled','manual'));
alter table public.backup_runs drop constraint if exists backup_runs_study_date_key;
alter table public.backup_runs drop constraint if exists backup_runs_study_date_kind_key;
alter table public.backup_runs add constraint backup_runs_study_date_kind_key unique(study_date,kind);
drop function if exists public.begin_backup(date,boolean);
create or replace function public.begin_backup(p_date date,p_force boolean default false,p_kind text default 'scheduled') returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.backup_runs; r public.backup_runs;
begin
 if p_kind not in ('scheduled','manual') then raise exception 'INVALID_CONFIG'; end if;
 perform pg_advisory_xact_lock(hashtext('backup:'||p_date::text||':'||p_kind)::bigint);
 select * into existing from public.backup_runs where study_date=p_date and kind=p_kind for update;
 if existing.id is not null then
  if existing.status='success' and not p_force then
   return jsonb_build_object('skip','already_done','id',existing.id);
  end if;
  if existing.status='running' and existing.started_at > now()-interval '15 minutes' then
   return jsonb_build_object('skip','in_progress','id',existing.id);
  end if;
  update public.backup_runs set status='running',started_at=now(),finished_at=null,size_bytes=0,tables='{}'::jsonb,targets='{}'::jsonb,error=''
  where id=existing.id returning * into r;
  return jsonb_build_object('id',r.id,'study_date',r.study_date,'kind',r.kind);
 end if;
 insert into public.backup_runs(study_date,kind,status,started_at,finished_at,size_bytes,tables,targets,error)
 values(p_date,p_kind,'running',now(),null,0,'{}'::jsonb,'{}'::jsonb,'')
 returning * into r;
 return jsonb_build_object('id',r.id,'study_date',r.study_date,'kind',r.kind);
end $$;
revoke execute on function public.begin_backup(date,boolean,text) from public,anon,authenticated;
grant execute on function public.begin_backup(date,boolean,text) to service_role;

create or replace function public.save_backup_settings(p_enabled boolean,p_run_time time,p_email text,p_retention integer,p_version integer) returns public.backup_settings language plpgsql security definer set search_path='' as $$
declare r public.backup_settings; e text:=coalesce(trim(p_email),'');
begin perform public.require_admin();
 if p_retention is null or p_retention<1 or p_retention>90 or p_run_time is null then raise exception 'INVALID_CONFIG'; end if;
 if p_run_time < '00:00'::time or p_run_time > '06:00'::time then raise exception 'INVALID_CONFIG'; end if;
 if length(e)>254 or (e<>'' and e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_CONFIG'; end if;
 update public.backup_settings set enabled=coalesce(p_enabled,false),run_time=p_run_time,email=e,retention=p_retention
 where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;
 return r;
end $$;

-- Keep the audit "restore" action aware of the new content field.
create or replace function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();select * into a from public.audit_log where id=p_audit;
 if not found or a.before_data is null then raise exception 'NO_PREVIOUS_VERSION';end if;
 if a.entity='profiles' then update public.profiles set status=coalesce(a.before_data->>'status',status),full_name=a.before_data->>'full_name',phone=a.before_data->>'phone',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='days' then update public.days set discipline_deadline=(a.before_data->>'discipline_deadline')::time,label=a.before_data->>'label',date=(a.before_data->>'date')::date,deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='evaluations' then update public.evaluations set scores=a.before_data->'scores',present=(a.before_data->>'present')::boolean,attended_at=(a.before_data->>'attended_at')::timestamptz,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='final_scores' then update public.final_scores set part_scores=a.before_data->'part_scores',competition=(a.before_data->>'competition')::numeric,project=(a.before_data->>'project')::numeric,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='grading' then update public.grading set competition_published=coalesce((a.before_data->>'competition_published')::boolean,false),project_published=coalesce((a.before_data->>'project_published')::boolean,false),config=a.before_data->'config',results_published=(a.before_data->>'results_published')::boolean where id=1 and version=p_version;
 elsif a.entity='settings' then update public.settings set content=coalesce(a.before_data->'content',content),login_title=coalesce(a.before_data->>'login_title',login_title),login_tagline=coalesce(a.before_data->>'login_tagline',login_tagline),name=a.before_data->>'name',slogan=a.before_data->>'slogan',verse=a.before_data->>'verse',logo=a.before_data->>'logo' where id=1 and version=p_version;
 else raise exception 'INVALID_ENTITY';end if;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;
end $$;
