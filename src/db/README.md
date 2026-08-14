# Database

```bash
npm run db:apply    # apply pending SQL migrations
npm run db:seed     # wipe and rebuild the demo dealership
```

## Do not run `drizzle-kit push`

`npm run db:push` is deliberately wired to fail with an explanation.

The row-level-security policies in this database were applied as raw SQL and
are **not declared in the Drizzle schema**. `push` diffs the schema against the
live database, sees 45 policies it does not know about, and proposes
`DROP POLICY` for every one of them. Accepting that prompt removes tenant
isolation from every table, silently, and the app keeps working — which is the
worst possible failure mode.

This was found the honest way: running it, and being saved by the fact that the
confirmation prompt could not open without a TTY.

Until the policies are declared in the schema, migrations are hand-written.

## Migrations

Files in `src/db/migrations`, applied in filename order by
`scripts/apply-migrations.ts`, tracked in an `_applied_migrations` table so
each runs once.

Write them **idempotently** — `CREATE TABLE IF NOT EXISTS`, `ADD VALUE IF NOT
EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`. The early migrations
predate this rule and will fail if replayed, which is what the ledger is for.

Adopting a database that already has some of these applied:

```bash
npx tsx --env-file=.env.local scripts/apply-migrations.ts --mark 0000_init_crm_schema.sql
```

Records a file as applied without running it.

## Closing the RLS gap

Worth stating plainly, because it is the largest outstanding risk in the
project: **RLS is not currently the enforcement boundary.** The app connects
with the privileged `DATABASE_URL`, which bypasses every policy above. Tenant
scoping today is a code convention — every query filters by `storeId` because
the developer remembered to.

The policies exist and are correct. What is missing is the app connecting *as
the signed-in user* so they apply. Until that lands, a missing `storeId` filter
in one query is a cross-tenant data leak rather than a caught error, and that
has to close before a second dealership's data goes in.
