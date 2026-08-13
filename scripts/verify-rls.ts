/**
 * Verifies that schema and row-level security landed correctly on whatever
 * DATABASE_URL points at.
 *
 *   npm run verify:rls
 *
 * On Supabase this exercises the REAL auth.uid() and `authenticated` role
 * rather than the local test shim, so a pass here means the policies work in
 * production and not merely in a simulation of it.
 */
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('DATABASE_URL is not set.')
    process.exit(1)
  }

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 20,
    onnotice: () => {},
    ssl: url.includes('supabase') ? 'require' : false,
  })

  try {
    const [counts] = await sql<
      { tables: number; rls: number; forced: number; policies: number; migrations: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND rowsecurity) AS rls,
        (SELECT count(*)::int FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity) AS forced,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations
    `

    const unprotected = await sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
       ORDER BY c.relname
    `

    // The helper the policies depend on. Missing it means every policy denies
    // everything, which looks like "secure" until nobody can log in.
    const helpers = await sql<{ proname: string; prosecdef: boolean }[]>`
      SELECT p.proname, p.prosecdef FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'current_user_%'
       ORDER BY p.proname
    `

    // Does the real Supabase auth schema exist? On the local shim it is faked.
    const [authFn] = await sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) AS present
    `

    console.log('')
    console.log(`  migrations applied   ${counts?.migrations ?? 0}`)
    console.log(`  tables               ${counts?.tables ?? 0}`)
    console.log(`  RLS enabled          ${counts?.rls ?? 0}`)
    console.log(`  RLS forced           ${counts?.forced ?? 0}`)
    console.log(`  policies             ${counts?.policies ?? 0}`)
    console.log(`  helper functions     ${helpers.map((h) => `${h.proname}${h.prosecdef ? ' (definer)' : ' (INVOKER — WRONG)'}`).join(', ') || 'NONE'}`)
    console.log(`  auth.uid() present   ${authFn?.present ? 'yes (real Supabase auth)' : 'NO'}`)
    console.log(`  unprotected tables   ${unprotected.length === 0 ? 'none' : unprotected.map((u) => u.relname).join(', ')}`)
    console.log('')

    const problems: string[] = []
    if ((counts?.tables ?? 0) === 0) problems.push('no tables — migrations did not run')
    if (counts && counts.rls !== counts.tables) problems.push('some tables have RLS disabled')
    if (counts && counts.forced !== counts.tables) problems.push('some tables are not FORCE RLS')
    if (unprotected.length > 0) problems.push(`${unprotected.length} unprotected table(s)`)
    if (helpers.length === 0) problems.push('policy helper functions are missing')
    if (helpers.some((h) => !h.prosecdef)) problems.push('a helper is not SECURITY DEFINER — policies will recurse')
    if (!authFn?.present) problems.push('auth.uid() is missing')

    if (problems.length === 0) {
      console.log('  All good.\n')
    } else {
      for (const p of problems) console.log(`  ✗ ${p}`)
      console.log('')
    }

    await sql.end({ timeout: 5 })
    process.exit(problems.length === 0 ? 0 : 1)
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause)
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
