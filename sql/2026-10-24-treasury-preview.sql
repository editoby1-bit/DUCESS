-- DUCESS 2026-10-24: preview of the Treasury account conversion.
-- Read-only: lists the accounts 2026-10-24-treasury-accounts.sql will
-- convert and the balance each keeps. "Balance" should match what the app
-- shows for that account today.
with shown as (
  select c.id, c.account_number, coalesce(nullif(c.display_name, ''), c.full_name) as name, s.full_name as staff_name,
    (select coalesce(sum(case when r.request_type in ('cash_receipt', 'inter_staff_credit')
                               and (r.payload->>'operationalAccountId' = c.id::text or r.payload->>'targetAccountId' = c.id::text)
                              then public.ducess_num(r.payload->>'amount') else 0 end), 0)
          - coalesce(sum(case when r.request_type = 'inter_staff_credit' and r.payload->>'sourceAccountId' = c.id::text
                              then public.ducess_num(r.payload->>'amount') else 0 end), 0)
          + coalesce(sum(case when r.payload->>'staffId' = c.linked_staff_id then case r.request_type
                when 'customer_credit' then public.ducess_num(r.payload->>'amount')
                when 'customer_credit_journal' then public.ducess_num(r.payload->>'formAmount')
                when 'customer_debit' then -public.ducess_num(r.payload->>'amount')
                when 'customer_debit_journal' then -public.ducess_num(r.payload->>'formAmount')
                else 0 end else 0 end), 0)
       from public.approval_requests r where r.status = 'approved') as balance
    from public.customers c
    left join public.staff s on s.id::text = c.linked_staff_id
   where c.account_type = 'staff_operational'
     and (s.role_code = 'cash_officer' or upper(coalesce(c.display_name, c.full_name, '')) like 'TREASURY%')
)
select account_number as "Account", name as "Name", staff_name as "Linked to", balance as "Balance"
  from shown order by account_number;
