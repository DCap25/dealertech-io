/**
 * Give every seeded staff member a Supabase auth login.
 *
 * The auth user is created with the SAME uuid as the `public.users` row. That
 * is load-bearing: every RLS policy resolves a tenant through
 * `user_store_roles.user_id = auth.uid()`, so an auth id that does not match
 * the application row would authenticate a user who can see nothing.
 *
 * Idempotent — safe to re-run after a re-seed. Demo passwords only; these are
 * `.test` addresses for a fictional dealership.
 *
 *   npm run auth:provision
 *
 * After a re-seed the application ids change if they were ever random, which
 * leaves the existing auth users pointing at nothing. Re-link them with:
 *
 *   npm run auth:provision -- --repair
 *
 * Repair deletes and recreates the mismatched account, so it is opt-in rather
 * than the default — this script should never silently delete a login.
 */
import { createClient } from '@supabase/supabase-js'
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client'

/**
 * The shared demo password.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEFAULT IS REFUSED OUTSIDE LOCAL WORK
 * ---------------------------------------------------------------------------
 * This default is committed to the repository, which is fine for a throwaway
 * container and not fine anywhere a real person can reach. It has already
 * ended up on the live Supabase project once: six accounts with active store
 * roles at the demo dealership, all sharing a password that anybody reading
 * this file knows.
 *
 * So the constant is only usable against a local database. Point this at
 * anything else and it insists on being told a password, which is the moment
 * somebody has to think about what they are creating.
 */
const DEFAULT_DEMO_PASSWORD = 'dealertech-demo'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD
const REPAIR = process.argv.includes('--repair')

/** localhost and 127.0.0.1 only — anything else is somebody's real project. */
function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false
  return /@(localhost|127\.0\.0\.1)[:/]/.test(url)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
    process.exit(1)
  }

  if (DEMO_PASSWORD === DEFAULT_DEMO_PASSWORD && !isLocalDatabase(process.env.DATABASE_URL)) {
    console.error(
      'Refusing to create accounts with the committed demo password against a non-local database.\n' +
      'That password is in the repository, so every account made with it is public.\n\n' +
      '  DEMO_PASSWORD="$(openssl rand -base64 24)" npm run auth:provision\n\n' +
      'Print it, put it somewhere shared, and do not commit it.',
    )
    process.exit(1)
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const db = getDb()
  const rows = (await db.execute(sql`
    select u.id, u.email, u.full_name, usr.role
    from users u
    join user_store_roles usr on usr.user_id = u.id and usr.is_active = true
    order by u.full_name
  `)) as unknown as { id: string; email: string; full_name: string | null; role: string }[]

  if (rows.length === 0) {
    console.error('No seeded users found. Run `npm run db:seed` first.')
    process.exit(1)
  }

  const { data: existingList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existingByEmail = new Map(
    (existingList?.users ?? []).map((u) => [u.email?.toLowerCase() ?? '', u]),
  )

  for (const row of rows) {
    const email = row.email.toLowerCase()
    const existing = existingByEmail.get(email)

    if (existing) {
      if (existing.id === row.id) {
        console.log(`ok       ${email} (${row.role})`)
      } else if (REPAIR) {
        const { error: delError } = await admin.auth.admin.deleteUser(existing.id)
        if (delError) {
          console.error(`FAILED   ${email}: could not remove stale account — ${delError.message}`)
          continue
        }
        console.log(`repaired ${email} — stale auth id removed`)
        // Fall through to recreate with the correct id.
      } else {
        // A mismatched id is worse than no user at all: they authenticate and
        // then every tenant-scoped query returns nothing.
        console.warn(
          `MISMATCH ${email} — auth id ${existing.id} != app id ${row.id}. ` +
            'Re-run with `npm run auth:provision -- --repair` to re-link it.',
        )
        continue
      }
      if (!REPAIR) continue
    }

    const { error } = await admin.auth.admin.createUser({
      id: row.id,
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: row.full_name, role: row.role },
    })

    if (error) {
      console.error(`FAILED   ${email}: ${error.message}`)
    } else {
      console.log(`created  ${email} (${row.role})`)
    }
  }

  console.log(`\nPassword for every demo account: ${DEMO_PASSWORD}`)
  process.exit(0)
}

void main()
