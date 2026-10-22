-- DUCESS — Administration redesign (2026-10-22)
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Staff Information (sheet: "Staff information" panel)
create table if not exists public.staff_profiles (
  staff_id              text primary key,          -- staff.id
  job_title             text,
  phone                 text,
  gender                text,
  date_of_birth         date,
  photo                 text,          -- small compressed image (data URL)
  residential_address   text,
  email                 text,
  qualification         text,
  date_of_employment    date,
  salary_account_number text,
  bvn                   text,
  nin                   text,
  guarantor             text,
  referee               text,
  next_of_kin           text,
  marital_status        text,
  initial_position      text,
  updated_at            timestamptz not null default now()
);

-- 2. ICT Unit records (data backup, data security, network, cybersecurity checks)
create table if not exists public.ict_logs (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,                 -- backup | security | network | cyber
  checked_items jsonb not null default '[]'::jsonb,
  note          text,
  staff_id      text,
  staff_name    text,
  created_at    timestamptz not null default now()
);
create index if not exists ict_logs_category_created_idx on public.ict_logs (category, created_at desc);

-- 3. Access: signed-in DUCESS staff can read and write these tables.
alter table public.staff_profiles enable row level security;
alter table public.ict_logs enable row level security;
drop policy if exists "staff_profiles signed-in access" on public.staff_profiles;
create policy "staff_profiles signed-in access" on public.staff_profiles
  for all to authenticated using (true) with check (true);
drop policy if exists "ict_logs signed-in access" on public.ict_logs;
create policy "ict_logs signed-in access" on public.ict_logs
  for all to authenticated using (true) with check (true);
