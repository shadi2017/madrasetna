-- Existing administrators remain owners. Newly delegated staff cannot reset passwords or delegate roles.
alter table public.admins add column is_owner boolean not null default false;
update public.admins set is_owner=true where is_owner=false;
create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.admins where user_id=auth.uid() and is_owner) $$;
create function public.require_owner() returns void language plpgsql security definer set search_path='' as $$ begin if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;end $$;
create function public.list_staff() returns table(user_id uuid,email text,is_owner boolean) language plpgsql security definer set search_path='' as $$ begin perform public.require_owner();return query select a.user_id,u.email::text,a.is_owner from public.admins a join auth.users u on u.id=a.user_id order by a.is_owner desc,u.email;end $$;
create function public.set_staff(p_email text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin perform public.require_owner();
 select id into target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'ACCOUNT_NOT_FOUND';end if;
 if exists(select 1 from public.admins where user_id=target and is_owner) then raise exception 'OWNER_PROTECTED';end if;
 if p_enabled then insert into public.admins(user_id,is_owner) values(target,false) on conflict do nothing;
 else delete from public.admins where user_id=target and not is_owner;end if;
 insert into public.audit_log(entity,record_id,action,actor_id,after_data) values('admins',target::text,case when p_enabled then 'grant_staff' else 'revoke_staff' end,auth.uid(),jsonb_build_object('enabled',p_enabled));
end $$;
-- Staff cannot use the old profile creation RPC to turn another staff account into a student.
create or replace function public.create_student_profile(p_id uuid,p_username text,p_name text,p_phone text) returns public.profiles language plpgsql security definer set search_path='' as $$
declare r public.profiles;begin perform public.require_admin();
 if exists(select 1 from public.admins where user_id=p_id) then raise exception 'INVALID_STUDENT';end if;
 insert into public.profiles(id,username,full_name,phone) values(p_id,lower(p_username),trim(p_name),p_phone) returning * into r;return r;end $$;

alter table public.grading add column competition_published boolean not null default false,add column project_published boolean not null default false;
create function public.save_grading_v2(p_config jsonb,p_published boolean,p_competition_published boolean,p_project_published boolean,p_version integer) returns public.grading language plpgsql security definer set search_path='' as $$
declare r public.grading;begin perform public.require_admin();
 update public.grading set config=p_config,results_published=p_published,competition_published=p_competition_published,project_published=p_project_published where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;return r;end $$;
drop policy final_read on public.final_scores;
create policy final_read on public.final_scores for select to authenticated using(public.is_admin());
create function public.get_final_scores() returns setof jsonb language sql stable security definer set search_path='' as $$
 select case when public.is_admin() then to_jsonb(f) else to_jsonb(f)||jsonb_build_object('competition',case when g.competition_published then f.competition end,'project',case when g.project_published then f.project end,'notes',case when g.competition_published and g.project_published then f.notes else '' end) end
 from public.final_scores f cross join public.grading g where g.id=1 and (public.is_admin() or(f.student_id=auth.uid() and f.deleted_at is null and public.is_active_student()))
$$;
alter function public.get_results() rename to get_results_internal;
revoke execute on function public.get_results_internal() from public,anon,authenticated;
create function public.get_results() returns table(student_id uuid,daily numeric,parts numeric,competition numeric,project numeric,points numeric,max numeric,rank bigint,participants bigint)
language sql stable security definer set search_path='' as $$
 select r.student_id,r.daily,r.parts,case when public.is_admin() or g.competition_published then r.competition end,case when public.is_admin() or g.project_published then r.project end,r.points,r.max,r.rank,r.participants
 from public.get_results_internal() r cross join public.grading g where g.id=1
$$;

alter table public.days add column discipline_deadline time;
create function public.save_day_v2(p_id uuid,p_label text,p_date date,p_deadline time,p_version integer default 0) returns public.days language plpgsql security definer set search_path='' as $$
declare r public.days;begin perform public.require_admin();
 if p_id is null then insert into public.days(label,date,discipline_deadline) values(trim(p_label),p_date,p_deadline) returning * into r;
 else update public.days set label=trim(p_label),date=p_date,discipline_deadline=p_deadline where id=p_id and version=p_version and deleted_at is null returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;end if;return r;end $$;
create or replace function public.scan_attendance(p_token uuid,p_day uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.profiles; d public.days; r public.evaluations; eligible boolean; mark numeric; changed boolean;
begin perform public.require_admin();
 select * into s from public.profiles where qr_token=p_token and deleted_at is null and status='active' for share;if not found then raise exception 'INVALID_QR';end if;
 select * into d from public.days where id=p_day and deleted_at is null and date is not null for share;if not found then raise exception 'DAY_NEEDS_DATE';end if;
 eligible=d.discipline_deadline is not null and (now() at time zone 'Africa/Cairo')::date=d.date and (now() at time zone 'Africa/Cairo')::time<=d.discipline_deadline;
 select (config->'daily_max'->>'discipline')::numeric into mark from public.grading where id=1 for share;
 insert into public.evaluations(student_id,day_id,present,attended_at,scores) values(s.id,p_day,true,now(),case when eligible then jsonb_build_object('discipline',mark) else '{}'::jsonb end)
 on conflict(student_id,day_id) do update set present=true,attended_at=now(),deleted_at=null,
 scores=case when eligible then jsonb_set(evaluations.scores,'{discipline}',to_jsonb(mark)) else evaluations.scores end
 where not evaluations.present or evaluations.deleted_at is not null returning * into r;
 changed=found;return jsonb_build_object('name',s.full_name,'duplicate',not changed,'discipline_awarded',changed and eligible);
end $$;

revoke execute on function public.is_owner(),public.require_owner(),public.list_staff(),public.set_staff(text,boolean),public.save_grading_v2(jsonb,boolean,boolean,boolean,integer),public.get_final_scores(),public.get_results(),public.save_day_v2(uuid,text,date,time,integer) from public,anon,authenticated;
grant execute on function public.is_owner(),public.list_staff(),public.set_staff(text,boolean),public.save_grading_v2(jsonb,boolean,boolean,boolean,integer),public.get_final_scores(),public.get_results(),public.save_day_v2(uuid,text,date,time,integer) to authenticated;
-- The existing result signal also refreshes role changes, without exposing staff identities.
create trigger admins_signal after insert or update or delete on public.admins for each row execute function public.signal_results_changed();

create or replace function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();select * into a from public.audit_log where id=p_audit;
 if not found or a.before_data is null then raise exception 'NO_PREVIOUS_VERSION';end if;
 if a.entity='profiles' then update public.profiles set status=coalesce(a.before_data->>'status',status),full_name=a.before_data->>'full_name',phone=a.before_data->>'phone',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='days' then update public.days set discipline_deadline=(a.before_data->>'discipline_deadline')::time,label=a.before_data->>'label',date=(a.before_data->>'date')::date,deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='evaluations' then update public.evaluations set scores=a.before_data->'scores',present=(a.before_data->>'present')::boolean,attended_at=(a.before_data->>'attended_at')::timestamptz,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='final_scores' then update public.final_scores set part_scores=a.before_data->'part_scores',competition=(a.before_data->>'competition')::numeric,project=(a.before_data->>'project')::numeric,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='grading' then update public.grading set competition_published=coalesce((a.before_data->>'competition_published')::boolean,false),project_published=coalesce((a.before_data->>'project_published')::boolean,false),config=a.before_data->'config',results_published=(a.before_data->>'results_published')::boolean where id=1 and version=p_version;
 elsif a.entity='settings' then update public.settings set name=a.before_data->>'name',slogan=a.before_data->>'slogan',verse=a.before_data->>'verse',logo=a.before_data->>'logo' where id=1 and version=p_version;
 else raise exception 'INVALID_ENTITY';end if;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;
end $$;
