-- Run this in the SECOND (backup) Supabase project only.
-- It creates the private summaries table. The backup function creates the
-- private "madrasetna-backups" Storage bucket automatically.
create table if not exists public.backup_snapshots (
 id uuid primary key default gen_random_uuid(),
 study_date date not null,
 file_path text not null,
 size_bytes bigint not null default 0,
 sha256 text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists backup_snapshots_date on public.backup_snapshots(created_at desc);

alter table public.backup_snapshots enable row level security;
-- No public or authenticated access: only the service role (the backup function)
-- writes here. Keep it private.
revoke all on public.backup_snapshots from anon, authenticated;
