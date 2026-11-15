-- DUCESS Work Review: ONE-FILE SETUP.
-- Paste this entire file into your project's Supabase SQL Editor and Run.
-- No knowledge of earlier installations is required. It creates the required
-- row-insertion helper ONLY if absent and preserves an existing helper.
-- Re-running this file is supported; it does not post/reverse any app work.
-- Function permissions continue to respect the signed-in user's RLS rights.
begin;

do $setup$
begin
  if to_regprocedure('public.ducess_insert_row(text,jsonb)') is null then
    execute $helper$
create function public.ducess_insert_row(p_table text, p_row jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
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
    $helper$;
    revoke all on function public.ducess_insert_row(text,jsonb) from public, anon;
    grant execute on function public.ducess_insert_row(text,jsonb) to authenticated;
  end if;
end;
$setup$;

create unique index if not exists ducess_one_pending_review_change on public.approval_requests ((payload->'__review'->>'sourceId')) where request_type='work_review_change' and status='pending';

create or replace function public.ducess_review_staff() returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare s public.staff%rowtype; extra boolean := false;
begin
  select * into s from public.staff where auth_user_id = auth.uid() and is_active = true;
  if not found then raise exception 'Sign in as an active staff member'; end if;
  if to_regclass('public.staff_extra_roles') is not null then
    execute 'select exists(select 1 from public.staff_extra_roles where staff_id = $1 and role_code = $2)'
      into extra using s.id::text, 'admin_officer';
  end if;
  return to_jsonb(s) || jsonb_build_object('is_admin', coalesce(s.role_code = 'admin_officer',false) or extra);
end $$;

create or replace function public.ducess_review_customer(p_id text,p_number text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id',id,'name',full_name,'full_name',full_name,'address',address,'phone',phone,'nin',nin,'bvn',bvn,'status',status,'is_active',is_active,'account_number',account_number)
    from public.customers where id::text=p_id or account_number=p_number limit 1;
$$;

create or replace function public.ducess_review_context(p_request_id text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare r public.approval_requests%rowtype; actor jsonb; customer jsonb; source_version text;
begin
  actor := public.ducess_review_staff();
  select * into r from public.approval_requests where id::text = p_request_id;
  if not found then raise exception 'Work record not found'; end if;
  if r.requested_by_staff_id::text is distinct from actor->>'id' and not (actor->>'is_admin')::boolean then
    raise exception 'Only the original staff member or an administrator can change this work';
  end if;
  if r.request_type like 'account_%' then
    customer := public.ducess_review_customer(coalesce(r.payload->>'customerId',r.payload->'__posting'->>'customerId'),coalesce(r.payload->>'generatedAccountNumber',r.payload->>'accountNumber'));
  end if;
  source_version := md5(coalesce(r.payload,'{}')::text || r.status::text);
  return jsonb_build_object('id', r.id, 'type', r.request_type, 'status', r.status, 'customer',customer, 'sourceVersion',source_version, 'accountVersion',md5(coalesce(customer,'null')::text),
    'payload', r.payload - array['photo','photoRef','fieldNote','__posting'],
    'version', md5(source_version || coalesce(customer,'null')::text));
end $$;

-- Whitelist edits: account numbers/identities, charges, recipients, routing,
-- and ownership cannot be rewritten by a browser patch.
create or replace function public.ducess_review_patch(p_type text, p_original jsonb, p_patch jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare outp jsonb := p_original; k text; permitted text[]; item jsonb; oldrow jsonb; rows jsonb := '[]'; i int := 0;
begin
  if p_type not in ('account_opening','account_maintenance','customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer','cash_receipt','inter_staff_credit','operational_entry') and p_patch <> '{}'::jsonb then raise exception 'This work has no editable fields; reverse it and submit a new request'; end if;
  if p_type in ('account_opening','account_maintenance') then
    permitted := array['name','address','phone','nin','bvn'];
  else
    permitted := array['amount','formAmount','details','description','note','receivedOrPaidBy','counterparty','journalDate','date'];
  end if;
  for k in select jsonb_object_keys(coalesce(p_patch,'{}')) loop
    if not (k = any(permitted)) and k <> 'rows' then raise exception 'This field cannot be edited: %', k; end if;
    if k = 'rows' then continue; end if;
    if k in ('amount','formAmount') and (jsonb_typeof(p_patch->k) <> 'number' or (p_patch->>k)::numeric <= 0) then
      raise exception 'Amounts must be greater than zero';
    end if;
    if k not in ('amount','formAmount') and jsonb_typeof(p_patch->k) is distinct from 'string' then raise exception 'Enter text for %',k; end if;
    if k='name' and trim(p_patch->>k)='' then raise exception 'Account name is required'; end if;
    if k in ('date','journalDate') then perform (p_patch->>k)::date; end if;
    if p_type = 'account_maintenance' then
      outp := jsonb_set(outp, '{patch}', coalesce(outp->'patch',outp->'updates','{}') || jsonb_build_object(k,p_patch->k));
    else outp := outp || jsonb_build_object(k,p_patch->k);
      if p_type='account_opening' and k='name' then outp := outp || jsonb_build_object('fullName',p_patch->k); end if;
    end if;
  end loop;
  if p_patch ? 'rows' then
    if p_type not in ('customer_credit_journal','customer_debit_journal') or jsonb_array_length(p_patch->'rows') <> jsonb_array_length(p_original->'rows') then
      raise exception 'Journal accounts and row count cannot be changed in Work Review';
    end if;
    for item in select value from jsonb_array_elements(p_patch->'rows') loop
      oldrow := p_original->'rows'->i;
      if jsonb_typeof(item->'amount') is distinct from 'number' or (item->>'amount')::numeric <= 0 then raise exception 'Row amounts must be greater than zero'; end if;
      rows := rows || jsonb_build_array(oldrow || jsonb_build_object('amount',(item->>'amount')::numeric,'details',coalesce(item->>'details',oldrow->>'details','')));
      i := i + 1;
    end loop;
    outp := jsonb_set(outp,'{rows}',rows);
  end if;
  -- Charges are preserved rather than silently recomputed or scaled.
  if (coalesce((outp->>'totalChargeAmount')::numeric,0) > 0 or coalesce((outp->>'commissionAmount')::numeric,0)>0 or jsonb_array_length(coalesce(outp->'chargeBreakdown','[]'))>0) and outp->'amount' is distinct from p_original->'amount' then
    raise exception 'Amount changes on charged postings need a new posting; reverse this one first';
  end if;
  i := 0;
  for item in select value from jsonb_array_elements(coalesce(outp->'rows','[]')) loop
    oldrow := p_original->'rows'->i;
    if (coalesce((item->>'totalChargeAmount')::numeric,0) > 0 or coalesce((item->>'commissionAmount')::numeric,0)>0 or jsonb_array_length(coalesce(item->'chargeBreakdown','[]'))>0) and item->'amount' is distinct from oldrow->'amount' then
      raise exception 'Amount changes on charged journal rows need a new posting';
    end if;
    i := i+1;
  end loop;
  return outp;
end $$;

create or replace function public.ducess_submit_review_action(p_request_id text, p_action text, p_patch jsonb, p_reason text, p_version text, p_date date)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.approval_requests%rowtype; q public.approval_requests%rowtype; actor jsonb; context jsonb; replacement jsonb; meta jsonb;
begin
  actor := public.ducess_review_staff();
  select * into r from public.approval_requests where id::text=p_request_id for update;
  context := public.ducess_review_context(p_request_id);
  if p_date is null then raise exception 'A correction date is required'; end if;
  if p_action not in ('edit','reverse') or (length(trim(coalesce(p_reason,''))) < 3 or length(p_reason)>500) then raise exception 'Enter a reason for the change'; end if;
  if context->>'version' is distinct from p_version then raise exception 'This work changed. Close and reopen it before continuing'; end if;
  if r.payload ? '__reviewResolved' or (r.request_type = 'work_review_change' and r.status <> 'pending') then raise exception 'This work already has a completed correction'; end if;
  if r.status not in ('pending','approved') then raise exception 'Only pending or approved work can be changed'; end if;
  if exists(select 1 from public.approval_requests a where a.request_type='work_review_change' and a.status='pending' and a.payload->'__review'->>'sourceId'=p_request_id) then
    raise exception 'A correction is already awaiting approval for this work';
  end if;
  replacement := public.ducess_review_patch(r.request_type,coalesce(r.payload,'{}'),case when p_action='edit' then p_patch else '{}' end);
  if r.status='pending' then
    update public.approval_requests set payload=case when p_action='edit' then replacement else payload || jsonb_build_object('__reviewWithdrawn',true) end,
      status=case when p_action='reverse' then 'rejected' else status end,
      decision_note=case when p_action='reverse' then 'Withdrawn: '||p_reason else decision_note end
      where id=r.id returning * into q;
  else
    if r.request_type not in ('account_opening','account_maintenance','account_reactivation','account_block','account_closure','customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer','cash_receipt','inter_staff_credit','operational_entry') then
      raise exception 'This work type does not support corrections yet';
    end if;
    if p_action='edit' and r.request_type not in ('account_opening','account_maintenance','customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer','operational_entry') then
      raise exception 'Use Reverse followed by a new posting for this work type';
    end if;
    if r.payload->>'accountType' in ('staff','staff_wallet') or exists(select 1 from jsonb_array_elements(coalesce(r.payload->'rows','[]')) x where x->>'accountType' in ('staff','staff_wallet')) then
      raise exception 'Browser-only staff wallet entries cannot be reversed through the database';
    end if;
    if r.request_type='account_maintenance' and p_action='reverse' and not (r.payload ? '__reviewBefore') then raise exception 'This older maintenance record has no previous-values snapshot. Use Edit to correct the account'; end if;
    replacement := replacement || jsonb_build_object('date',p_date);
    meta := jsonb_build_object('action',p_action,'sourceId',r.id,'originalType',r.request_type,'sourceVersion',context->>'sourceVersion','accountVersion',context->>'accountVersion','reason',p_reason,'date',p_date,
      'initiatedBy',actor->>'id','initiatedByName',actor->>'full_name');
    if p_action='edit' then meta := meta || jsonb_build_object('originalPayload',r.payload - array['photo','photoRef','fieldNote','__posting']); end if;
    insert into public.approval_requests(request_type,status,payload,requested_by_staff_id,requested_by_name,requested_at,entity_type,entity_id)
      values('work_review_change','pending',(replacement - array['photo','photoRef','fieldNote','__posting']) || jsonb_build_object('__review',meta),r.requested_by_staff_id,r.requested_by_name,now(),'approval_request',r.id)
      returning * into q;
  end if;
  perform public.ducess_insert_row('audit_log',jsonb_build_object('actor_staff_id',actor->>'id','action_type','work_review_'||p_action,'entity_type','approval_request','entity_id',r.id,'metadata',jsonb_build_object('reason',p_reason,'requestId',q.id),'created_at',now()));
  return to_jsonb(q);
end $$;

-- Atomic reversal + optional replacement, with request/source locks. There is
-- deliberately no fallback to a sequence of browser writes if this RPC is absent.
create or replace function public.ducess_commit_review_change(p_request_id text,p_transactions jsonb,p_ledger jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare q public.approval_requests%rowtype; src public.approval_requests%rowtype; actor jsonb; m jsonb; tx jsonb; line jsonb; b numeric; delta numeric; cid text; c public.customers%rowtype; patch jsonb; before_values jsonb; result jsonb; role_ok boolean; account_key public.customer_account_balances%rowtype;
begin
  actor := public.ducess_review_staff();
  role_ok := coalesce((actor->>'is_admin')::boolean,false) or coalesce(actor->>'role_code'='approving_officer',false);
  if not role_ok and to_regclass('public.staff_extra_roles') is not null then
    execute 'select exists(select 1 from public.staff_extra_roles where staff_id=$1 and role_code=$2)' into role_ok using actor->>'id','approving_officer';
  end if;
  if not role_ok then raise exception 'Approval permission is required'; end if;
  select * into q from public.approval_requests where id::text=p_request_id for update;
  if not found or q.request_type <> 'work_review_change' then raise exception 'Correction request not found'; end if;
  if q.status='approved' then return to_jsonb(q); end if;
  if q.status<>'pending' then raise exception 'This correction is no longer pending'; end if;
  m := q.payload->'__review';
  if actor->>'id' in (q.requested_by_staff_id::text,m->>'initiatedBy') then raise exception 'A different officer must approve this correction'; end if;
  if nullif(q.payload->>'assignedApproverId','') is not null and q.payload->>'assignedApproverId' <> actor->>'id' and not (actor->>'is_admin')::boolean then raise exception 'This correction is assigned to another officer'; end if;
  select * into src from public.approval_requests where id::text=m->>'sourceId' for update;
  if not found or src.status<>'approved' or src.payload ? '__reviewResolved' then raise exception 'The original work cannot be corrected again'; end if;
  if md5(coalesce(src.payload,'{}')::text || src.status::text) is distinct from m->>'sourceVersion' then raise exception 'The original work changed after this correction was requested'; end if;
  if src.request_type like 'account_%' then
    cid := coalesce(nullif(src.payload->>'customerId',''),nullif(src.payload->'__posting'->>'customerId',''));
    select * into c from public.customers where id::text=cid or account_number=coalesce(src.payload->>'generatedAccountNumber',src.payload->>'accountNumber') for update;
    if not found then raise exception 'The account for this work was not found'; end if;
    if md5(coalesce(public.ducess_review_customer(c.id::text,null),'null')::text) is distinct from m->>'accountVersion' then raise exception 'The account changed after this correction was requested. Reject it and reopen Work Review'; end if;
    if m->>'action'='edit' then
      patch := case when src.request_type='account_maintenance' then coalesce(q.payload->'patch',q.payload->'updates','{}') else q.payload end;
      before_values := jsonb_build_object('full_name',c.full_name,'address',c.address,'phone',c.phone,'nin',c.nin,'bvn',c.bvn,'old_account_number',to_jsonb(c)->'old_account_number','status',c.status,'is_active',c.is_active);
      update public.customers set full_name=coalesce(patch->>'name',full_name),address=coalesce(patch->>'address',address),phone=coalesce(patch->>'phone',phone),nin=coalesce(patch->>'nin',nin),bvn=coalesce(patch->>'bvn',bvn) where id=c.id;
      q.payload := q.payload || jsonb_build_object('__reviewBefore',before_values,'customerId',c.id);
    else
      if src.request_type='account_opening' then
        if exists(select 1 from public.customer_transactions where customer_id=c.id) or exists(select 1 from public.customer_account_balances b join public.customer_accounts a on a.id=b.account_id where a.customer_id=c.id and b.book_balance<>0) or (c.linked_staff_id is not null and exists(select 1 from public.staff_cash_ledger where staff_id=c.linked_staff_id)) then raise exception 'An account with postings cannot have its opening reversed'; end if;
        update public.customers set status='closed',is_active=false where id=c.id;
      elsif src.request_type='account_maintenance' then
        patch := src.payload->'__reviewBefore';
        if patch is null then raise exception 'This older maintenance record has no previous-values snapshot. Use Edit to correct the account'; end if;
        if exists(select 1 from jsonb_each_text(coalesce(src.payload->'patch',src.payload->'updates','{}')) x
          where x.key in ('name','address','phone','nin','bvn','oldAccountNumber') and (to_jsonb(c)->>case when x.key='name' then 'full_name' when x.key='oldAccountNumber' then 'old_account_number' else x.key end) is distinct from x.value) then
          raise exception 'Later work changed this account. Use Edit instead of reversing an old update';
        end if;
        update public.customers set
          full_name=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'name' then patch->>'full_name' else full_name end,
          address=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'address' then patch->>'address' else address end,
          phone=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'phone' then patch->>'phone' else phone end,
          nin=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'nin' then patch->>'nin' else nin end,
          bvn=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'bvn' then patch->>'bvn' else bvn end,
          old_account_number=case when coalesce(src.payload->'patch',src.payload->'updates','{}') ? 'oldAccountNumber' then patch->>'old_account_number' else old_account_number end where id=c.id;
      else
        if c.status is distinct from (case when src.request_type='account_reactivation' then 'active' when src.request_type='account_block' then 'frozen' else 'closed' end) then raise exception 'Later work changed this account status. Use a new account request'; end if;
        if src.request_type='account_closure' and not(src.payload ? '__reviewBefore') then raise exception 'This older closure has no previous status snapshot'; end if;
        update public.customers set status=coalesce(src.payload->'__reviewBefore'->>'status',case when src.request_type='account_reactivation' then 'frozen' else 'active' end),is_active=coalesce((src.payload->'__reviewBefore'->>'is_active')::boolean,true) where id=c.id;
      end if;
    end if;
    q.payload := q.payload || jsonb_build_object('customerId',c.id);
    if exists(select 1 from pg_attribute where attrelid='public.customers'::regclass and attname='display_name' and not attisdropped) then
      execute 'update public.customers set display_name=full_name where id=$1' using c.id;
    end if;
  elsif src.request_type='operational_entry' then
    -- This existing workflow stores its book entries in the approval payload.
    -- The same cached projection applies the inverse/replacement on every client.
    null;
  else
    -- Lock all affected accounts in a stable order, including replacement legs.
    for cid in select distinct id from (
      select account_id::text id from public.customer_transactions where approval_request_id::text=src.id::text
      union select x->'row'->>'account_id' from jsonb_array_elements(coalesce(p_transactions,'[]')) x
    ) ids where id is not null order by id loop
      perform 1 from public.customer_account_balances where account_id::text=cid for update;
    end loop;
    if not exists(select 1 from public.customer_transactions where approval_request_id::text=src.id::text) and not exists(select 1 from public.staff_cash_ledger where approval_request_id::text=src.id::text) then raise exception 'No database postings were found for this work'; end if;
    -- Opposite entries keep originals intact. No transaction rows are deleted.
    for tx in select to_jsonb(t) from public.customer_transactions t where approval_request_id::text=src.id::text order by account_id::text,id::text loop
      delta := case when tx->>'tx_type'='credit' then -(tx->>'amount')::numeric else (tx->>'amount')::numeric end;
      select book_balance into b from public.customer_account_balances where account_id::text=tx->>'account_id';
      if b is null then raise exception 'Account balance is missing'; end if;
      b := b+delta;
      perform public.ducess_insert_row('customer_transactions',(tx-array['id','inserted_at']) || jsonb_build_object('approval_request_id',q.id,'tx_type',case when tx->>'tx_type'='credit' then 'debit' else 'credit' end,'details','Reversal: '||coalesce(tx->>'details','')||' — '||(m->>'reason'),'posted_by',m->>'initiatedByName','posted_by_id',m->>'initiatedBy','approved_by',actor->>'full_name','effective_at',(m->>'date')::date + time '12:00','created_at',now(),'balance_after',b));
      update public.customer_account_balances set book_balance=b,updated_at=now() where account_id::text=tx->>'account_id';
    end loop;
    for tx in select to_jsonb(l) from public.staff_cash_ledger l where approval_request_id::text=src.id::text loop
      perform public.ducess_insert_row('staff_cash_ledger',(tx-array['id','inserted_at']) || jsonb_build_object('approval_request_id',q.id,'entry_type',case tx->>'entry_type' when 'customer_credit' then 'customer_debit' when 'customer_debit' then 'customer_credit' when 'customer_credit_journal' then 'customer_debit_journal' when 'customer_debit_journal' then 'customer_credit_journal' else 'work_review_reverse' end,'delta',-(tx->>'delta')::numeric,'note','Reversal: '||(m->>'reason'),'float_date',m->>'date','created_at',now(),'created_by_staff_id',m->>'initiatedBy','approved_by_staff_id',actor->>'id'));
    end loop;
    if m->>'action'='edit' then
      if jsonb_array_length(coalesce(p_transactions,'[]'))=0 then raise exception 'Replacement posting plan is missing'; end if;
      for line in select value from jsonb_array_elements(p_transactions) loop
        if not exists(select 1 from public.customer_transactions where approval_request_id::text=src.id::text and account_id::text=line->'row'->>'account_id') then raise exception 'An edited posting cannot change accounts'; end if;
        if (line->>'delta')::numeric <> (case when line->'row'->>'tx_type'='credit' then 1 else -1 end)*(line->'row'->>'amount')::numeric or (line->'row'->>'amount')::numeric <= 0 then raise exception 'Invalid replacement amount'; end if;
        select book_balance into b from public.customer_account_balances where account_id::text=line->'row'->>'account_id';
        if b is null then raise exception 'Replacement account balance is missing'; end if;
        b := b+(line->>'delta')::numeric;
        perform public.ducess_insert_row('customer_transactions',(line->'row') || jsonb_build_object('approval_request_id',q.id,'balance_after',b));
        update public.customer_account_balances set book_balance=b,updated_at=now() where account_id::text=line->'row'->>'account_id';
      end loop;
      if jsonb_typeof(p_ledger)='object' then
        if not exists(select 1 from public.staff_cash_ledger where approval_request_id::text=src.id::text and staff_id::text=p_ledger->>'staff_id') then raise exception 'An edit cannot change the staff ledger owner'; end if;
        perform public.ducess_insert_row('staff_cash_ledger',p_ledger || jsonb_build_object('approval_request_id',q.id)); end if;
    end if;
    -- A pure reversal or a corrected posting must leave money accounts funded.
    if exists(select 1 from public.customer_account_balances b join public.customer_accounts a on a.id=b.account_id join public.customers cust on cust.id=a.customer_id where b.book_balance<0 and coalesce(cust.account_type,'customer') not in ('income','expense') and b.account_id::text in (select account_id::text from public.customer_transactions where approval_request_id::text=q.id::text)) then raise exception 'The correction would overdraw an account'; end if;
  end if;
  update public.approval_requests set payload=payload||jsonb_build_object('__reviewResolved',jsonb_build_object('requestId',q.id,'action',m->>'action','at',now())) where id=src.id;
  update public.approval_requests set status='approved',approved_at=now(),approved_by_staff_id=(actor->>'id')::uuid,approved_by_name=actor->>'full_name',payload=q.payload where id=q.id returning to_jsonb(approval_requests.*) into result;
  perform public.ducess_insert_row('audit_log',jsonb_build_object('actor_staff_id',actor->>'id','action_type','work_review_change_approved','entity_type','approval_request','entity_id',q.id,'metadata',jsonb_build_object('sourceId',src.id,'action',m->>'action','reason',m->>'reason'),'created_at',now()));
  return result;
end $$;

revoke all on function public.ducess_review_staff(), public.ducess_review_customer(text,text), public.ducess_review_context(text), public.ducess_review_patch(text,jsonb,jsonb), public.ducess_submit_review_action(text,text,jsonb,text,text,date), public.ducess_commit_review_change(text,jsonb,jsonb) from public, anon;
grant execute on function public.ducess_review_staff(), public.ducess_review_customer(text,text), public.ducess_review_context(text), public.ducess_review_patch(text,jsonb,jsonb), public.ducess_submit_review_action(text,text,jsonb,text,text,date), public.ducess_commit_review_change(text,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';

commit;
select 'Work Review setup complete' as result;
