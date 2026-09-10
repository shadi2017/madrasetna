-- Run once in a NEW Supabase project. No student passwords are stored in public tables.
create extension if not exists pgcrypto;
create table public.admins (user_id uuid primary key references auth.users(id), created_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.admins where user_id=auth.uid()) $$;
create table public.settings (
 id integer primary key default 1 check(id=1), name text not null default 'مدرستنا' check(length(name) between 1 and 100),
 slogan text not null default '' check(length(slogan)<=250), verse text not null default '' check(length(verse)<=1000),
 logo text not null default '' check(length(logo)<=400000 and (logo='' or logo ~ '^data:image/(png|jpeg|webp);base64,')),
 version integer not null default 1, updated_at timestamptz not null default now()
);
insert into public.settings(id) values(1);
create table public.profiles (
 id uuid primary key references auth.users(id), username text not null unique check(username ~ '^[a-z0-9_]{3,32}$'),
 full_name text not null check(length(trim(full_name)) between 2 and 100),
 phone text not null check(phone ~ '^\+?[0-9]{8,15}$'),
 qr_token uuid not null default gen_random_uuid() unique,
 deleted_at timestamptz, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.days (
 id uuid primary key default gen_random_uuid(), label text not null check(length(trim(label)) between 1 and 100),
 date date, deleted_at timestamptz, version integer not null default 1, updated_at timestamptz not null default now()
);
create unique index unique_active_day_date on public.days(date) where deleted_at is null;
create function public.valid_scores(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; n jsonb;
begin
 if jsonb_typeof(v) <> 'object' then return false; end if;
 for k,n in select * from jsonb_each(v) loop
  if not(k=any(array['discipline','bible','devotion','memory','phone','hymns','games','quiz','competition','project'])) then return false; end if;
  if jsonb_typeof(n)<>'number' then return false; end if;
  if n::text::numeric<0 or n::text::numeric>10 then return false; end if;
 end loop;
 return true;
end $$;
create table public.evaluations (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id),
 day_id uuid not null references public.days(id), present boolean not null default false,
 attended_at timestamptz, scores jsonb not null default '{}' check(public.valid_scores(scores)),
 notes text not null default '' check(length(notes)<=2000), deleted_at timestamptz,
 version integer not null default 1, updated_at timestamptz not null default now(), unique(student_id,day_id)
);
create index evaluations_day on public.evaluations(day_id);
create table public.audit_log (
 id uuid primary key default gen_random_uuid(), entity text not null, record_id text not null,
 action text not null, actor_id uuid, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index audit_time on public.audit_log(created_at desc);
create function public.track_change() returns trigger language plpgsql security definer set search_path='' as $$
begin

 insert into public.audit_log(entity,record_id,action,actor_id,before_data,after_data)
 values(TG_TABLE_NAME,NEW.id::text,case when TG_OP='INSERT' then 'create'
 when to_jsonb(NEW)->>'deleted_at' is not null and to_jsonb(OLD)->>'deleted_at' is null then 'delete'
 when to_jsonb(NEW)->>'deleted_at' is null and to_jsonb(OLD)->>'deleted_at' is not null then 'restore' else 'update' end,
 auth.uid(),case when TG_OP='UPDATE' then to_jsonb(OLD) else null end,to_jsonb(NEW));
 return NEW;
end $$;
create function public.bump_version() returns trigger language plpgsql set search_path='' as $$
begin NEW.version=OLD.version+1;NEW.updated_at=clock_timestamp();return NEW;end $$;
create trigger profiles_version before update on public.profiles for each row execute function public.bump_version();
create trigger days_version before update on public.days for each row execute function public.bump_version();
create trigger evaluations_version before update on public.evaluations for each row execute function public.bump_version();
create trigger settings_version before update on public.settings for each row execute function public.bump_version();
create trigger profiles_audit after insert or update on public.profiles for each row execute function public.track_change();
create trigger days_audit after insert or update on public.days for each row execute function public.track_change();
create trigger evaluations_audit after insert or update on public.evaluations for each row execute function public.track_change();
create trigger settings_audit after update on public.settings for each row execute function public.track_change();
alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.days enable row level security;
alter table public.evaluations enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.admins, public.settings, public.profiles, public.days, public.evaluations, public.audit_log from anon,authenticated;
grant select on public.admins, public.settings, public.profiles, public.days, public.evaluations, public.audit_log to authenticated;
-- Only branding is public. No student or administrative data is exposed.
grant select on public.settings to anon;
create policy admins_self on public.admins for select to authenticated using(user_id=auth.uid());
create policy settings_read on public.settings for select to anon,authenticated using(true);
create policy profile_read on public.profiles for select to authenticated using(public.is_admin() or (id=auth.uid() and deleted_at is null));
create policy day_read on public.days for select to authenticated using(public.is_admin() or (deleted_at is null and exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null)));
create policy evaluation_read on public.evaluations for select to authenticated using(public.is_admin() or
 (student_id=auth.uid() and deleted_at is null and exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null)
 and exists(select 1 from public.days where id=day_id and deleted_at is null)));
create policy audit_read on public.audit_log for select to authenticated using(public.is_admin());
-- All writes go through guarded functions; table write privileges are not granted.
create function public.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if; end $$;
create function public.create_student_profile(p_id uuid,p_username text,p_name text,p_phone text) returns public.profiles language plpgsql security definer set search_path='' as $$
declare r public.profiles;
begin perform public.require_admin();
 if exists(select 1 from public.admins where user_id=p_id) then raise exception 'INVALID_STUDENT'; end if;
 insert into public.profiles(id,username,full_name,phone) values(p_id,lower(p_username),trim(p_name),p_phone) returning * into r;return r;
end $$;
create function public.save_profile(p_id uuid,p_name text,p_phone text,p_version integer) returns public.profiles language plpgsql security definer set search_path='' as $$
declare r public.profiles;begin perform public.require_admin();
 update public.profiles set full_name=trim(p_name),phone=p_phone where id=p_id and version=p_version and deleted_at is null returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;return r;end $$;
create function public.save_day(p_id uuid,p_label text,p_date date,p_version integer default 0) returns public.days language plpgsql security definer set search_path='' as $$
declare r public.days;begin perform public.require_admin();
 if p_id is null then insert into public.days(label,date) values(trim(p_label),p_date) returning * into r;
 else update public.days set label=trim(p_label),date=p_date where id=p_id and version=p_version and deleted_at is null returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;end if;return r;end $$;
create function public.save_settings(p_name text,p_slogan text,p_verse text,p_logo text,p_version integer) returns public.settings language plpgsql security definer set search_path='' as $$
declare r public.settings;begin perform public.require_admin();
 update public.settings set name=trim(p_name),slogan=p_slogan,verse=p_verse,logo=p_logo where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;return r;end $$;
create function public.save_evaluation(p_student uuid,p_day uuid,p_present boolean,p_scores jsonb,p_notes text,p_version integer default 0) returns public.evaluations language plpgsql security definer set search_path='' as $$
declare r public.evaluations;begin perform public.require_admin();
 perform 1 from public.profiles where id=p_student and deleted_at is null for share;if not found then raise exception 'STUDENT_NOT_FOUND';end if;
 perform 1 from public.days where id=p_day and deleted_at is null for share;if not found then raise exception 'DAY_NOT_FOUND';end if;
 if p_version=0 then
 insert into public.evaluations(student_id,day_id,present,attended_at,scores,notes)
 values(p_student,p_day,p_present,case when p_present then now() end,p_scores,p_notes) returning * into r;
 else
 update public.evaluations set present=p_present,attended_at=case when p_present then coalesce(attended_at,now()) end,scores=p_scores,notes=p_notes,deleted_at=null
 where student_id=p_student and day_id=p_day and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;
 end if;return r;end $$;
create function public.scan_attendance(p_token uuid,p_day uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.profiles; r public.evaluations;changed boolean;
begin perform public.require_admin();
 select * into s from public.profiles where qr_token=p_token and deleted_at is null for share;
 if not found then raise exception 'INVALID_QR';end if;
 perform 1 from public.days where id=p_day and deleted_at is null and date is not null for share;
 if not found then raise exception 'DAY_NEEDS_DATE';end if;
 insert into public.evaluations(student_id,day_id,present,attended_at) values(s.id,p_day,true,now())
 on conflict(student_id,day_id) do update set present=true,attended_at=now(),deleted_at=null
 where not evaluations.present or evaluations.deleted_at is not null returning * into r;
 changed=found;
 return jsonb_build_object('name',s.full_name,'duplicate',not changed);
end $$;
create function public.set_deleted(p_entity text,p_id uuid,p_deleted boolean,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;begin perform public.require_admin();
 if p_entity not in ('profiles','days','evaluations') then raise exception 'INVALID_ENTITY';end if;
 execute format('update public.%I set deleted_at=$1 where id=$2 and version=$3',p_entity) using case when p_deleted then now() end,p_id,p_version;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;end $$;
create function public.rotate_qr(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_admin();update public.profiles set qr_token=gen_random_uuid() where id=p_id and deleted_at is null;
if not found then raise exception 'STUDENT_NOT_FOUND';end if;end $$;
create function public.log_password_reset(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.require_admin();
 insert into public.audit_log(entity,record_id,action,actor_id) values('profiles',p_id::text,'password_reset',auth.uid());
end $$;
create function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();select * into a from public.audit_log where id=p_audit;
 if not found or a.before_data is null then raise exception 'NO_PREVIOUS_VERSION';end if;
 if a.entity='profiles' then update public.profiles set full_name=a.before_data->>'full_name',phone=a.before_data->>'phone',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='days' then update public.days set label=a.before_data->>'label',date=(a.before_data->>'date')::date,deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='evaluations' then update public.evaluations set scores=a.before_data->'scores',present=(a.before_data->>'present')::boolean,attended_at=(a.before_data->>'attended_at')::timestamptz,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='settings' then update public.settings set name=a.before_data->>'name',slogan=a.before_data->>'slogan',verse=a.before_data->>'verse',logo=a.before_data->>'logo' where id=1 and version=p_version;
 else raise exception 'INVALID_ENTITY';end if;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;
end $$;
-- Explicitly revoke PostgreSQL's default PUBLIC function execution.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.valid_scores(jsonb) to authenticated;
grant execute on function public.create_student_profile(uuid,text,text,text),public.save_profile(uuid,text,text,integer),
 public.save_day(uuid,text,date,integer),public.save_settings(text,text,text,text,integer),
 public.save_evaluation(uuid,uuid,boolean,jsonb,text,integer),public.scan_attendance(uuid,uuid),
 public.set_deleted(text,uuid,boolean,integer),public.rotate_qr(uuid),public.log_password_reset(uuid),public.restore_revision(uuid,integer) to authenticated;
-- Publishing only these tables respects their SELECT row policies.
alter publication supabase_realtime add table public.profiles,public.days,public.evaluations,public.settings;


