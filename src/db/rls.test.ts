import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

/**
 * Tenant isolation tests.
 *
 * These run against a real Postgres with the REAL policies from
 * 0001_rls_policies.sql applied. Only the Supabase identity plumbing is
 * simulated (see test/local-auth-shim.sql), so a pass here means something.
 *
 * Start the database with:
 *   docker run -d --name dealertech-test-db -e POSTGRES_PASSWORD=dealertech \
 *     -e POSTGRES_DB=dealertech_test -p 54329:5432 postgres:16-alpine
 *   npm run db:test:setup
 *
 * Seeding runs as the `postgres` superuser, which bypasses RLS. Every
 * assertion runs as `authenticated`, which does not.
 */

/**
 * A dedicated database, NOT the seeded demo one. These tests wipe every table,
 * and the seeded data's foreign keys made a partial cleanup impossible anyway.
 */
const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:dealertech@localhost:54329/dealertech_rls'

let sql: postgres.Sql
let reachable = false

// Two rooftops that must never see each other.
const storeA = randomUUID()
const storeB = randomUUID()
const orgA = randomUUID()
const orgB = randomUUID()
const advisorA = randomUUID()
const advisorB = randomUUID()
/** Authenticated, but assigned to no store at all. */
const orphanUser = randomUUID()
const customerA = randomUUID()
const customerB = randomUUID()
const vehicleA = randomUUID()
const vehicleB = randomUUID()

try {
  sql = postgres(TEST_URL, { max: 2, connect_timeout: 5, onnotice: () => {} })
  await sql`SELECT 1`
  reachable = true
} catch {
  reachable = false
}

/** Runs a callback as an authenticated user, exactly as a request would. */
async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`
    await tx`SET LOCAL ROLE authenticated`
    return fn(tx as postgres.TransactionSql)
  }) as Promise<T>
}

describe.skipIf(!reachable)('row-level security — tenant isolation', () => {
  beforeAll(async () => {
    // Clean slate as superuser (bypasses RLS). TRUNCATE ... CASCADE rather
    // than ordered DELETEs so foreign keys can never dictate the order.
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `
    const list = tables.map((t) => `public."${t.tablename}"`).join(', ')
    await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)

    await sql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Group A', 'group-a'), (${orgB}, 'Group B', 'group-b')`

    await sql`INSERT INTO stores (id, organization_id, name, slug, state) VALUES
      (${storeA}, ${orgA}, 'Rooftop A', 'rooftop-a', 'TX'),
      (${storeB}, ${orgB}, 'Rooftop B', 'rooftop-b', 'CA')`

    await sql`INSERT INTO users (id, email, full_name) VALUES
      (${advisorA}, 'a@example.com', 'Advisor A'),
      (${advisorB}, 'b@example.com', 'Advisor B'),
      (${orphanUser}, 'orphan@example.com', 'No Store')`

    await sql`INSERT INTO user_store_roles (user_id, store_id, role) VALUES
      (${advisorA}, ${storeA}, 'ADVISOR'),
      (${advisorB}, ${storeB}, 'ADVISOR')`

    await sql`INSERT INTO customers (id, store_id, first_name, last_name, mobile_phone) VALUES
      (${customerA}, ${storeA}, 'Alice', 'Anderson', '5550000001'),
      (${customerB}, ${storeB}, 'Bob', 'Baker', '5550000002')`

    await sql`INSERT INTO vehicles (id, store_id, vin, make, model, model_year) VALUES
      (${vehicleA}, ${storeA}, '1FTFW1ET9DFC10312', 'FORD', 'F-150', 2013),
      (${vehicleB}, ${storeB}, '5YJ3E1EA7KF317806', 'TESLA', 'Model 3', 2019)`

    // Shared catalogue row (null store) plus one owned by store B.
    await sql`INSERT INTO contract_products (store_id, admin_company, product_type, product_name) VALUES
      (NULL, 'Zurich', 'VSC', 'Shared Catalogue Entry'),
      (${storeB}, 'Endurance', 'VSC', 'Store B Private Entry')`
  })

  afterAll(async () => {
    if (reachable) await sql.end({ timeout: 5 })
  })

  // ------------------------------------------------------------- reads
  it('lets an advisor read their own store customers', async () => {
    const rows = await asUser(advisorA, (tx) => tx`SELECT id FROM customers`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(customerA)
  })

  it('HIDES the other rooftop customers entirely', async () => {
    const rows = await asUser(advisorA, (tx) => tx`SELECT id FROM customers`)
    expect(rows.map((r) => r.id)).not.toContain(customerB)
  })

  it('returns nothing when targeting another store row by primary key', async () => {
    // Even knowing the exact UUID must not help.
    const rows = await asUser(advisorA, (tx) => tx`SELECT id FROM customers WHERE id = ${customerB}`)
    expect(rows).toHaveLength(0)
  })

  it('isolates vehicles the same way', async () => {
    const a = await asUser(advisorA, (tx) => tx`SELECT vin FROM vehicles`)
    const b = await asUser(advisorB, (tx) => tx`SELECT vin FROM vehicles`)
    expect(a.map((r) => r.vin)).toEqual(['1FTFW1ET9DFC10312'])
    expect(b.map((r) => r.vin)).toEqual(['5YJ3E1EA7KF317806'])
  })

  it('shows a user with no store assignment absolutely nothing', async () => {
    const rows = await asUser(orphanUser, (tx) => tx`SELECT id FROM customers`)
    expect(rows).toHaveLength(0)
  })

  // ------------------------------------------------------------ writes
  it('refuses to INSERT a row into another store', async () => {
    // WITH CHECK must block writing across the boundary, not merely reading.
    await expect(
      asUser(advisorA, (tx) =>
        tx`INSERT INTO customers (store_id, first_name) VALUES (${storeB}, 'Injected')`,
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('silently affects no rows when UPDATING another store', async () => {
    await asUser(advisorA, (tx) =>
      tx`UPDATE customers SET first_name = 'Hacked' WHERE id = ${customerB}`,
    )
    const [row] = await sql`SELECT first_name FROM customers WHERE id = ${customerB}`
    expect(row?.first_name).toBe('Bob')
  })

  it('silently affects no rows when DELETING another store', async () => {
    await asUser(advisorA, (tx) => tx`DELETE FROM customers WHERE id = ${customerB}`)
    const rows = await sql`SELECT id FROM customers WHERE id = ${customerB}`
    expect(rows).toHaveLength(1)
  })

  it('allows a legitimate write to the advisor own store', async () => {
    const id = randomUUID()
    await asUser(advisorA, (tx) =>
      tx`INSERT INTO customers (id, store_id, first_name) VALUES (${id}, ${storeA}, 'Legit')`,
    )
    const rows = await sql`SELECT id FROM customers WHERE id = ${id}`
    expect(rows).toHaveLength(1)
    await sql`DELETE FROM customers WHERE id = ${id}`
  })

  // ------------------------------------------------------- stores & users
  it('scopes visible stores to the ones the user works at', async () => {
    const rows = await asUser(advisorA, (tx) => tx`SELECT id FROM stores`)
    expect(rows.map((r) => r.id)).toEqual([storeA])
  })

  it('hides colleagues at unrelated rooftops', async () => {
    const rows = await asUser(advisorA, (tx) => tx`SELECT id FROM users`)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(advisorA)
    expect(ids).not.toContain(advisorB)
    expect(ids).not.toContain(orphanUser)
  })

  it('prevents a user granting themselves a role at another store', async () => {
    await expect(
      asUser(advisorA, (tx) =>
        tx`INSERT INTO user_store_roles (user_id, store_id, role)
           VALUES (${advisorA}, ${storeB}, 'ADMIN')`,
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  // -------------------------------------------------- shared reference data
  it('shares NULL-store catalogue rows with every tenant', async () => {
    const a = await asUser(advisorA, (tx) => tx`SELECT product_name FROM contract_products`)
    const names = a.map((r) => r.product_name)
    expect(names).toContain('Shared Catalogue Entry')
    // …but a private row belonging to store B stays private.
    expect(names).not.toContain('Store B Private Entry')
  })

  it('stops a tenant editing the shared catalogue', async () => {
    await expect(
      asUser(advisorA, (tx) =>
        tx`INSERT INTO contract_products (store_id, admin_company, product_type, product_name)
           VALUES (NULL, 'Rogue', 'VSC', 'Global Injection')`,
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  // ------------------------------------------------------------ audit log
  it('keeps the audit log append-only', async () => {
    const id = randomUUID()
    await asUser(advisorA, (tx) =>
      tx`INSERT INTO audit_log (id, store_id, user_id, action, entity_type)
         VALUES (${id}, ${storeA}, ${advisorA}, 'VIEW', 'customers')`,
    )
    // No UPDATE or DELETE policy exists, so both are denied by default and
    // affect zero rows rather than raising.
    await asUser(advisorA, (tx) => tx`UPDATE audit_log SET action = 'TAMPERED' WHERE id = ${id}`)
    await asUser(advisorA, (tx) => tx`DELETE FROM audit_log WHERE id = ${id}`)

    const [row] = await sql`SELECT action FROM audit_log WHERE id = ${id}`
    expect(row?.action).toBe('VIEW')
  })

  // ------------------------------------------------------------- anon role
  it('gives the anonymous role no access to customer data', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`
        return tx`SELECT id FROM customers`
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  // ------------------------------------------------ every table is protected
  it('leaves no table in the public schema without RLS forced', async () => {
    const rows = await sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        -- The migration ledger, excluded here for the same reason 0014
        -- excludes it: it is infrastructure with no store_id to write a policy
        -- against, so it carries RLS with no policy at all — which denies
        -- everything — and is deliberately NOT forced, because the migration
        -- runner owns the table and has to write to it.
        AND c.relname <> '_applied_migrations'
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
    `
    expect(rows.map((r) => r.table_name)).toEqual([])
  })

  it('denies the ledger to a signed-in user despite not forcing it', async () => {
    /*
      The exception above is only safe if something else closes the gap, so it
      is asserted rather than assumed — "not forced" is otherwise
      indistinguishable from "not protected".

      It turns out to be shut harder than RLS alone would manage: the table was
      never granted to `authenticated` at all, so this is refused at the
      privilege layer before any policy is consulted. Worth pinning, because a
      future migration that grants the role a blanket SELECT would move the
      answer from "denied" to "allowed and unfiltered" in one step.
    */
    await expect(
      asUser(advisorA, (tx) => tx`SELECT filename FROM _applied_migrations`),
    ).rejects.toThrow(/permission denied/i)
  })

  it('gives every store-scoped table an isolation policy', async () => {
    const rows = await sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'store_id'
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname)
    `
    expect(rows.map((r) => r.table_name)).toEqual([])
  })
})
