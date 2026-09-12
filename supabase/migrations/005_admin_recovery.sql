create table public.admin_recovery_limits(user_id uuid primary key references auth.users(id) on delete cascade,last_requested timestamptz not null,day date not null,requests integer not null);
alter table public.admin_recovery_limits enable row level security;
revoke all on public.admin_recovery_limits from public,anon,authenticated;
create function public.reserve_admin_recovery(p_email text) returns text language plpgsql security definer set search_path='' as $$
declare target uuid;address text;reserved uuid;
begin
 select u.id,u.email into target,address from auth.users u join public.admins a on a.user_id=u.id where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null and lower(u.email) not like '%@students.invalid';
 if target is null then return null;end if;
 insert into public.admin_recovery_limits(user_id,last_requested,day,requests) values(target,now(),current_date,1)
 on conflict(user_id) do update set last_requested=now(),day=current_date,requests=case when admin_recovery_limits.day=current_date then admin_recovery_limits.requests+1 else 1 end
 where admin_recovery_limits.last_requested<now()-interval '60 seconds' and (admin_recovery_limits.day<>current_date or admin_recovery_limits.requests<5) returning user_id into reserved;
 if reserved is null then return null;end if;return address;
end $$;
revoke execute on function public.reserve_admin_recovery(text) from public,anon,authenticated;
grant execute on function public.reserve_admin_recovery(text) to service_role;
