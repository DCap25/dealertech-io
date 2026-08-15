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
        -- The ledger that db:apply actually writes. This used to read drizzle's
        -- own table, which stopped being updated when hand-written migrations
        -- replaced db:push, so it reported 7 while 14 had been applied.
        (SELECT count(*)::int FROM public._applied_migrations) AS migrations
    `

    /*
      The migration ledger is deliberately outside all of this.

      No tenant owns it and there is no store_id to write a policy against. It
      has RLS enabled with no policy — which denies every non-superuser — but
      NOT forced, because the migration runner has to write to it as the owner.
      Listing it as a problem on every run trains people to ignore the output.
    */
    const EXPECTED_UNFORCED = ['_applied_migrations']

    const unprotected = await sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
         AND c.relname <> ALL(${EXPECTED_UNFORCED})
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

    /*
      Does any of it actually bite?
      ------------------------------------------------------------------------
      Everything above proves the policies EXIST. That is not the same as
      proving they apply, and the difference is the whole point: the app
      connects as a role with BYPASSRLS, so for a long time all 48 policies were
      structurally perfect and completely inert.

      This runs the real thing. Become `authenticated`, present a real staff
      member's id, count what is visible; then present an id belonging to
      nobody and count again. If the second number is not zero, RLS is not
      protecting this database whatever the counters above say.
    */
    const enforcement = { real: -1, stranger: -1, ran: false }
    const [staff] = await sql<{ user_id: string }[]>`
      SELECT u.id AS user_id FROM users u
        JOIN user_store_roles r ON r.user_id = u.id AND r.is_active = true
       LIMIT 1
    `
    if (staff) {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claims',
          json_build_object('sub', ${staff.user_id}::text, 'role', 'authenticated')::text, true)`
        await tx`SET LOCAL ROLE authenticated`
        const [mine] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM customers`
        enforcement.real = mine?.n ?? -1

        await tx`SELECT set_config('request.jwt.claims',
          json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true)`
        const [none] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM customers`
        enforcement.stranger = none?.n ?? -1
      })
      enforcement.ran = true
    }

    console.log(`  enforcement check    ${
      !enforcement.ran
        ? 'skipped — no staff user to test with'
        : `a staff member sees ${enforcement.real} customers, a stranger sees ${enforcement.stranger}`
    }`)
    console.log('')

    const problems: string[] = []
    if (enforcement.ran && enforcement.stranger !== 0) {
      problems.push(`RLS is NOT enforcing — a stranger can read ${enforcement.stranger} customers`)
    }
    if (enforcement.ran && enforcement.real === 0) {
      problems.push('RLS denies a real staff member everything — the app would show empty pages')
    }
    if ((counts?.tables ?? 0) === 0) problems.push('no tables — migrations did not run')
    // Counted from the same query that names them, so the headline and the
    // list can never disagree about how many there are.
    if (unprotected.length > 0) {
      problems.push(`unprotected table(s): ${unprotected.map((u) => u.relname).join(', ')}`)
    }
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
