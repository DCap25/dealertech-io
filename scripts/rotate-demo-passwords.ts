/**
 * Rotate the shared demo-staff password.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN A FLAG ON auth:provision
 * ---------------------------------------------------------------------------
 * `auth:provision --repair` looks like it would do this and does not. Repair
 * only fires when an auth id does not match the application row, which is a
 * different fault — a login that authenticates and then sees nothing. When the
 * ids line up, and they do, it prints `ok` and changes no password at all.
 *
 * It also deletes and recreates the account it repairs. That is the right
 * answer for a mismatched id and the wrong one for a rotation: there is a
 * window with no login, and every session, identity and audit reference is
 * rebuilt for no reason. Changing a password should change a password.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT TOUCHES
 * ---------------------------------------------------------------------------
 * Only the seeded demo staff — the fictional dealership's `.test` addresses.
 * Real accounts and platform admins are left alone; rotating somebody's actual
 * password because they were in the same table is not this script's business.
 *
 *   npm run demo:rotate                  generate one and print it
 *   DEMO_PASSWORD="..." npm run demo:rotate    use a specific one
 */
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client'

/** The fictional dealership. Real staff do not have addresses here. */
const DEMO_DOMAIN = '.test'
const COMMITTED_DEFAULT = 'dealertech-demo'

/**
 * Readable enough to be typed off a screen during a demo, long enough not to
 * be guessed. base64url so there is nothing a shell or a URL will mangle.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
    process.exit(1)
  }

  const password = process.env.DEMO_PASSWORD ?? generatePassword()
  if (password === COMMITTED_DEFAULT) {
    console.error('That is the password in the repository. Rotating to it is not a rotation.')
    process.exit(1)
  }
  if (password.length < 12) {
    console.error('Use at least 12 characters.')
    process.exit(1)
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const rows = (await getDb().execute(sql`
    select u.id, u.email from users u where u.email like ${'%' + DEMO_DOMAIN}
    order by u.email
  `)) as unknown as { id: string; email: string }[]

  if (rows.length === 0) {
    console.error(`No accounts ending in ${DEMO_DOMAIN} found. Nothing to rotate.`)
    process.exit(1)
  }

  console.log(`Rotating ${rows.length} demo account${rows.length === 1 ? '' : 's'}:\n`)

  let failed = 0
  for (const row of rows) {
    // In place. The id is load-bearing — every RLS policy resolves a tenant
    // through it — so it must survive a password change untouched.
    const { error } = await admin.auth.admin.updateUserById(row.id, { password })
    if (error) {
      console.error(`  FAILED  ${row.email} — ${error.message}`)
      failed += 1
    } else {
      console.log(`  rotated ${row.email}`)
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} failed. The others are on the new password; re-run to finish.`)
    process.exit(1)
  }

  console.log('\n' + '─'.repeat(58))
  console.log('New password for every demo account:\n')
  console.log(`    ${password}\n`)
  console.log('Put it in a password manager. It is not stored anywhere else,')
  console.log('and it must not be committed.')
  console.log('')
  /*
    The one thing a rotation silently breaks.

    /tour signs a prospect into these same accounts using DEMO_TOUR_PASSWORD,
    so a rotation that stops there leaves the gated tour refusing every valid
    code — and the failure surfaces in front of a prospect, which is the worst
    possible place to discover it. Printed rather than left to a doc nobody
    reads at the moment of rotating.
  */
  console.log('ALSO UPDATE DEMO_TOUR_PASSWORD — in .env.local and on Netlify.')
  console.log('The gated demo tour at /tour signs into these accounts and will')
  console.log('refuse every valid code until it matches.')
  console.log('─'.repeat(58))
}

void main()
