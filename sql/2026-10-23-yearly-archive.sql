-- DUCESS yearly archive (2026-10-23). Run after the 2026-10-22 Fix B scripts.
-- Safe to run more than once.
--
-- Archiving a year (Administration → ICT Unit → Yearly Archive):
--   1. Preview  — ducess_archive_stats(cutoff): what would be archived.
--   2. Download — the app saves every record (ducess_export_rows) to an
--                 archive file and checks it against the preview.
--   3. Confirm  — ducess_archive_year(cutoff, expected): in ONE transaction,
--                 the year's plain postings (approved/rejected customer
--                 credits/debits, staff funding, cash receipts — no charges,
--                 not staff wallets) become "brought forward" summary rows,
--                 customer transactions become one brought-forward line per
--                 account and type, the staff cash ledger likewise, and old
--                 audit entries are removed (they are in the file). Every
--                 customer's balance and the posting totals are checked to
--                 be unchanged, or nothing happens.
-- Restoring (latest archive first): the app uploads the file's archived rows
-- to a holding table (ducess_restore_stage), then ducess_restore_archive puts
-- them back and removes that archive's summary rows — again in one
-- transaction, after checking the rows match what was archived.

create table if not exists public.ducess_archives (
  id uuid primary key default gen_random_uuid(),
  cutoff date not null,
  status text not null default 'archived',
  archived_at timestamptz not null default now(),
  archived_by text,
  restored_at timestamptz,
  restored_by text,
  stats jsonb,
  summary_ids jsonb
);

create table if not exists public.ducess_restore_staging (
  archive_id uuid not null,
  tbl text not null,
  row_data jsonb not null,
  added_at timestamptz not null default now()
);
create index if not exists ducess_restore_staging_archive_idx on public.ducess_restore_staging (archive_id, tbl);

alter table public.ducess_archives enable row level security;
alter table public.ducess_restore_staging enable row level security;
drop policy if exists ducess_archives_staff on public.ducess_archives;
create policy ducess_archives_staff on public.ducess_archives for all to authenticated using (true) with check (true);
drop policy if exists ducess_restore_staging_staff on public.ducess_restore_staging;
create policy ducess_restore_staging_staff on public.ducess_restore_staging for all to authenticated using (true) with check (true);

-- What an archive with this cutoff (first day kept in full) would cover.
create or replace function public.ducess_archive_stats(p_cutoff date)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'cutoff', p_cutoff,
    'approvals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(public.ducess_num(payload->>'amount')), 0), 'digest', coalesce(sum(hashtext(id::text)::bigint), 0)::text)
                    from public.approval_requests where public.ducess_is_summarised(request_type, status, payload, p_cutoff)),
    'transactions', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(case when tx_type = 'credit' then amount else -amount end), 0), 'digest', coalesce(sum(hashtext(id::text)::bigint), 0)::text)
                    from public.customer_transactions where customer_id is not null and created_at < p_cutoff),
    'ledger', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(delta), 0), 'digest', coalesce(sum(hashtext(id::text)::bigint), 0)::text)
                    from public.staff_cash_ledger where created_at < p_cutoff),
    'audit', (select jsonb_build_object('count', count(*), 'amount', 0, 'digest', coalesce(sum(hashtext(id::text)::bigint), 0)::text)
                    from public.audit_log where created_at < p_cutoff),
    'database_bytes', pg_database_size(current_database()))
$$;

-- Raw rows of one table for the archive file, 1000 a page (keyset on id).
-- Photos and field notes are left out (they are kept in the database).
create or replace function public.ducess_export_rows(p_table text, p_after text default null, p_limit int default 1000)
returns setof jsonb language plpgsql stable as $$
declare
  v_has_id boolean;
  v_expr text := 'to_jsonb(t)';
begin
  if p_table not in ('staff', 'staff_role_permissions', 'staff_temp_grants', 'staff_role_assignments', 'customers',
                     'customer_account_balances', 'customer_transactions', 'approval_requests', 'cod_submissions',
                     'cod_resolutions', 'debts', 'debt_repayments', 'audit_log', 'staff_cash_ledger', 'staff_profiles',
                     'ict_logs', 'ducess_archives') then
    raise exception 'DUCESS_TABLE_NOT_ALLOWED: %', p_table;
  end if;
  if to_regclass('public.' || p_table) is null then return; end if;
  if p_table = 'approval_requests' then
    v_expr := $e$to_jsonb(t) || jsonb_build_object('payload', case when t.payload ?| array['photo','photoRef','fieldNote']
      then (t.payload - 'photo' - 'photoRef' - 'fieldNote') || jsonb_build_object('__omitted', 'photo/note kept in database') else t.payload end)$e$;
  elsif p_table = 'customers' then
    v_expr := $e$to_jsonb(t) - 'photo_path'$e$;
  elsif p_table = 'staff_profiles' then
    v_expr := $e$to_jsonb(t) - 'photo'$e$;
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'id') into v_has_id;
  if v_has_id then
    return query execute format('select %s from public.%I t where ($1 is null or t.id::text > $1) order by t.id::text limit $2', v_expr, p_table)
      using p_after, least(greatest(p_limit, 1), 1000);
  elsif p_after is null then
    return query execute format('select %s from public.%I t', v_expr, p_table);
  end if;
end;
$$;

create or replace function public.ducess_archive_list()
returns setof public.ducess_archives language sql stable as $$
  select * from public.ducess_archives order by archived_at desc
$$;

-- The archive itself. p_expected = the preview the archive file was checked against.
create or replace function public.ducess_archive_year(p_cutoff date, p_expected jsonb, p_by text)
returns jsonb language plpgsql as $$
declare
  v_stats jsonb;
  v_archive uuid := gen_random_uuid();
  v_appr_ids jsonb;
  v_tx_ids jsonb;
  v_ledger_ids jsonb;
  v_bad int;
  v_label text := 'Balance brought forward (archived up to ' || to_char(p_cutoff - 1, 'DD/MM/YYYY') || ')';
begin
  if p_cutoff is null or extract(day from p_cutoff) <> 1 or extract(month from p_cutoff) <> 1 then
    raise exception 'DUCESS_ARCHIVE_BAD_CUTOFF: an archive ends on 31 December (cutoff must be 1 January)';
  end if;
  if p_cutoff > date_trunc('year', (select max(public.ducess_biz_date(payload)) from public.approval_requests))::date then
    raise exception 'DUCESS_ARCHIVE_CURRENT_YEAR: the current business year cannot be archived';
  end if;
  if exists (select 1 from public.ducess_archives where status = 'archived' and cutoff >= p_cutoff) then
    raise exception 'DUCESS_ARCHIVE_ALREADY: this year is already archived';
  end if;

  -- Nobody may post while the archive runs (the lock lasts only this transaction).
  lock table public.approval_requests, public.customer_transactions, public.staff_cash_ledger, public.audit_log in share row exclusive mode;

  v_stats := public.ducess_archive_stats(p_cutoff);
  if v_stats->'approvals' is distinct from p_expected->'approvals'
     or v_stats->'transactions' is distinct from p_expected->'transactions'
     or v_stats->'ledger' is distinct from p_expected->'ledger'
     or v_stats->'audit' is distinct from p_expected->'audit' then
    raise exception 'DUCESS_ARCHIVE_CHANGED: records changed since the archive file was made — download a fresh archive file and try again';
  end if;

  -- Totals that must not change.
  create temp table ducess_check_tx on commit drop as
    select customer_id, account_id, sum(case when tx_type = 'credit' then amount else -amount end) as net
      from public.customer_transactions where customer_id is not null group by 1, 2;
  create temp table ducess_check_appr on commit drop as
    select request_type, status, coalesce(requested_by_staff_id, '') as by_staff, coalesce(payload->>'staffId', '') as staff,
           coalesce(payload->>'customerId', '') as cust, coalesce(payload->>'targetAccountId', '') as tgt, coalesce(payload->>'sourceAccountId', '') as src,
           sum(public.ducess_num(payload->>'amount')) as amount
      from public.approval_requests group by 1, 2, 3, 4, 5, 6, 7;

  -- 1. Requests → summary rows.
  with src as (
    select r.*, public.ducess_summary_key(r.payload) - '__archive' - '__count' - '__bf' as k
      from public.approval_requests r where public.ducess_is_summarised(r.request_type, r.status, r.payload, p_cutoff)
  ), grp as (
    select request_type, status, requested_by_staff_id, entity_type, entity_id, k,
           sum(public.ducess_num(payload->>'amount')) as amount, max(public.ducess_biz_date(payload)) as bizdate,
           sum(coalesce(nullif(payload->>'__count', '')::int, 1)) as cnt,
           max(requested_at) as requested_at, max(requested_by_name) as requested_by_name,
           max(approved_at) as approved_at, max(approved_by_staff_id) as approved_by_staff_id, max(approved_by_name) as approved_by_name
      from src group by request_type, status, requested_by_staff_id, entity_type, entity_id, k
  ), ins as (
    insert into public.approval_requests (request_type, status, payload, requested_at, requested_by_staff_id, requested_by_name, approved_at, approved_by_staff_id, approved_by_name, decision_note, entity_type, entity_id)
    select request_type, status,
           k || jsonb_build_object('amount', amount, 'date', to_char(bizdate, 'YYYY-MM-DD'), 'details', v_label, '__bf', true, '__count', cnt, '__archive', v_archive::text),
           requested_at, requested_by_staff_id, requested_by_name, approved_at, approved_by_staff_id, approved_by_name,
           case when status = 'rejected' then 'Archived rejected requests' else '' end, entity_type, entity_id
      from grp
    returning id
  )
  select coalesce(jsonb_agg(id::text), '[]'::jsonb) into v_appr_ids from ins;
  delete from public.approval_requests r
   where public.ducess_is_summarised(r.request_type, r.status, r.payload, p_cutoff)
     and not (r.id::text in (select jsonb_array_elements_text(v_appr_ids)));

  -- 2. Customer transactions → one brought-forward line per account and type.
  with grp as (
    select customer_id, account_id, tx_type, sum(amount) as amount, max(created_at) as created_at, max(effective_at) as effective_at
      from public.customer_transactions where customer_id is not null and created_at < p_cutoff
     group by customer_id, account_id, tx_type
  ), ins as (
    insert into public.customer_transactions (customer_id, account_id, tx_type, amount, details, created_at, effective_at)
    select customer_id, account_id, tx_type, amount, v_label, created_at, effective_at from grp
    returning id
  )
  select coalesce(jsonb_agg(id::text), '[]'::jsonb) into v_tx_ids from ins;
  delete from public.customer_transactions t
   where t.customer_id is not null and t.created_at < p_cutoff
     and not (t.id::text in (select jsonb_array_elements_text(v_tx_ids)));

  -- 3. Staff cash ledger → one brought-forward line per staff and entry type.
  with grp as (
    select staff_id, entry_type, sum(amount) as amount, sum(delta) as delta, max(created_at) as created_at
      from public.staff_cash_ledger where created_at < p_cutoff group by staff_id, entry_type
  ), ins as (
    insert into public.staff_cash_ledger (staff_id, entry_type, amount, delta, note, created_at)
    select staff_id, entry_type, amount, delta, v_label, created_at from grp
    returning id
  )
  select coalesce(jsonb_agg(id::text), '[]'::jsonb) into v_ledger_ids from ins;
  delete from public.staff_cash_ledger l
   where l.created_at < p_cutoff and not (l.id::text in (select jsonb_array_elements_text(v_ledger_ids)));

  -- 4. Old audit entries (they are in the archive file).
  delete from public.audit_log where created_at < p_cutoff;

  -- Checks: every account's balance and every posting total unchanged.
  select count(*) into v_bad from (
    select customer_id, account_id, net from ducess_check_tx
    except
    select customer_id, account_id, sum(case when tx_type = 'credit' then amount else -amount end)
      from public.customer_transactions where customer_id is not null group by 1, 2) d;
  if v_bad > 0 then raise exception 'DUCESS_ARCHIVE_CHECK_FAILED: % account balance(s) would change — nothing was archived', v_bad; end if;
  select count(*) into v_bad from (
    select * from ducess_check_appr
    except
    select request_type, status, coalesce(requested_by_staff_id, ''), coalesce(payload->>'staffId', ''), coalesce(payload->>'customerId', ''),
           coalesce(payload->>'targetAccountId', ''), coalesce(payload->>'sourceAccountId', ''), sum(public.ducess_num(payload->>'amount'))
      from public.approval_requests group by 1, 2, 3, 4, 5, 6, 7) d;
  if v_bad > 0 then raise exception 'DUCESS_ARCHIVE_CHECK_FAILED: % posting total(s) would change — nothing was archived', v_bad; end if;

  insert into public.ducess_archives (id, cutoff, status, archived_by, stats, summary_ids)
  values (v_archive, p_cutoff, 'archived', p_by, v_stats,
          jsonb_build_object('approvals', v_appr_ids, 'transactions', v_tx_ids, 'ledger', v_ledger_ids));

  return jsonb_build_object('archive_id', v_archive, 'cutoff', p_cutoff, 'stats', v_stats,
    'summary_rows', jsonb_build_object('approvals', jsonb_array_length(v_appr_ids), 'transactions', jsonb_array_length(v_tx_ids), 'ledger', jsonb_array_length(v_ledger_ids)));
end;
$$;

-- Restore, step 1: upload the file's archived rows (in chunks) to the holding table.
create or replace function public.ducess_restore_stage(p_archive uuid, p_table text, p_rows jsonb)
returns int language plpgsql as $$
declare v_n int;
begin
  if p_table not in ('approval_requests', 'customer_transactions', 'staff_cash_ledger', 'audit_log') then
    raise exception 'DUCESS_TABLE_NOT_ALLOWED: %', p_table;
  end if;
  if not exists (select 1 from public.ducess_archives where id = p_archive and status = 'archived') then
    raise exception 'DUCESS_RESTORE_NOT_ARCHIVED: that archive is not active';
  end if;
  insert into public.ducess_restore_staging (archive_id, tbl, row_data)
  select p_archive, p_table, value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.ducess_restore_clear(p_archive uuid)
returns void language sql as $$
  delete from public.ducess_restore_staging where archive_id = p_archive
$$;

-- Restore, step 2: check the uploaded rows, then put them back in one transaction.
create or replace function public.ducess_restore_archive(p_archive uuid, p_by text)
returns jsonb language plpgsql as $$
declare
  v_arc public.ducess_archives%rowtype;
  v_t text;
  v_key text;
  v_got jsonb;
  v_want jsonb;
begin
  select * into v_arc from public.ducess_archives where id = p_archive for update;
  if not found or v_arc.status <> 'archived' then raise exception 'DUCESS_RESTORE_NOT_ARCHIVED: that archive is not active'; end if;
  if exists (select 1 from public.ducess_archives where status = 'archived' and cutoff > v_arc.cutoff) then
    raise exception 'DUCESS_RESTORE_ORDER: restore the most recent archive first';
  end if;

  lock table public.approval_requests, public.customer_transactions, public.staff_cash_ledger, public.audit_log in share row exclusive mode;

  -- The uploaded rows must be exactly what was archived.
  foreach v_t in array array['approval_requests', 'customer_transactions', 'staff_cash_ledger', 'audit_log'] loop
    v_key := case v_t when 'approval_requests' then 'approvals' when 'customer_transactions' then 'transactions' when 'staff_cash_ledger' then 'ledger' else 'audit' end;
    select jsonb_build_object('count', count(*), 'digest', coalesce(sum(hashtext(row_data->>'id')::bigint), 0)::text) into v_got
      from public.ducess_restore_staging where archive_id = p_archive and tbl = v_t;
    v_want := jsonb_build_object('count', (v_arc.stats->v_key->>'count')::bigint, 'digest', v_arc.stats->v_key->>'digest');
    if v_got is distinct from v_want then
      raise exception 'DUCESS_RESTORE_MISMATCH: % rows in the file do not match what was archived (%, expected %)', v_t, v_got, v_want;
    end if;
  end loop;

  delete from public.approval_requests where id::text in (select jsonb_array_elements_text(v_arc.summary_ids->'approvals'));
  delete from public.customer_transactions where id::text in (select jsonb_array_elements_text(v_arc.summary_ids->'transactions'));
  delete from public.staff_cash_ledger where id::text in (select jsonb_array_elements_text(v_arc.summary_ids->'ledger'));

  insert into public.approval_requests select (jsonb_populate_record(null::public.approval_requests, row_data)).* from public.ducess_restore_staging where archive_id = p_archive and tbl = 'approval_requests';
  insert into public.customer_transactions select (jsonb_populate_record(null::public.customer_transactions, row_data)).* from public.ducess_restore_staging where archive_id = p_archive and tbl = 'customer_transactions';
  insert into public.staff_cash_ledger select (jsonb_populate_record(null::public.staff_cash_ledger, row_data)).* from public.ducess_restore_staging where archive_id = p_archive and tbl = 'staff_cash_ledger';
  insert into public.audit_log select (jsonb_populate_record(null::public.audit_log, row_data)).* from public.ducess_restore_staging where archive_id = p_archive and tbl = 'audit_log';

  delete from public.ducess_restore_staging where archive_id = p_archive;
  update public.ducess_archives set status = 'restored', restored_at = now(), restored_by = p_by where id = p_archive;
  return jsonb_build_object('archive_id', p_archive, 'restored', v_arc.stats);
end;
$$;

revoke all on function public.ducess_archive_stats(date) from public, anon;
revoke all on function public.ducess_export_rows(text, text, int) from public, anon;
revoke all on function public.ducess_archive_list() from public, anon;
revoke all on function public.ducess_archive_year(date, jsonb, text) from public, anon;
revoke all on function public.ducess_restore_stage(uuid, text, jsonb) from public, anon;
revoke all on function public.ducess_restore_clear(uuid) from public, anon;
revoke all on function public.ducess_restore_archive(uuid, text) from public, anon;
grant execute on function public.ducess_archive_stats(date) to authenticated;
grant execute on function public.ducess_export_rows(text, text, int) to authenticated;
grant execute on function public.ducess_archive_list() to authenticated;
grant execute on function public.ducess_archive_year(date, jsonb, text) to authenticated;
grant execute on function public.ducess_restore_stage(uuid, text, jsonb) to authenticated;
grant execute on function public.ducess_restore_clear(uuid) to authenticated;
grant execute on function public.ducess_restore_archive(uuid, text) to authenticated;
notify pgrst, 'reload schema';

select proname from pg_proc where proname like 'ducess_archive%' or proname like 'ducess_restore%' or proname = 'ducess_export_rows' order by 1;
