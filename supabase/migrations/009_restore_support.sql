-- Restore support: historical rows may contain grades that predate the
-- binary-daily validation trigger introduced in 004. During a deliberate
-- restore we temporarily disable that trigger so the backup is copied exactly
-- as it was, then re-enable it before the restored app starts serving users.
create or replace function public.begin_restore() returns void language plpgsql security definer set search_path='' as $$
begin
 alter table public.evaluations disable trigger evaluations_binary;
end $$;

create or replace function public.end_restore() returns void language plpgsql security definer set search_path='' as $$
begin
 alter table public.evaluations enable trigger evaluations_binary;
end $$;

revoke all on function public.begin_restore(),public.end_restore() from public,anon,authenticated;
grant execute on function public.begin_restore(),public.end_restore() to service_role;
