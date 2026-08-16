/**
 * Rotate one account's password, in place.
 *
 * ---------------------------------------------------------------------------
 * WHY `platform:create` DOES NOT DO THIS, DESPITE LOOKING LIKE IT SHOULD
 * ---------------------------------------------------------------------------
 * `create-platform-admin.ts` takes a password argument and is idempotent on
 * the account — which sounds like a rotation and is not. Its branch is:
 *
 *     if the account does not exist:  create it with this password
 *     otherwise:                      ensure the platform grant, and stop
 *
 * On the second path the password argument is never used. So running it
 * against an existing address prints "already has an account — granting
 * platform access", exits 0, and changes nothing about how they sign in. The
 * old password keeps working and nothing says so.
 *
 * That is the same shape as the trap already documented for
 * `auth:provision --repair`, which PROJECT_OVERVIEW.md warns about in exactly
 * these terms. This is the second script to wear the disguise, so it gets the
 * same answer the demo accounts got: changing a password should change a
 * password.
 *
 *   npm run platform:rotate -- admindan@dealertech.io
 *   npm run platform:rotate -- admindan@dealertech.io 'a-password-you-chose'
 *
 * Works for any account, not only platform staff — an account is an account.
 * It is named for the case it exists to serve.
 */
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../src/db/client'

/** Readable enough to type off a screen, long enough not to be guessed. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2)
  if (!emailArg) {
    console.error("Usage: npm run platform:rotate -- <email> [password]")
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
    process.exit(1)
  }

  const password = passwordArg ?? generatePassword()
  if (password.length < 12) {
    console.error('Use at least 12 characters.')
    process.exit(1)
  }

  const email = emailArg.trim().toLowerCase()
  const db = getDb()

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (!user) {
    /*
      Refused rather than created.

      A typo in an address would otherwise silently stand up a brand-new
      account with platform-shaped intent behind it, and leave the real one on
      its old password — the exact failure this script exists to fix, with an
      extra account to clean up. Use platform:create deliberately for a new
      person.
    */
    console.error(`No account with the address ${email}.`)
    console.error('Check the spelling, or use `npm run platform:create` if this is a new person.')
    process.exit(1)
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  /*
    In place, by id. The uuid is load-bearing — every row-level-security policy
    resolves identity through `auth.uid()` — so it has to survive a password
    change untouched. Deleting and recreating the account, which is what
    `auth:provision --repair` does, would rebuild every session, identity and
    audit reference for no reason and leave a window with no login at all.
  */
  const { error } = await admin.auth.admin.updateUserById(user.id, { password })
  if (error) {
    console.error(`Could not rotate ${email}: ${error.message}`)
    process.exit(1)
  }

  console.log('─'.repeat(58))
  console.log(`Rotated ${email}.\n`)
  console.log(`    ${password}\n`)
  console.log('Put it in a password manager now. It is not stored anywhere else —')
  console.log('the database holds only a hash — and it cannot be recovered.')
  console.log('')
  console.log('Every existing session for this account keeps working until it')
  console.log('expires; Supabase does not revoke tokens on a password change.')
  console.log('Sign out everywhere from the Supabase dashboard if that matters.')
  console.log('─'.repeat(58))
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
