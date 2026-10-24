-- DUCESS 2026-10-24: Treasury accounts become business accounts.
--
-- A Treasury account is no longer linked to a staff member. It is an
-- account of the business that money flows in and out of like a customer
-- account (account type 'treasury', numbers in the same T series).
--
-- This script converts the existing Treasury accounts — operational ("T")
-- accounts linked to a Treasury staff member, or named "TREASURY ..." —
-- into business Treasury accounts. Each keeps its account number and the
-- balance the app shows for it today: that balance is carried over as one
-- transaction ("Treasury balance carried over"), so from now on the account
-- is a normal account with its own statement.
--
-- Run 2026-10-24-treasury-preview.sql first to see exactly which accounts
-- will be converted and with what balance. Safe to run more than once:
-- an account that is already a Treasury account is left alone.

-- 1. Allow the new account type if the tables restrict account_type.
do $$
declare
  r record;
  v_new text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in (select oid from pg_class where oid in (to_regclass('public.customers'), to_regclass('public.customer_accounts')))
       and pg_get_constraintdef(c.oid) ilike '%account_type%'
       and pg_get_constraintdef(c.oid) not ilike '%treasury%'
  loop
    v_new := regexp_replace(r.def, '''staff_operational''(::text)?', '''staff_operational''\1, ''treasury''\1');
    if v_new = r.def then
      raise exception 'DUCESS: could not add treasury to constraint % on % (%) — send this message to support', r.conname, r.tbl, r.def;
    end if;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, v_new);
  end loop;
end $$;

-- 2. The balance the app shows for an operational account today (same rule
--    as the app): money funded into it (cash receipts, transfers in) minus
--    transfers out of it, plus customer credits and minus customer debits
--    posted by the linked staff member.
create or replace function public.ducess_operational_balance(p_account text, p_staff text)
returns numeric language sql stable as $$
  select coalesce(sum(case
      when r.request_type in ('cash_receipt', 'inter_staff_credit')
           and (r.payload->>'operationalAccountId' = p_account or r.payload->>'targetAccountId' = p_account)
        then public.ducess_num(r.payload->>'amount') else 0 end), 0)
   - coalesce(sum(case
      when r.request_type = 'inter_staff_credit' and r.payload->>'sourceAccountId' = p_account
        then public.ducess_num(r.payload->>'amount') else 0 end), 0)
   + coalesce(sum(case when p_staff is not null and r.payload->>'staffId' = p_staff then case r.request_type
        when 'customer_credit' then public.ducess_num(r.payload->>'amount')
        when 'customer_credit_journal' then public.ducess_num(r.payload->>'formAmount')
        when 'customer_debit' then -public.ducess_num(r.payload->>'amount')
        when 'customer_debit_journal' then -public.ducess_num(r.payload->>'formAmount')
        else 0 end else 0 end), 0)
  from public.approval_requests r
  where r.status = 'approved'
$$;

-- Treasury accounts still to convert.
create or replace function public.ducess_treasury_candidates()
returns table (id uuid, account_number text, name text, staff_id text, staff_name text, shown_balance numeric, transactions_balance numeric)
language sql stable as $$
  select c.id, c.account_number, coalesce(nullif(c.display_name, ''), c.full_name), c.linked_staff_id, s.full_name,
         public.ducess_operational_balance(c.id::text, c.linked_staff_id),
         coalesce((select sum(case when t.tx_type = 'credit' then t.amount else -t.amount end)
                     from public.customer_transactions t where t.customer_id = c.id), 0)
    from public.customers c
    left join public.staff s on s.id::text = c.linked_staff_id
   where c.account_type = 'staff_operational'
     and (s.role_code = 'cash_officer' or upper(coalesce(c.display_name, c.full_name, '')) like 'TREASURY%')
$$;

-- 3. Convert.
do $$
declare
  r record;
  v_adj numeric;
  v_acct uuid;
begin
  for r in select * from public.ducess_treasury_candidates() loop
    v_adj := r.shown_balance - r.transactions_balance;
    -- the same account key the account's existing transactions use
    select t.account_id into v_acct from public.customer_transactions t
     where t.customer_id = r.id and t.account_id is not null order by t.created_at desc limit 1;
    v_acct := coalesce(v_acct, r.id);
    if v_adj <> 0 then
      insert into public.customer_transactions (customer_id, account_id, tx_type, amount, details, posted_by, approved_by, effective_at, created_at, balance_after)
      values (r.id, v_acct, case when v_adj > 0 then 'credit' else 'debit' end, abs(v_adj),
              'Treasury balance carried over (now a business Treasury account)', 'System', 'System', now(), now(), r.shown_balance);
    end if;
    insert into public.customer_account_balances (account_id, book_balance, updated_at)
    values (v_acct, r.shown_balance, now())
    on conflict (account_id) do update set book_balance = excluded.book_balance, updated_at = excluded.updated_at;
    update public.customers set account_type = 'treasury', linked_staff_id = null where id = r.id;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_accounts' and column_name = 'customer_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_accounts' and column_name = 'account_type') then
      execute 'update public.customer_accounts set account_type = ''treasury'' where customer_id = $1' using r.id;
    end if;
    insert into public.audit_log (action_type, entity_type, entity_id, metadata, created_at)
    values ('treasury_account_converted', 'customer', r.id::text,
            jsonb_build_object('accountNumber', r.account_number, 'name', r.name, 'formerStaffId', r.staff_id, 'formerStaffName', r.staff_name,
                               'balance', r.shown_balance, 'carriedOver', v_adj), now());
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Treasury accounts converted (by this run or an earlier one).
select metadata->>'accountNumber' as "Account", metadata->>'name' as "Name", metadata->>'formerStaffName' as "Was linked to",
       (metadata->>'balance')::numeric as "Balance", created_at as "Converted at"
  from public.audit_log where action_type = 'treasury_account_converted' order by 1;
