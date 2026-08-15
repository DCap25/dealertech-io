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

## Data access: which connection, and why

There are two ways to reach the database and the choice is not stylistic.

### `withCurrentUserScope` — everything a signed-in person does

```ts
const rows = await withCurrentUserScope((db) => db.select()...)
```

Opens a transaction, becomes the `authenticated` role inside it, and puts the
user's id in `request.jwt.claims` where `auth.uid()` reads it. The policies then
apply, so **a query that forgets `WHERE store_id = ?` returns nothing instead of
another dealership's customers.**

One wrapper, two guarantees — it is also the transaction, so a multi-step write
is atomic for free. Two rules follow from that:

- **Never open a transaction inside it.** The pool is `max: 1` behind a pooler.
  Asking for a second connection while holding the only one is a deadlock, not a
  slow query. If a helper needs to run on the caller's transaction, give it a
  `ScopedDb` parameter — see `nextRoNumberScoped`.
- **Put the reads inside too, not just the writes.** An action is handed an id,
  looks it up, and copies `storeId`/`customerId`/`vehicleId` off the result.
  Scoping only the write leaves the lookup free to resolve another tenant's row,
  and the write then lands wherever that row pointed.

`Promise.all` inside a scope runs sequentially — one transaction is one
connection. That is the cost of the boundary and it is worth paying.

### `getDb()` — privileged, and only where a user cannot be the subject

Connects as `postgres`, which carries `BYPASSRLS`. Legitimate uses, all of them
cases where scoping to the signed-in user is impossible rather than
inconvenient:

| Where | Why it cannot be scoped |
|---|---|
| `lib/auth/session.ts` | Establishes the identity everything else scopes *by* |
| `lib/pricing/run.ts`, `lib/cadence/run.ts` | Scheduled jobs; no user at all |
| `lib/invites/accept.ts` | Runs for someone with no store role yet — the point of an invitation |
| `lib/invites/provision.ts`, `app/admin/actions.ts` | Bootstraps a tenant that does not exist yet |
| `lib/pairing/store.ts`, `lib/presentation/link-store.ts` | Tablet and customer link authenticate by bearer token; there is no session |
| `app/request-demo/actions.ts` | Public, unauthenticated |
| migrations, seeds, `scripts/` | Own the schema |

Adding a new one deserves a comment saying which row of that table it belongs
to. If it does not belong to any of them, it wants `withCurrentUserScope`.

### Two ways the database says no, and they look nothing alike

Both bite when adding a table:

- **A policy is not a grant.** A `FOR ALL` policy with no `GRANT` to
  `authenticated` fails as `permission denied for table`, which reads as a
  connection problem and sends you to the wrong file.
- **A grant is not a policy.** Full privileges with a SELECT-only policy means
  every INSERT and UPDATE affects **zero rows, silently** — an RLS-filtered
  write is not an error. The screen looks like it worked.

`src/db/rls.test.ts` asserts both directions against a real Postgres. Run it
with `npm run db:test:up` then `npm test`; it skips when the container is down.

### Running the app against the throwaway database

The seed is deterministic, so seeded user ids match production and real Supabase
auth resolves against local data:

```
npm run db:test:up
DATABASE_URL=postgres://postgres:dealertech@localhost:54329/dealertech_test npx tsx src/db/seed/index.ts
DATABASE_URL=postgres://postgres:dealertech@localhost:54329/dealertech_test npm run dev
```

This is the only safe way to exercise a write path end to end, because
`.env.local` points at production.
