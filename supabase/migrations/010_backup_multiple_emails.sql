-- Allow more than one recipient in backup_settings.email.
-- Addresses are comma/semicolon/space separated and parsed by the backup Edge Function.
alter table public.backup_settings drop constraint if exists backup_settings_email_check;

alter table public.backup_settings
  add constraint backup_settings_email_check check (length(email) <= 1000);
