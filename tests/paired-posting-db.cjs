// Runs against a disposable PostgreSQL instance supplied by PGlite.
const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const db = new PGlite();
  try {
    const migration = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
    await db.exec(`
      create role anon;
      create role authenticated;
      create table approval_requests(id text primary key, request_type text, status text, payload jsonb,
        approved_at timestamptz, approved_by_staff_id text, approved_by_name text, decision_note text);
      create table customers(id text primary key, account_type text, linked_staff_id text);
      create table customer_account_balances(account_id text primary key, book_balance numeric, updated_at timestamptz);
      create table customer_transactions(account_id text, customer_id text, approval_request_id text,
        tx_type text, amount numeric, balance_after numeric, effective_at timestamptz);
      create table staff_cash_ledger(staff_id text, approval_request_id text, entry_type text, amount numeric, delta numeric);
      create table audit_log(id text);
      insert into customers values ('customer','customer',null), ('income','income',null),
        ('expense','expense',null), ('treasury','treasury',null), ('teller','staff_operational','staff');
      insert into customer_account_balances(account_id,book_balance) values ('customer',10000),('income',0),('expense',0),('treasury',10000);
    `);
    await db.exec(migration('2026-10-22-fix-b-atomic-posting.sql'));
    await db.exec(migration('2026-11-25-paired-posting.sql'));
    const request = async (id, kind, source, target, amount) => {
      const handover = kind === 'Hand Over Cash';
      const payload = { pairedPosting: kind, sourceAccountId: source, [handover ? 'targetAccountId' : 'destAccountId']: target, amount, date: '2026-11-25' };
      await db.query("insert into approval_requests values ($1,$2,'pending',$3)", [id, handover ? 'inter_staff_credit' : 'intra_bank_transfer', payload]);
      const leg = (account, direction) => ({
        row: { account_id: account, customer_id: account, approval_request_id: id, tx_type: direction, amount, effective_at: '2026-11-25T12:00:00Z' },
        delta: direction === 'debit' ? -amount : amount
      });
      const transactions = handover ? [leg(target, 'credit')] : [leg(source, 'debit'), leg(target, kind === 'Pay Expense' ? 'debit' : 'credit')];
      const ledger = handover ? { staff_id: 'staff', approval_request_id: id, entry_type: 'inter_staff_debit', amount, delta: -amount } : null;
      return { payload, transactions, commit: () => db.query('select ducess_commit_paired_posting($1,$2,$3,$4,null)', [id, JSON.stringify(transactions), ledger, { payload }]) };
    };
    await (await request('charge', 'Charge Customer', 'customer', 'income', 2000)).commit();
    await (await request('allocate', 'Allocate Expense', 'income', 'expense', 500)).commit();
    await (await request('pay', 'Pay Expense', 'expense', 'treasury', 500)).commit();
    const balances = await db.query('select account_id, book_balance::int as balance from customer_account_balances order by account_id');
    assert.deepEqual(balances.rows, [
      { account_id: 'customer', balance: 8000 }, { account_id: 'expense', balance: 0 },
      { account_id: 'income', balance: 1500 }, { account_id: 'treasury', balance: 9500 }
    ]);
    await assert.rejects((await request('overdraw', 'Pay Expense', 'expense', 'treasury', 1)).commit(), /DUCESS_INSUFFICIENT_FUNDS/);
    const changed = await request('changed', 'Allocate Expense', 'income', 'expense', 5);
    await db.exec("update approval_requests set payload = payload || '{\"amount\": 6}' where id='changed'");
    await assert.rejects(changed.commit(), /DUCESS_INVALID_PAIRED_POSTING/);
    const handover = await request('handover', 'Hand Over Cash', 'teller', 'treasury', 50);
    await handover.commit();
    await assert.rejects(handover.commit(), /DUCESS_APPROVAL_NOT_PENDING/);
    assert.equal((await db.query('select count(*)::int as count from customer_transactions')).rows[0].count, 7);
    assert.equal((await db.query('select delta::int from staff_cash_ledger')).rows[0].delta, -50);
    console.log('PASS all four workflows, atomic rejection, changed request, and duplicate approval');
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
