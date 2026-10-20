-- Run this ONCE in the SQL editor AFTER deploying the `backup` Edge Function.
-- It stores the function URL and shared secret in Vault, then schedules a
-- check every 15 minutes. The Edge Function itself decides whether it is a
-- study day and whether it is already past the configured run time.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- 1) Replace the two values below, then run these two statements once.
--    Project URL: https://<project-ref>.supabase.co/functions/v1/backup
--    Secret: any long random string, must match BACKUP_CRON_SECRET in Edge secrets.
-- select vault.create_secret('https://PROJECT_REF.supabase.co/functions/v1/backup','backup_function_url','Madrasetna backup function URL');
-- select vault.create_secret('REPLACE_WITH_LONG_RANDOM_SECRET','backup_cron_secret','Madrasetna backup cron secret');

create or replace function public.trigger_backup() returns bigint language plpgsql security definer set search_path='' as $$
declare u text; s text; r bigint;
begin
 select decrypted_secret into u from vault.decrypted_secrets where name='backup_function_url';
 select decrypted_secret into s from vault.decrypted_secrets where name='backup_cron_secret';
 if u is null or s is null then raise exception 'BACKUP_CRON_NOT_CONFIGURED'; end if;
 select net.http_post(
  url:=u,
  headers:=jsonb_build_object('Content-Type','application/json','x-backup-secret',s),
  body:='{}'::jsonb,
  timeout_milliseconds:=150000
 ) into r;
 return r;
end $$;
revoke execute on function public.trigger_backup() from public,anon,authenticated;

do $$ begin
 if exists(select 1 from cron.job where jobname='madrasetna-daily-backup') then perform cron.unschedule('madrasetna-daily-backup'); end if;
end $$;
select cron.schedule('madrasetna-daily-backup','*/15 * * * *','select public.trigger_backup()');
