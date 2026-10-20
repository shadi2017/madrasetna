-- Apply after 006_efficient_sync.sql.
-- Daily backup settings + run history. Writes are RPC/service-role only.
create table public.backup_settings (
 id integer primary key default 1 check(id=1),
 enabled boolean not null default false,
 run_time time not null default '00:00',
 email text not null default '' check(length(email)<=254),
 retention integer not null default 14 check(retention between 1 and 90),
 version integer not null default 1, updated_at timestamptz not null default now()
);
insert into public.backup_settings(id) values(1);

create table public.backup_runs (
 id uuid primary key default gen_random_uuid(), study_date date not null,
 kind text not null default 'scheduled' check(kind in ('scheduled','manual')),
 status text not null default 'running' check(status in ('running','success','partial','failed')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 size_bytes bigint not null default 0, tables jsonb not null default '{}'::jsonb,
 targets jsonb not null default '{}'::jsonb, error text not null default '',
 created_at timestamptz not null default now(), unique(study_date,kind)
);
create index backup_runs_time on public.backup_runs(started_at desc);

create trigger backup_settings_version before update on public.backup_settings for each row execute function public.bump_version();

alter table public.backup_settings enable row level security;
alter table public.backup_runs enable row level security;
revoke all on public.backup_settings, public.backup_runs from anon,authenticated;
grant select on public.backup_settings, public.backup_runs to authenticated;
create policy backup_settings_read on public.backup_settings for select to authenticated using(public.is_admin());
create policy backup_runs_read on public.backup_runs for select to authenticated using(public.is_admin());

create function public.get_backup_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; r jsonb;
begin perform public.require_admin();
 select to_jsonb(b) into s from public.backup_settings b where id=1;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at desc),'[]'::jsonb) into r
 from (select * from public.backup_runs order by started_at desc limit 20) x;
 return jsonb_build_object('settings',s,'runs',r);
end $$;

create function public.save_backup_settings(p_enabled boolean,p_run_time time,p_email text,p_retention integer,p_version integer) returns public.backup_settings language plpgsql security definer set search_path='' as $$
declare r public.backup_settings; e text:=coalesce(trim(p_email),'');
begin perform public.require_admin();
 if p_retention is null or p_retention<1 or p_retention>90 or p_run_time is null then raise exception 'INVALID_CONFIG'; end if;
 if length(e)>254 or (e<>'' and e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_CONFIG'; end if;
 update public.backup_settings set enabled=coalesce(p_enabled,false),run_time=p_run_time,email=e,retention=p_retention
 where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;
 return r;
end $$;

-- Service-role only: the scheduled Edge Function claims and finalises a run.
create function public.begin_backup(p_date date,p_force boolean default false,p_kind text default 'scheduled') returns jsonb language plpgsql security definer set search_path='' as $$
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

create function public.finish_backup(p_id uuid,p_status text,p_size bigint,p_tables jsonb,p_targets jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('success','partial','failed') then raise exception 'INVALID_CONFIG'; end if;
 update public.backup_runs set status=p_status,finished_at=now(),size_bytes=coalesce(p_size,0),
 tables=coalesce(p_tables,'{}'::jsonb),targets=coalesce(p_targets,'{}'::jsonb),error=left(coalesce(p_error,''),2000)
 where id=p_id;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;
end $$;

revoke execute on function public.get_backup_state(),public.save_backup_settings(boolean,time,text,integer,integer),
 public.begin_backup(date,boolean,text),public.finish_backup(uuid,text,bigint,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.get_backup_state(),public.save_backup_settings(boolean,time,text,integer,integer) to authenticated;
grant execute on function public.begin_backup(date,boolean,text),public.finish_backup(uuid,text,bigint,jsonb,jsonb,text) to service_role;
