-- Nexit: solo sincronización de datos. Las alarmas son locales por dispositivo.
create table if not exists public.nexit_records (
  user_id uuid not null default auth.uid(),
  record_id text not null,
  record_type text not null,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, record_id)
);
create index if not exists nexit_records_user_type_idx on public.nexit_records(user_id, record_type);
alter table public.nexit_records enable row level security;
drop policy if exists "nexit select own" on public.nexit_records;
create policy "nexit select own" on public.nexit_records for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "nexit insert own" on public.nexit_records;
create policy "nexit insert own" on public.nexit_records for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "nexit update own" on public.nexit_records;
create policy "nexit update own" on public.nexit_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "nexit delete own" on public.nexit_records;
create policy "nexit delete own" on public.nexit_records for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.nexit_records from anon;
grant select,insert,update,delete on table public.nexit_records to authenticated;
