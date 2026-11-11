-- DUCESS — Extra roles (2026-11-10)
-- One staff member can hold more than one role. The main role stays on staff.role_code
-- (nothing about it changes); any additional roles are listed here.
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.staff_extra_roles (
  staff_id        text        not null,            -- staff.id
  role_code       text        not null,            -- e.g. teller, approving_officer, cash_officer
  granted_by_name text,
  granted_at      timestamptz not null default now(),
  primary key (staff_id, role_code)
);

alter table public.staff_extra_roles enable row level security;
drop policy if exists "staff_extra_roles signed-in access" on public.staff_extra_roles;
create policy "staff_extra_roles signed-in access" on public.staff_extra_roles
  for all to authenticated using (true) with check (true);
