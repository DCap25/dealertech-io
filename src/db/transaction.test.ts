import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from './client'

/**
 * Do the write-side transactions actually roll back?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WORTH A TEST AND NOT AN ASSUMPTION
 * ---------------------------------------------------------------------------
 * The advisor and BDC actions were converted to `db.transaction(...)` on the
 * strength of "transactions roll back", which is true of Postgres and not
 * automatically true of the way this application reaches it. The client runs
 * with `prepare: false` and `max: 1` through a connection pooler, because that
 * is what a serverless deployment needs — and a pooler in transaction mode is
 * exactly the component that has historically turned a multi-statement
 * transaction into a sequence of separate ones without saying so.
 *
 * So this exercises the seam the whole change rests on: several writes across
 * several tables inside one transaction that then throws, and nothing left
 * behind. A partial commit here would mean every boundary drawn in those
 * actions is decoration.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT RUNS
 * ---------------------------------------------------------------------------
 * The throwaway container from `npm run db:test:up`, never the Supabase
 * project — this inserts and deletes rows, and the development database is the
 * production one. Skips when the container is not up, the same as the RLS
 * suite, so the default `npm test` stays offline.
 */

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:dealertech@localhost:54329/dealertech_rls'

let db: ReturnType<typeof getDb>
let reachable = false

const orgId = randomUUID()
const storeId = randomUUID()
const customerId = randomUUID()
const vehicleId = randomUUID()

try {
  db = getDb(TEST_URL)
  await db.execute('SELECT 1')
  reachable = true
} catch {
  reachable = false
}

/** Thrown from inside a transaction to force the rollback under test. */
class Boom extends Error {}

describe.skipIf(!reachable)('write transactions', () => {
  beforeAll(async () => {
    await db.insert(schema.organizations).values({ id: orgId, name: 'Tx Group', slug: `tx-${orgId.slice(0, 8)}` })
    await db.insert(schema.stores).values({
      id: storeId, organizationId: orgId, name: 'Tx Rooftop', slug: `tx-${storeId.slice(0, 8)}`, state: 'TX',
    })
    await db.insert(schema.customers).values({ id: customerId, storeId, firstName: 'Tx', lastName: 'Customer' })
    await db.insert(schema.vehicles).values({
      id: vehicleId, storeId, vin: `TX${vehicleId.slice(0, 15).toUpperCase()}`, make: 'FORD', model: 'Edge', modelYear: 2024,
    })
  })

  afterAll(async () => {
    if (!reachable) return
    // Children first — the store cascade is not something to rely on in a test
    // whose whole subject is what does and does not get written.
    await db.delete(schema.mileageReadings).where(eq(schema.mileageReadings.storeId, storeId))
    await db.delete(schema.repairOrders).where(eq(schema.repairOrders.storeId, storeId))
    await db.delete(schema.vehicles).where(eq(schema.vehicles.storeId, storeId))
    await db.delete(schema.customers).where(eq(schema.customers.storeId, storeId))
    await db.delete(schema.stores).where(eq(schema.stores.id, storeId))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
  })

  it('leaves nothing behind when a later write fails', async () => {
    /*
      The shape of openRepairOrder: a repair order, then a mileage reading,
      then a failure. Before the conversion the first two would both have been
      committed the moment they ran, leaving a repair order whose vehicle has
      an odometer nobody agreed to.
    */
    const roNumber = `TX${Date.now().toString().slice(-6)}`

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.repairOrders).values({
          storeId, customerId, vehicleId, roNumber, status: 'OPEN', mileageIn: 50_000, openedAt: new Date(),
        })
        await tx.insert(schema.mileageReadings).values({
          storeId, vehicleId, mileage: 50_000, recordedAt: new Date(), source: 'WRITE_UP',
        })
        throw new Boom('the third write failed')
      }),
    ).rejects.toThrow(Boom)

    const orders = await db.select().from(schema.repairOrders)
      .where(and(eq(schema.repairOrders.storeId, storeId), eq(schema.repairOrders.roNumber, roNumber)))
    const readings = await db.select().from(schema.mileageReadings)
      .where(eq(schema.mileageReadings.vehicleId, vehicleId))

    expect(orders).toHaveLength(0)
    expect(readings).toHaveLength(0)
  })

  it('commits every write when the whole sequence succeeds', async () => {
    // The success path has to be untouched, which is the other half of the
    // claim: rolling back reliably is no use if committing became unreliable.
    const roNumber = `TX${(Date.now() + 1).toString().slice(-6)}`

    await db.transaction(async (tx) => {
      await tx.insert(schema.repairOrders).values({
        storeId, customerId, vehicleId, roNumber, status: 'OPEN', mileageIn: 60_000, openedAt: new Date(),
      })
      await tx.insert(schema.mileageReadings).values({
        storeId, vehicleId, mileage: 60_000, recordedAt: new Date(), source: 'WRITE_UP',
      })
      await tx.update(schema.vehicles)
        .set({ currentMileage: 60_000 })
        .where(eq(schema.vehicles.id, vehicleId))
    })

    const [order] = await db.select().from(schema.repairOrders)
      .where(and(eq(schema.repairOrders.storeId, storeId), eq(schema.repairOrders.roNumber, roNumber)))
    const readings = await db.select().from(schema.mileageReadings)
      .where(eq(schema.mileageReadings.vehicleId, vehicleId))
    const [vehicle] = await db.select().from(schema.vehicles)
      .where(eq(schema.vehicles.id, vehicleId))

    expect(order).toBeDefined()
    expect(readings).toHaveLength(1)
    expect(vehicle?.currentMileage).toBe(60_000)
  })

  it('serialises RO numbering under the advisory lock', async () => {
    /*
      Two write-ups racing in the same store. Both read max(ro_number) to decide
      their own, which without the lock is the classic read-then-write: both see
      the same maximum and both claim it. The lock is per-store and held to
      commit, so the second waits and reads the first's number.
    */
    const nextNumber = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const rows = await tx.select({ max: schema.repairOrders.roNumber })
        .from(schema.repairOrders)
        .where(eq(schema.repairOrders.storeId, storeId))
      const highest = rows.reduce((m, r) => Math.max(m, Number(r.max) || 0), 0)
      return String(highest + 1)
    }

    const writeUp = () =>
      db.transaction(async (tx) => {
        await tx.execute(`SELECT pg_advisory_xact_lock(hashtext('${storeId}'))`)
        const roNumber = await nextNumber(tx)
        await tx.insert(schema.repairOrders).values({
          storeId, customerId, vehicleId, roNumber, status: 'OPEN', mileageIn: 70_000, openedAt: new Date(),
        })
        return roNumber
      })

    // Sequential rather than concurrent: the client is max:1, so two overlapping
    // transactions on one connection would queue rather than contend, and a
    // green result would prove nothing about the lock. This asserts the
    // allocation itself advances, which is what the lock protects.
    const first = await writeUp()
    const second = await writeUp()

    expect(Number(second)).toBe(Number(first) + 1)
  })
})
