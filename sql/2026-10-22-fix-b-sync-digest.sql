-- DUCESS Fix B (2026-10-22), run after 2026-10-22-fix-b-incremental-sync.sql:
-- deletion check, so the app never needs a
-- periodic full re-download. inserted_at = server time a row was added;
-- ducess_sync_digest returns a row count + id checksum for rows added up
-- to a given time. If that number changes later, rows were deleted and
-- the app reloads in full; otherwise it only ever fetches changes.
alter table public.approval_requests add column if not exists inserted_at timestamptz;
update public.approval_requests set inserted_at = coalesce(requested_at, now()) where inserted_at is null;
alter table public.approval_requests alter column inserted_at set default now();
alter table public.approval_requests alter column inserted_at set not null;
create index if not exists approval_requests_inserted_at_id_idx on public.approval_requests (inserted_at) include (id);

alter table public.customers add column if not exists inserted_at timestamptz;
update public.customers set inserted_at = coalesce(created_at, now()) where inserted_at is null;
alter table public.customers alter column inserted_at set default now();
alter table public.customers alter column inserted_at set not null;
create index if not exists customers_inserted_at_id_idx on public.customers (inserted_at) include (id);

create index if not exists customer_transactions_inserted_at_id_idx on public.customer_transactions (inserted_at) include (id, customer_id);

create or replace function public.ducess_sync_digest(p_kind text, p_prev timestamptz)
returns jsonb language plpgsql stable as $$
declare
  v_table text;
  v_filter text := '';
  v_at timestamptz := now() - interval '1 minute';
  v_now jsonb;
  v_prev jsonb;
  v_sql text;
begin
  v_table := case p_kind when 'approvals' then 'approval_requests'
                         when 'customers' then 'customers'
                         when 'transactions' then 'customer_transactions' end;
  if v_table is null then raise exception 'DUCESS_BAD_KIND: %', p_kind; end if;
  if p_kind = 'transactions' then v_filter := ' and customer_id is not null'; end if;
  v_sql := format('select jsonb_build_object(''count'', count(*), ''sum'', coalesce(sum(hashtext(id::text)::bigint), 0)::text) from public.%I where inserted_at <= $1%s', v_table, v_filter);
  execute v_sql into v_now using v_at;
  if p_prev is not null then
    execute v_sql into v_prev using p_prev;
  end if;
  return jsonb_build_object('at', v_at, 'now', v_now, 'prev', v_prev);
end;
$$;
revoke all on function public.ducess_sync_digest(text, timestamptz) from public, anon;
grant execute on function public.ducess_sync_digest(text, timestamptz) to authenticated;
notify pgrst, 'reload schema';

select proname from pg_proc where proname = 'ducess_sync_digest';
