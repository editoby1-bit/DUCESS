-- DUCESS Fix B (2026-10-22): all-or-nothing posting.
-- The app prepares every line of an approval (credits, debits, journal
-- rows, funding leg, staff ledger entry) and sends them here in ONE call.
-- This function writes them in a single transaction: if anything fails,
-- nothing is posted. Each account balance row is locked while it is
-- updated, so two approvers posting to the same account at the same time
-- can't overwrite each other. A request that is no longer pending is
-- refused, so a request can't be posted twice.
-- Safe to run more than once. Until it runs, the app writes step by step.

-- Inserts one JSON row into an allowed table, using only the keys that
-- are real columns (each value converted to that column's type).
create or replace function public.ducess_insert_row(p_table text, p_row jsonb)
returns jsonb language plpgsql as $$
declare
  v_cols text;
  v_out jsonb;
begin
  if p_table not in ('customer_transactions', 'staff_cash_ledger', 'audit_log') then
    raise exception 'DUCESS_TABLE_NOT_ALLOWED: %', p_table;
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = ('public.' || p_table)::regclass
     and a.attnum > 0 and not a.attisdropped
     and p_row ? a.attname;
  if v_cols is null then
    raise exception 'DUCESS_EMPTY_ROW for %', p_table;
  end if;
  execute format(
    'insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(t.*)',
    p_table, v_cols, v_cols, p_table)
    into v_out using p_row;
  return v_out;
end;
$$;

create or replace function public.ducess_commit_posting(
  p_request_id text,
  p_transactions jsonb,
  p_ledger jsonb,
  p_approval jsonb,
  p_audit jsonb
) returns jsonb language plpgsql as $$
declare
  v_req public.approval_requests%rowtype;
  v_fields public.approval_requests%rowtype;
  v_item jsonb;
  v_bal_key public.customer_account_balances%rowtype;
  v_bal numeric;
  v_new numeric;
  v_rows jsonb := '[]'::jsonb;
  v_approval jsonb;
begin
  -- Lock the request; only a pending request can be posted.
  select * into v_req from public.approval_requests where id::text = p_request_id for update;
  if not found then
    raise exception 'DUCESS_APPROVAL_NOT_FOUND';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'DUCESS_APPROVAL_NOT_PENDING';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) loop
    v_bal_key := jsonb_populate_record(null::public.customer_account_balances,
                   jsonb_build_object('account_id', v_item->'row'->'account_id'));
    select book_balance into v_bal
      from public.customer_account_balances
     where account_id = v_bal_key.account_id
       for update;
    if not found or v_bal is null then
      v_bal := coalesce((v_item->>'seed_balance')::numeric, 0);
    end if;
    v_new := v_bal + coalesce((v_item->>'delta')::numeric, 0);
    v_rows := v_rows || jsonb_build_array(
      public.ducess_insert_row('customer_transactions',
        (v_item->'row') || jsonb_build_object('balance_after', v_new)));
    insert into public.customer_account_balances (account_id, book_balance, updated_at)
    values (v_bal_key.account_id, v_new, now())
    on conflict (account_id) do update
      set book_balance = excluded.book_balance, updated_at = excluded.updated_at;
  end loop;

  if p_ledger is not null and jsonb_typeof(p_ledger) = 'object'
     and not exists (select 1 from public.staff_cash_ledger where approval_request_id::text = p_request_id) then
    perform public.ducess_insert_row('staff_cash_ledger', p_ledger);
  end if;

  v_fields := jsonb_populate_record(null::public.approval_requests, coalesce(p_approval, '{}'::jsonb));
  update public.approval_requests
     set status = 'approved',
         approved_at = now(),
         approved_by_staff_id = v_fields.approved_by_staff_id,
         approved_by_name = v_fields.approved_by_name,
         decision_note = v_fields.decision_note,
         payload = coalesce(v_fields.payload, payload)
   where id = v_req.id
  returning to_jsonb(approval_requests.*) into v_approval;

  if p_audit is not null and jsonb_typeof(p_audit) = 'object' then
    perform public.ducess_insert_row('audit_log', p_audit);
  end if;

  return jsonb_build_object('approval', v_approval, 'transactions', v_rows);
end;
$$;

-- Runs with the signed-in user's own rights (same as the app's normal
-- writes); anonymous visitors can't call it.
revoke all on function public.ducess_insert_row(text, jsonb) from public, anon;
revoke all on function public.ducess_commit_posting(text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.ducess_insert_row(text, jsonb) to authenticated;
grant execute on function public.ducess_commit_posting(text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Make the API see the new function straight away.
notify pgrst, 'reload schema';

-- Check: should list both functions.
select proname from pg_proc where proname in ('ducess_insert_row', 'ducess_commit_posting');
