-- Apply after 2026-10-22-fix-b-atomic-posting.sql.
create or replace function public.ducess_commit_paired_posting(
  p_request_id text, p_transactions jsonb, p_ledger jsonb, p_approval jsonb, p_audit jsonb
) returns jsonb language plpgsql as $$
declare
  request public.approval_requests%rowtype;
  source_account public.customers%rowtype;
  target_account public.customers%rowtype;
  item jsonb;
  leg jsonb;
  amount numeric;
  direction text;
  expected_route text;
  source_id text;
  target_id text;
  available numeric;
begin
  select * into request from public.approval_requests where id::text = p_request_id for update;
  if not found or request.status <> 'pending' then
    raise exception 'DUCESS_APPROVAL_NOT_PENDING';
  end if;

  if request.request_type = 'inter_staff_credit' and request.payload->>'pairedPosting' = 'Hand Over Cash' then
    -- The staff movement is driven by the approval payload; Treasury receives the transaction.
    source_id := request.payload->>'sourceAccountId';
    target_id := request.payload->>'targetAccountId';
    amount := (request.payload->>'amount')::numeric;
    leg := p_transactions->0;
    if amount is null or amount <= 0 or jsonb_array_length(coalesce(p_transactions, '[]')) <> 1
       or leg->'row'->>'customer_id' is distinct from target_id
       or leg->'row'->>'account_id' is distinct from target_id
       or leg->'row'->>'tx_type' is distinct from 'credit'
       or leg->'row'->>'approval_request_id' is distinct from p_request_id
       or (leg->'row'->>'amount')::numeric is distinct from amount
       or (leg->>'delta')::numeric is distinct from amount
       or ((leg->'row'->>'effective_at')::timestamptz at time zone 'UTC')::date::text is distinct from request.payload->>'date'
       or p_ledger->>'entry_type' is distinct from 'inter_staff_debit'
       or p_ledger->>'approval_request_id' is distinct from p_request_id
       or (p_ledger->>'amount')::numeric is distinct from amount
       or (p_ledger->>'delta')::numeric is distinct from -amount
       or not exists (select 1 from public.customers where id::text = source_id and account_type = 'staff_operational' and linked_staff_id::text = p_ledger->>'staff_id')
       or not exists (select 1 from public.customers where id::text = target_id and account_type = 'treasury') then
      raise exception 'DUCESS_INVALID_PAIRED_POSTING';
    end if;
  else
    source_id := request.payload->>'sourceAccountId';
    target_id := request.payload->>'destAccountId';
    amount := (request.payload->>'amount')::numeric;
    if request.request_type <> 'intra_bank_transfer' or source_id is null or target_id is null or source_id = target_id
       or amount is null or amount <= 0 or jsonb_array_length(coalesce(p_transactions, '[]')) <> 2 or p_ledger is not null then
      raise exception 'DUCESS_INVALID_PAIRED_POSTING';
    end if;
    perform 1 from public.customers where id::text in (source_id, target_id) order by id for update;
    select * into source_account from public.customers where id::text = source_id;
    select * into target_account from public.customers where id::text = target_id;
    expected_route := case source_account.account_type || ':' || target_account.account_type
      when 'customer:income' then 'Charge Customer'
      when 'income:expense' then 'Allocate Expense'
      when 'expense:treasury' then 'Pay Expense'
    end;
    if expected_route is null or expected_route is distinct from request.payload->>'pairedPosting' then
      raise exception 'DUCESS_INVALID_PAIRED_POSTING';
    end if;
    for item in select value from jsonb_array_elements(p_transactions) with ordinality as legs(value, position) order by position loop
      leg := item->'row';
      direction := case when leg->>'customer_id' = source_id or expected_route = 'Pay Expense' then 'debit' else 'credit' end;
      if leg->>'customer_id' is distinct from (case when item = p_transactions->0 then source_id else target_id end)
         or leg->>'account_id' is distinct from leg->>'customer_id'
         or leg->>'approval_request_id' is distinct from p_request_id
         or leg->>'tx_type' is distinct from direction
         or (leg->>'amount')::numeric is distinct from amount
         or (item->>'delta')::numeric is distinct from (case when direction = 'debit' then -amount else amount end)
         or (leg->>'effective_at')::timestamptz is null
         or ((leg->>'effective_at')::timestamptz at time zone 'UTC')::date::text is distinct from request.payload->>'date' then
        raise exception 'DUCESS_INVALID_PAIRED_POSTING';
      end if;
      if direction = 'debit' then
        select book_balance into available from public.customer_account_balances where account_id::text = leg->>'account_id' for update;
        if not found or available is null then
          select coalesce(sum(case tx_type when 'credit' then t.amount when 'debit' then -t.amount else 0 end), 0)
          into available from public.customer_transactions t where t.customer_id::text = leg->>'customer_id';
        end if;
        if available < amount then raise exception 'DUCESS_INSUFFICIENT_FUNDS'; end if;
      end if;
    end loop;
  end if;
  if ((p_approval->'payload') - '__posting'::text) is distinct from (request.payload - '__posting'::text) then
    raise exception 'DUCESS_PAIRED_REQUEST_CHANGED';
  end if;
  return public.ducess_commit_posting(p_request_id, p_transactions, p_ledger, p_approval, p_audit);
end;
$$;

revoke all on function public.ducess_commit_paired_posting(text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.ducess_commit_paired_posting(text, jsonb, jsonb, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
