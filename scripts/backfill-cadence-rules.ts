/**
 * Give the follow-up rules to dealerships that were stood up without them.
 *
 *   npm run cadence:backfill            # lists what it would do, writes nothing
 *   npm run cadence:backfill -- --apply # writes
 *
 * ===========================================================================
 * WHAT WENT WRONG, AND WHO IT HAPPENED TO
 * ===========================================================================
 * `generateTasks` produces nothing without cadence rules, and until 2026-08-20
 * nothing outside the demo seed ever created one. So a dealership provisioned
 * before that date has an empty follow-up worklist, would have an empty
 * worklist a year later, and its own screen says "nothing to work" rather than
 * "nobody has set this up" — which is indistinguishable from the product
 * having looked and found nothing. It is the quietest kind of broken.
 *
 * `createStoreOn` now inserts `DEFAULT_CADENCE_RULES` inside the provisioning
 * transaction, so every new tenant is fine and this is a one-off for the ones
 * that came before. The tenant page carries the same fact per rooftop on its
 * go-live checklist, so the gap is visible without running anything.
 *
 * ===========================================================================
 * WHY IT LISTS BEFORE IT WRITES, AND WHY THERE IS NO BUTTON
 * ===========================================================================
 * `.env.local` points at production: a local write is a live write, into other
 * people's dealerships. So the default is a report. `--apply` is the only way
 * to make it write, and it is read before a connection is opened, so a
 * mistyped invocation cannot half-run.
 *
 * A console button was the obvious alternative and is worse. It cannot show
 * you what it is about to do first, and it would sit on a page that also has a
 * suspend button on it.
 *
 * ===========================================================================
 * IT SKIPS ANY STORE THAT HAS RULES AT ALL
 * ===========================================================================
 * Not "any active rules" — any rules. A dealership that has switched all eight
 * of theirs off has made a decision, and re-inserting the set we shipped would
 * silently overrule it. The only stores this touches are ones whose table is
 * genuinely empty, where there is no decision to overrule.
 *
 * Each rooftop is written in its own transaction, re-checking the count inside
 * it: a run that fails on the fortieth leaves the first thirty-nine done and
 * correct rather than discarding an hour of work, and re-running finishes the
 * job because the ones already done no longer qualify.
 *
 * Runs privileged, like every script here — it owns the schema and there is no
 * user to scope to. See the table in src/db/README.md.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { DEFAULT_CADENCE_RULES, defaultCadenceRulesFor } from '@/lib/cadence/defaults'

const APPLY = process.argv.includes('--apply')

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run through npm so --env-file=.env.local applies.')
    process.exit(1)
  }

  const db = getDb()

  /*
    Left join and count, rather than a NOT EXISTS in raw SQL, so the rooftops
    that already have rules can be reported as a total instead of silently
    vanishing from the output. "12 rooftops, 3 need this" is a more useful
    first line than a list of three.
  */
  const rooftops = await db
    .select({
      storeId: schema.stores.id,
      storeName: schema.stores.name,
      organizationName: schema.organizations.name,
      createdAt: schema.stores.createdAt,
      ruleCount: sql<number>`(
        SELECT count(*)::int FROM cadence_rules r WHERE r.store_id = ${schema.stores.id}
      )`,
    })
    .from(schema.stores)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.stores.organizationId))
    .orderBy(schema.stores.createdAt)

  const candidates = rooftops.filter((r) => r.ruleCount === 0)

  console.log(`${rooftops.length} rooftop(s) on the platform, ${candidates.length} with no follow-up rules.`)

  if (candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log('')
  for (const c of candidates) {
    console.log(
      `  ${c.storeName.padEnd(32)} ${c.organizationName.padEnd(28)} `
      + `created ${c.createdAt.toISOString().slice(0, 10)}`,
    )
  }

  if (!APPLY) {
    console.log(
      `\nDry run — nothing was written. Re-run with --apply to insert `
      + `${DEFAULT_CADENCE_RULES.length} rules into each of the ${candidates.length} rooftop(s) above.`,
    )
    return
  }

  console.log(`\nWriting ${DEFAULT_CADENCE_RULES.length} rules per rooftop.\n`)
  let written = 0
  let skipped = 0

  for (const c of candidates) {
    /*
      Re-checked inside the transaction.

      The scan above was taken before the first write, and on a long run
      somebody could have configured a store in the meantime. Overwriting
      their choice is the one outcome this script must never produce.
    */
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.cadenceRules)
        .where(eq(schema.cadenceRules.storeId, c.storeId))

      if ((existing?.n ?? 0) > 0) {
        console.log(`  skipped ${c.storeName} — ${existing?.n} rule(s) appeared since the scan`)
        skipped += 1
        return
      }

      // The same call `createStoreOn` makes, so a backfilled rooftop and a
      // freshly provisioned one are identical. Column defaults come from the
      // schema rather than being restated here.
      await tx.insert(schema.cadenceRules).values(defaultCadenceRulesFor(c.storeId))
      console.log(`  ${c.storeName}`)
      written += 1
    })
  }

  console.log(`\nDone. ${written} rooftop(s) backfilled${skipped > 0 ? `, ${skipped} skipped` : ''}.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
