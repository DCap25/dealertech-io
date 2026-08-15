/**
 * Create a DealerTech staff account.
 *
 *   npm run platform:create -- admin@dealertech.io 'a-long-password'
 *
 * Deliberately creates NO dealership role. Platform staff hold the operational
 * view — tenants, leads, job health — and nothing on any dealership's
 * customers; giving them a store role here would quietly hand them exactly what
 * migration 0016 exists to withhold.
 *
 * Idempotent on the account: an existing address is granted platform access
 * rather than failing, so this doubles as "promote the person who already
 * signed up".
 */
import { createClient } from '@supabase/supabase-js'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../src/db/client'

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    console.error("Usage: create-platform-admin.ts <email> <password>")
    process.exit(1)
  }
  if (password.length < 10) {
    console.error('Use at least 10 characters — the same floor the product enforces on signup.')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
    process.exit(1)
  }

  const auth = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin
  const db = getDb()
  const normalised = email.trim().toLowerCase()

  // Already ours?
  const [existing] = await db.select({ id: schema.users.id })
    .from(schema.users).where(eq(schema.users.email, normalised)).limit(1)

  let userId = existing?.id

  if (!userId) {
    const created = await auth.createUser({
      email: normalised,
      password,
      // No confirmation email to chase: whoever ran this has the database
      // credentials, which is a stronger proof than a mailbox.
      email_confirm: true,
      user_metadata: { full_name: normalised },
    })
    if (created.error || !created.data.user) {
      console.error(`Could not create the auth account: ${created.error?.message ?? 'unknown'}`)
      process.exit(1)
    }
    userId = created.data.user.id

    /*
      The application row carries the SAME uuid as the auth user.

      Load-bearing: every policy resolves identity through auth.uid(), so a
      mismatched id authenticates somebody who can see nothing at all.
    */
    await db.insert(schema.users).values({
      id: userId, email: normalised, fullName: normalised,
    })
    console.log(`Created account ${normalised}.`)
  } else {
    console.log(`${normalised} already has an account — granting platform access to it.`)
  }

  const [already] = await db.select({ id: schema.platformAdmins.id })
    .from(schema.platformAdmins)
    .where(and(
      eq(schema.platformAdmins.userId, userId),
      isNull(schema.platformAdmins.revokedAt),
    ))
    .limit(1)

  if (already) {
    console.log('Platform access was already active.')
  } else {
    await db.insert(schema.platformAdmins).values({
      userId, note: 'Created via create-platform-admin.ts',
    })
    console.log('Granted platform access.')
  }

  console.log('\nSign in and you will land on /admin — this account has no dealership role,')
  console.log('so it can see tenants, leads and job health, and no customer data anywhere.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
