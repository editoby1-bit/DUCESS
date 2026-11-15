Run the browser checks in the prepared cloud environment:

```sh
node tests/ledger-ui.cjs
node tests/work-review-gateway.cjs
```

The browser suite uses Playwright and Chromium with synthetic fixtures and blocks external requests. Gateway checks use a fake Supabase client.

Run the SQL checks in an isolated, in-memory PostgreSQL instance:

```sh
npm install --prefix /tmp/ducess-sql-test --cache /tmp/ducess-npm-cache --no-audit --no-fund @electric-sql/pglite@0.3.14
NODE_PATH=/tmp/ducess-sql-test/node_modules node tests/work-review-db.cjs
```

These checks never connect to the live Supabase project. The SQL fixture covers the columns used by this migration; it does not replace checking the live schema and its RLS policies at deployment.

To activate Work Review actions, run the entire `sql/2026-11-13-work-review-actions.sql` file in the Supabase SQL Editor, and deploy the updated app assets. This one-file setup creates its prerequisite helper only if missing; it preserves an existing helper. The final result is `Work Review setup complete`. You do not need to know which earlier scripts were installed. No live database migration or publication was performed by these tests.

Edit updates a pending request. Reverse withdraws a pending request. For approved work, both create a correction request that a different authorized officer must approve. Posted corrections add opposite entries, and financial edits reverse and replace in one database transaction. Original postings and their dates remain intact.

Account IDs, account numbers, ownership, charges and recipients are not editable here. Correcting an account/recipient requires reversal and a new posting. Charged amounts cannot be silently recalculated. Tasks without editable fields use Reverse followed by a new request. Completed corrections cannot be applied twice; their action buttons are disabled. Older maintenance records without saved previous values, accounts with postings whose opening is being reversed, and browser-only wallet entries cannot be reversed through this workflow. The UI/backend explain these cases instead of guessing or deleting financial history.

There are no new background reads. Opening an action reads one compact record; saving and approval use atomic RPCs. Photos and field-note bytes are excluded from correction snapshots. Existing incremental sync and IndexedDB caching are retained; derived reversal events are transient and never become sync IDs.
