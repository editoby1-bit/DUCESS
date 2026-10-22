-- DUCESS Fix B (2026-10-22): incremental sync columns.
-- Lets the app download only rows changed since its last sync instead of
-- re-downloading every approval, customer and transaction. Safe to run
-- more than once. Until it runs, the app keeps doing full reloads.

-- Shared trigger: stamp updated_at with the server time on every update.
create or replace function public.ducess_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- approval_requests ------------------------------------------------------
alter table public.approval_requests add column if not exists updated_at timestamptz;
update public.approval_requests
   set updated_at = coalesce(approved_at, requested_at, now())
 where updated_at is null;
alter table public.approval_requests alter column updated_at set default now();
alter table public.approval_requests alter column updated_at set not null;
drop trigger if exists ducess_touch_approval_requests on public.approval_requests;
create trigger ducess_touch_approval_requests
  before update on public.approval_requests
  for each row execute function public.ducess_touch_updated_at();
create index if not exists approval_requests_updated_at_idx on public.approval_requests (updated_at);

-- customers --------------------------------------------------------------
alter table public.customers add column if not exists updated_at timestamptz;
update public.customers
   set updated_at = coalesce(created_at, now())
 where updated_at is null;
alter table public.customers alter column updated_at set default now();
alter table public.customers alter column updated_at set not null;
drop trigger if exists ducess_touch_customers on public.customers;
create trigger ducess_touch_customers
  before update on public.customers
  for each row execute function public.ducess_touch_updated_at();
create index if not exists customers_updated_at_idx on public.customers (updated_at);

-- customer_transactions (insert-only: server time of insert) -------------
alter table public.customer_transactions add column if not exists inserted_at timestamptz;
update public.customer_transactions
   set inserted_at = coalesce(created_at, now())
 where inserted_at is null;
alter table public.customer_transactions alter column inserted_at set default now();
alter table public.customer_transactions alter column inserted_at set not null;
create index if not exists customer_transactions_inserted_at_idx on public.customer_transactions (inserted_at);

-- Check: each line should show a number (row counts), no errors.
select 'approval_requests' as table_name, count(*) from public.approval_requests
union all select 'customers', count(*) from public.customers
union all select 'customer_transactions', count(*) from public.customer_transactions;
