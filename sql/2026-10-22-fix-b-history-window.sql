-- DUCESS Fix B (2026-10-22): recent history + summaries.
-- Run after the other 2026-10-22 Fix B scripts. Safe to run more than once.
--
-- A device no longer downloads every approval and transaction ever made.
-- It downloads full detail from a start date (by default the start of the
-- current business month, or 7 days back if that is earlier) and, for
-- everything older, compact SUMMARY rows that add up to exactly the same
-- totals: one row per staff member / account / type, carrying the summed
-- amount, the latest date and how many records it stands for. Older detail
-- is fetched only when someone opens a report that reaches back further.
--
-- Only plain approved postings are summarised (customer credit/debit,
-- staff-to-staff funding, cash receipts) with no charges and not on a staff
-- wallet. Everything else (journals, openings, closures, close of day,
-- pending and rejected requests, ...) always comes in full.

-- Business date of a request: payload date / businessDate / float_date
-- (same order the app uses). NULL when missing or not a date — such rows
-- are treated as recent and never summarised.
create or replace function public.ducess_biz_date(p_payload jsonb)
returns date language sql immutable as $$
  select case when d ~ '^\d{4}-\d{2}-\d{2}' then left(d, 10)::date end
    from (select coalesce(nullif(p_payload->>'date', ''), nullif(p_payload->>'businessDate', ''), nullif(p_payload->>'float_date', '')) as d) x
$$;

create or replace function public.ducess_num(p text)
returns numeric language sql immutable as $$
  select case when p ~ '^\s*-?\d+(\.\d+)?\s*$' then p::numeric else 0 end
$$;

-- True when a request is summarised for a window starting at p_from.
create or replace function public.ducess_is_summarised(p_type text, p_status text, p_payload jsonb, p_from date)
returns boolean language sql immutable as $$
  select p_from is not null
     and p_status = 'approved'
     and p_type in ('customer_credit', 'customer_debit', 'inter_staff_credit', 'cash_receipt')
     and public.ducess_biz_date(p_payload) < p_from
     and coalesce(p_payload->>'accountType', '') not in ('staff', 'staff_wallet')
     and (jsonb_typeof(p_payload->'chargeBreakdown') is distinct from 'array' or jsonb_array_length(p_payload->'chargeBreakdown') = 0)
     and public.ducess_num(p_payload->>'commissionAmount') = 0
     and public.ducess_num(p_payload->>'totalChargeAmount') = 0
$$;

-- Fields that differ record to record but never affect any total. They are
-- left out of the summary key so similar records collapse into one row.
create or replace function public.ducess_summary_key(p_payload jsonb)
returns jsonb language sql immutable as $$
  select p_payload - array['amount', 'customerCreditAmount', 'date', 'businessDate', 'float_date',
    'details', 'note', 'receivedOrPaidBy', 'assignedApproverId', 'assignedApproverName', '__reviewLock',
    'sourceRowKey', 'sourceApprovalId', 'commissionTraceId', 'chargeTraceId', 'journalNumber',
    'photo', 'photoRef', 'fieldNote', 'fieldPapers', 'totalChargeAmount', 'commissionAmount', 'chargeBreakdown',
    '__posting', 'paidBy', 'receivedBy', 'destDetails', 'customerName', 'accountNumber']
$$;

-- Window + summaries. p_from = NULL picks the default window.
create or replace function public.ducess_history_window(p_from date default null)
returns jsonb language plpgsql stable as $$
declare
  v_max date;
  v_from date := p_from;
  v_appr jsonb;
  v_tx jsonb;
begin
  if v_from is null then
    select max(public.ducess_biz_date(payload)) into v_max from public.approval_requests;
    if v_max is null then
      return jsonb_build_object('from', null, 'approvals', '[]'::jsonb, 'transactions', '[]'::jsonb);
    end if;
    v_from := least(date_trunc('month', v_max)::date, v_max - 7);
  end if;

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb) into v_appr from (
    select jsonb_build_object(
      'id', 'bf:' || md5(request_type || '|' || coalesce(requested_by_staff_id, '') || '|' || coalesce(entity_type, '') || '|' || coalesce(entity_id, '') || '|' || k::text),
      'request_type', request_type,
      'status', 'approved',
      'payload', k || jsonb_build_object('amount', sum(public.ducess_num(payload->>'amount')),
                                         'date', to_char(max(public.ducess_biz_date(payload)), 'YYYY-MM-DD'),
                                         'details', 'Balance brought forward',
                                         '__bf', true, '__count', count(*)),
      'requested_at', max(requested_at),
      'requested_by_staff_id', requested_by_staff_id,
      'requested_by_name', max(requested_by_name),
      'approved_at', max(approved_at),
      'approved_by_staff_id', max(approved_by_staff_id),
      'approved_by_name', max(approved_by_name),
      'decision_note', '',
      'entity_type', entity_type,
      'entity_id', entity_id) as row_obj
    from (select r.*, public.ducess_summary_key(r.payload) as k
            from public.approval_requests r
           where public.ducess_is_summarised(r.request_type, r.status, r.payload, v_from)) s
    group by request_type, requested_by_staff_id, entity_type, entity_id, k
  ) a;

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb) into v_tx from (
    select jsonb_build_object(
      'id', 'bf:' || customer_id::text || ':' || coalesce(account_id::text, '') || ':' || tx_type,
      'customer_id', customer_id,
      'account_id', account_id,
      'tx_type', tx_type,
      'amount', sum(amount),
      'details', 'Balance brought forward',
      'created_at', max(created_at),
      '__bf', true,
      '__count', count(*)) as row_obj
    from public.customer_transactions
   where customer_id is not null and created_at < v_from
   group by customer_id, account_id, tx_type
  ) t;

  return jsonb_build_object('from', v_from, 'approvals', v_appr, 'transactions', v_tx);
end;
$$;

-- Requests in full detail for the window (everything not summarised),
-- newest first, in pages, from the same light view the app already uses.
create or replace function public.ducess_recent_approvals(p_from date, p_offset int default 0, p_limit int default 500)
returns setof public.approval_requests_list_view language sql stable as $$
  select v.* from public.approval_requests_list_view v
   where not public.ducess_is_summarised(v.request_type, v.status, v.payload, p_from)
   order by v.requested_at desc, v.id desc
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
$$;

-- Customer transactions in full detail from the window start, in pages.
create or replace function public.ducess_recent_transactions(p_from date, p_offset int default 0, p_limit int default 1000)
returns setof public.customer_transactions language sql stable as $$
  select t.* from public.customer_transactions t
   where t.customer_id is not null and (p_from is null or t.created_at >= p_from)
   order by t.created_at, t.id
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
$$;

-- Older detail on demand: everything that was summarised for a window
-- starting at p_old_from but is in full detail for one starting at
-- p_new_from (requests), plus the transactions created in between.
create or replace function public.ducess_history_gap_approvals(p_new_from date, p_old_from date, p_offset int default 0, p_limit int default 1000)
returns setof public.approval_requests_list_view language sql stable as $$
  select v.* from public.approval_requests_list_view v
   where public.ducess_is_summarised(v.request_type, v.status, v.payload, p_old_from)
     and not public.ducess_is_summarised(v.request_type, v.status, v.payload, p_new_from)
   order by v.requested_at desc, v.id desc
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.ducess_history_gap_transactions(p_new_from date, p_old_from date, p_offset int default 0, p_limit int default 1000)
returns setof public.customer_transactions language sql stable as $$
  select t.* from public.customer_transactions t
   where t.customer_id is not null and t.created_at < p_old_from
     and (p_new_from is null or t.created_at >= p_new_from)
   order by t.created_at, t.id
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
$$;

-- Speeds up the window queries.
create index if not exists customer_transactions_created_at_idx on public.customer_transactions (created_at);

-- Same reach as reading the tables directly: these run with the caller's
-- own rights, so row-level security still applies.
grant execute on function public.ducess_history_window(date) to anon, authenticated;
grant execute on function public.ducess_recent_approvals(date, int, int) to anon, authenticated;
grant execute on function public.ducess_recent_transactions(date, int, int) to anon, authenticated;
grant execute on function public.ducess_history_gap_approvals(date, date, int, int) to anon, authenticated;
grant execute on function public.ducess_history_gap_transactions(date, date, int, int) to anon, authenticated;
grant execute on function public.ducess_biz_date(jsonb), public.ducess_num(text),
  public.ducess_is_summarised(text, text, jsonb, date), public.ducess_summary_key(jsonb) to anon, authenticated;
notify pgrst, 'reload schema';

select proname from pg_proc where proname in ('ducess_history_window', 'ducess_recent_approvals', 'ducess_recent_transactions', 'ducess_history_gap_approvals', 'ducess_history_gap_transactions') order by 1;
