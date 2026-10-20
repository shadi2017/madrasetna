-- Page-level permissions for non-owner admins.
-- Owners always see every page. Missing keys mean "allowed" so existing
-- admins keep their current access until the owner changes something.
alter table public.admins add column if not exists permissions jsonb not null default '{}'::jsonb;

create or replace function public.admin_permissions() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select permissions from public.admins where user_id=auth.uid()), '{}'::jsonb)
$$;

create or replace function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select case
    when public.is_owner() then true
    when not public.is_admin() then false
    else coalesce((
      select case
        when a.permissions->>p_key in ('true','false') then (a.permissions->>p_key)::boolean
        else true
      end
      from public.admins a where a.user_id=auth.uid()
    ), true)
  end
$$;

-- Explicit mode is used for secondary pages (for example history restore) so a
-- missing legacy key cannot silently bypass an explicit deny on the main page.
create or replace function public.permission_explicit(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select case
    when public.is_owner() then true
    when not public.is_admin() then false
    else coalesce((
      select (a.permissions->>p_key)::boolean
      from public.admins a
      where a.user_id=auth.uid() and a.permissions->>p_key in ('true','false')
    ), false)
  end
$$;

drop function if exists public.list_staff();
create function public.list_staff() returns table(user_id uuid,email text,is_owner boolean,permissions jsonb)
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_owner();
  return query select a.user_id,u.email::text,a.is_owner,a.permissions
  from public.admins a join auth.users u on u.id=a.user_id
  order by a.is_owner desc,u.email;
end $$;

create or replace function public.set_staff_permissions(p_email text,p_permissions jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; clean jsonb:='{}'::jsonb; k text; v jsonb;
begin
  perform public.require_owner();
  select a.user_id into target
  from public.admins a join auth.users u on u.id=a.user_id
  where lower(u.email)=lower(trim(p_email));
  if target is null then raise exception 'STAFF_NOT_FOUND'; end if;
  if exists(select 1 from public.admins where user_id=target and is_owner) then raise exception 'OWNER_PROTECTED'; end if;
  if p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception 'INVALID_PERMISSIONS'; end if;
  for k in select jsonb_object_keys(p_permissions) loop
    if k not in ('home','students','approvals','scan','grades','days','excel','history','backup','grading','settings') then
      raise exception 'INVALID_PERMISSION_KEY';
    end if;
    v:=p_permissions->k;
    if jsonb_typeof(v)<>'boolean' then raise exception 'INVALID_PERMISSION_VALUE'; end if;
    clean:=clean||jsonb_build_object(k,v);
  end loop;
  update public.admins set permissions=clean where user_id=target;
  insert into public.audit_log(entity,record_id,action,actor_id,after_data)
  values('admins',target::text,'update_permissions',auth.uid(),jsonb_build_object('permissions',clean));
end $$;

create or replace function public.sync_manifest(p_audit boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;isadmin boolean:=public.is_admin();
begin
 select jsonb_build_object('admin',isadmin,'owner',public.is_owner(),'permissions',public.admin_permissions(),
 'profiles',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.profiles),
 'days',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.days),
 'evaluations',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.evaluations),
 'settings',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.settings),
 'grading',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.grading),
 'final_scores',(select jsonb_build_object('stamp',max((f->>'updated_at')::timestamptz),'count',count(*)) from public.get_final_scores() f),
 'revision',(select revision from public.results_signal where id=1)) into result;
 if p_audit and isadmin then result=result||jsonb_build_object('audit',(select jsonb_build_object('stamp',max(created_at),'count',count(*)) from public.audit_log));end if;
 return result;
end $$;

-- Keep the multiple-recipient behaviour in sync with the UI and the backup function.
create or replace function public.save_backup_settings(p_enabled boolean,p_run_time time,p_email text,p_retention integer,p_version integer) returns public.backup_settings
language plpgsql security definer set search_path='' as $$
declare r public.backup_settings; e text:=coalesce(trim(p_email),'');
begin perform public.require_admin();
 if p_retention is null or p_retention<1 or p_retention>90 or p_run_time is null then raise exception 'INVALID_CONFIG'; end if;
 if p_run_time < '00:00'::time or p_run_time > '06:00'::time then raise exception 'INVALID_CONFIG'; end if;
 if length(e)>1000 or (e<>'' and exists(
   select 1 from pg_catalog.regexp_split_to_table(e,'[,;[:space:]]+') part
   where part<>'' and part !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 )) then raise exception 'INVALID_CONFIG'; end if;
 update public.backup_settings set enabled=coalesce(p_enabled,false),run_time=p_run_time,email=e,retention=p_retention
 where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH'; end if;
 return r;
end $$;

-- Restores are allowed for a history-only admin only while the restore flag is
-- set by the two restore RPCs below, so a history permission cannot be used to
-- edit the same tables through the normal page RPCs.
create or replace function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();perform set_config('app.restore','on',true);select * into a from public.audit_log where id=p_audit;
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

create or replace function public.set_deleted(p_entity text,p_id uuid,p_deleted boolean,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;begin perform public.require_admin();
 if not p_deleted then perform set_config('app.restore','on',true); end if;
 if p_entity not in ('profiles','days','evaluations','final_scores') then raise exception 'INVALID_ENTITY';end if;
 execute format('update public.%I set deleted_at=$1 where id=$2 and version=$3',p_entity) using case when p_deleted then now() end,p_id,p_version;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;end $$;

-- Writes from the app are protected by page permissions. Service-role jobs and
-- the restore script (auth.uid() is null) keep working as before.
create or replace function public.guard_admin_permission() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed boolean:=false;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if not public.is_admin() then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if public.is_owner() then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if public.permission_explicit('history') and current_setting('app.restore',true)='on' then
    allowed:=true;
  elsif tg_table_name='profiles' then
    allowed:=public.has_permission('students') or public.permission_explicit('approvals');
  elsif tg_table_name='days' then
    allowed:=public.has_permission('days');
  elsif tg_table_name='evaluations' then
    allowed:=public.has_permission('grades') or public.permission_explicit('scan');
  elsif tg_table_name='final_scores' then
    allowed:=public.has_permission('grades');
  elsif tg_table_name='settings' then
    allowed:=public.has_permission('settings');
  elsif tg_table_name='grading' then
    allowed:=public.has_permission('grading');
  elsif tg_table_name='backup_settings' then
    allowed:=public.has_permission('backup');
  else
    allowed:=true;
  end if;
  if not allowed then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists guard_admin_permission on public.profiles;
create trigger guard_admin_permission before insert or update or delete on public.profiles for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.days;
create trigger guard_admin_permission before insert or update or delete on public.days for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.evaluations;
create trigger guard_admin_permission before insert or update or delete on public.evaluations for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.final_scores;
create trigger guard_admin_permission before insert or update or delete on public.final_scores for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.settings;
create trigger guard_admin_permission before insert or update or delete on public.settings for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.grading;
create trigger guard_admin_permission before insert or update or delete on public.grading for each row execute function public.guard_admin_permission();
drop trigger if exists guard_admin_permission on public.backup_settings;
create trigger guard_admin_permission before insert or update or delete on public.backup_settings for each row execute function public.guard_admin_permission();

revoke execute on function public.admin_permissions(),public.has_permission(text),public.permission_explicit(text),public.set_staff_permissions(text,jsonb),public.list_staff() from public,anon;
grant execute on function public.admin_permissions(),public.has_permission(text),public.permission_explicit(text),public.set_staff_permissions(text,jsonb),public.list_staff() to authenticated;
revoke all on function public.guard_admin_permission() from public,anon,authenticated;
