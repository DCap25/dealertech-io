/**
 * Nightly cadence run, invoked manually during development.
 *   npx tsx scripts/run-cadence.ts
 *
 * Idempotent — running it twice on the same day produces nothing the second
 * time, because the cooldown check sees what the first run wrote.
 */
import { runCadence } from '@/lib/cadence/run'
import { getDb, schema } from '@/db/client'
import { demoNow } from '@/lib/demo-day'

async function main() {
  const db = getDb()
  const [store] = await db.select().from(schema.stores).limit(1)
  if (!store) {
    console.error('No store found. Run npm run db:seed first.')
    process.exit(1)
  }

  // The seeded dealership lives on a fixed date so results are reproducible.
  const asOf = process.env.CADENCE_AS_OF ? new Date(process.env.CADENCE_AS_OF) : demoNow()

  const result = await runCadence(store.id, asOf, 7)
  console.log(`Cadence run for ${store.name} as of ${asOf.toISOString().slice(0, 10)}`)
  console.log(`  customers evaluated  ${result.customersEvaluated}`)
  console.log(`  tasks created        ${result.tasksCreated}`)
  for (const [trigger, count] of Object.entries(result.byTrigger).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${trigger.padEnd(28)} ${count}`)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
