/**
 * Grant or revoke DealerTech platform access.
 *
 *   npm run platform:grant  -- someone@dealertech.io
 *   npm run platform:revoke -- someone@dealertech.io
 *   npm run platform:list
 *
 * Deliberately a CLI and not a screen. The first platform admin has to come
 * from somewhere outside the product, and an in-app "make me an admin" button
 * is the kind of thing that is safe right up until it is not. Granting access
 * to the operational console should require a shell on the machine that holds
 * the database credentials.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'

async function main() {
  const [action, emailArg] = process.argv.slice(2)
  const db = getDb()

  if (action === 'list') {
    const rows = await db
      .select({
        email: schema.users.email,
        name: schema.users.fullName,
        grantedAt: schema.platformAdmins.grantedAt,
        revokedAt: schema.platformAdmins.revokedAt,
      })
      .from(schema.platformAdmins)
      .innerJoin(schema.users, eq(schema.users.id, schema.platformAdmins.userId))
      .orderBy(desc(schema.platformAdmins.grantedAt))

    if (rows.length === 0) {
      console.log('Nobody has platform access.')
    } else {
      for (const r of rows) {
        const state = r.revokedAt ? `revoked ${r.revokedAt.toISOString().slice(0, 10)}` : 'active'
        console.log(`  ${r.email.padEnd(34)} ${state}`)
      }
    }
    process.exit(0)
  }

  const email = (emailArg ?? '').trim().toLowerCase()
  if (!email || (action !== 'grant' && action !== 'revoke')) {
    console.error('Usage: platform-admin.ts <grant|revoke|list> [email]')
    process.exit(1)
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (!user) {
    // Naming the constraint rather than just failing: platform access hangs
    // off a real account, so the account has to exist first.
    console.error(`No account for ${email}. They need to sign in once before they can be granted access.`)
    process.exit(1)
  }

  if (action === 'grant') {
    const existing = await db
      .select({ id: schema.platformAdmins.id })
      .from(schema.platformAdmins)
      .where(and(
        eq(schema.platformAdmins.userId, user.id),
        isNull(schema.platformAdmins.revokedAt),
      ))
      .limit(1)

    if (existing[0]) {
      console.log(`${email} already has platform access.`)
      process.exit(0)
    }

    await db.insert(schema.platformAdmins).values({ userId: user.id })
    console.log(`Granted platform access to ${email}.`)
  } else {
    await db.update(schema.platformAdmins)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(schema.platformAdmins.userId, user.id),
        isNull(schema.platformAdmins.revokedAt),
      ))
    console.log(`Revoked platform access for ${email}.`)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
