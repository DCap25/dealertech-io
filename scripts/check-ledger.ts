import postgres from 'postgres'

/**
 * What the database actually has, versus what the migrations folder claims.
 *
 * A read-only sanity check, written when a mistyped flag made it unclear
 * whether a migration run had touched production. Answers a handful of
 * questions and changes nothing.
 *
 * The RLS section is the one worth keeping: `npm run verify:rls` proves the
 * policies behave, and this proves they are switched on in the first place —
 * a table with a beautiful policy and RLS disabled is wide open.
 */
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
  try {
    const rows = await sql`SELECT filename FROM _applied_migrations ORDER BY filename DESC LIMIT 3`
    console.log('LEDGER HEAD:', rows.map((r) => r.filename).join(', '))

    const orgs = await sql`
      SELECT lifecycle_status, count(*)::int AS n FROM organizations GROUP BY lifecycle_status
    `
    console.log('TENANTS:', orgs.map((o) => `${o.lifecycle_status}=${o.n}`).join(', '))

    const rls = await sql`
      SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p
              WHERE p.tablename = c.relname AND p.schemaname = 'public') AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('billing_accounts','subscriptions','subscription_changes',
                          'lifecycle_events','stripe_events','onboarding_steps')
      ORDER BY c.relname
    `
    console.log('RLS ON THE NEW TABLES:')
    for (const r of rls) {
      const ok = r.enabled && r.forced && Number(r.policies) > 0
      console.log(
        `  ${ok ? 'OK  ' : 'BAD '} ${r.table_name}: enabled=${r.enabled} forced=${r.forced} policies=${r.policies}`,
      )
    }

    const fn = await sql`
      SELECT prosrc LIKE '%expires_at%' AS aware
      FROM pg_proc WHERE proname = 'current_user_store_ids'
    `
    console.log('current_user_store_ids honours expiry:', fn[0]?.aware ? 'YES' : 'NO')
  } finally {
    await sql.end()
  }
}

main()
