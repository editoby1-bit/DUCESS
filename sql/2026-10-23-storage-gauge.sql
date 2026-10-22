-- DUCESS (2026-10-23): database space gauge for Administration → ICT Unit → Data Backup.
-- Read-only. Safe to run more than once.
create or replace function public.ducess_storage_usage()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'approvals_bytes', pg_total_relation_size('public.approval_requests'),
    'transactions_bytes', pg_total_relation_size('public.customer_transactions'),
    'audit_bytes', coalesce(pg_total_relation_size(to_regclass('public.audit_log')), 0),
    'customers_bytes', pg_total_relation_size('public.customers'),
    'checked_at', now())
$$;
revoke all on function public.ducess_storage_usage() from public, anon;
grant execute on function public.ducess_storage_usage() to authenticated;
notify pgrst, 'reload schema';

select public.ducess_storage_usage();
