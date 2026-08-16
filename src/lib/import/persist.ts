import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { modelYearFromVin } from '@/lib/vin'
import type { ImportEntity } from './entities'
import { declineKey, nameParts } from './identity'
import type { ImportedRow, RowRejection } from './mapping'

/**
 * Writing an import into the dealership's records.
 *
 * ---------------------------------------------------------------------------
 * RUNS AS THE MANAGER, NOT AS THE SYSTEM
 * ---------------------------------------------------------------------------
 * `withCurrentUserScope`, deliberately. An import is a signed-in person acting
 * inside their own store, which is exactly the case row-level security is for
 * — and it is a lot of writes at once, so it is the last place to reach for a
 * privileged connection out of convenience. A bug here that crossed a store
 * boundary would write another dealership's customers into this one's history.
 *
 * It is also one transaction, which means the whole import commits or none of
 * it does. That matters more than it sounds: a half-applied import leaves a
 * store with some of their history and no way to tell which part, and the only
 * safe recovery is to delete everything and start again.
 *
 * ---------------------------------------------------------------------------
 * RE-RUNNING THE SAME FILE MUST NOT DOUBLE THE HISTORY
 * ---------------------------------------------------------------------------
 * Somebody will import the same export twice — because the first run half
 * failed, or because nobody remembered, or because the file was re-sent. Two
 * copies of every decline would show a customer the same $618 of brakes twice
 * on one menu, which is precisely the credibility failure this product exists
 * to prevent.
 *
 * So every row carries a natural key, and existing keys are loaded once up
 * front and checked in memory. A duplicate is skipped and counted, never
 * inserted and never treated as an error.
 */

/**
 * The synchronous ceiling.
 *
 * An import runs inside a request, and a request has a wall clock. Thirty
 * thousand rows is comfortably inside it and is more than a franchise store's
 * five years of declines; past that the honest answer is to split the file
 * rather than to pretend a background job exists that does not.
 */
export const MAX_IMPORT_ROWS = 30_000

export interface ImportOutcome {
  batchId: string | null
  entity: ImportEntity
  totalRows: number
  imported: number
  /** Rows that matched something already on file. Not an error. */
  skippedDuplicates: number
  rejected: number
  vehiclesCreated: number
  customersCreated: number
  /** Things worth saying out loud, in the order they matter. */
  notes: string[]
  rejections: RowRejection[]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const date = (v: unknown): Date | undefined => (v instanceof Date ? v : undefined)

/**
 * Import declined services.
 *
 * The one that sells the product: a five-year export becomes a ranked list of
 * work the store already quoted and never followed up, priced at today's rates
 * on the next prep sheet.
 */
export async function importDeclinedServices(
  storeId: string,
  rows: ImportedRow[],
  fileName: string,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    batchId: null,
    entity: 'DECLINED_SERVICE',
    totalRows: rows.length,
    imported: 0,
    skippedDuplicates: 0,
    rejected: 0,
    vehiclesCreated: 0,
    customersCreated: 0,
    notes: [],
    rejections: [],
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    outcome.rejected = rows.length
    outcome.notes.push(
      `This file has ${rows.length.toLocaleString()} rows, above the ${MAX_IMPORT_ROWS.toLocaleString()} an import can process at once. Split it and run the parts.`,
    )
    return outcome
  }

  return withCurrentUserScope(async (db) => {
    const [batch] = await db.insert(schema.importBatches).values({
      storeId,
      entity: 'RO_LINE',
      fileName,
      status: 'RUNNING',
      totalRows: rows.length,
      startedAt: new Date(),
    }).returning({ id: schema.importBatches.id })

    outcome.batchId = batch?.id ?? null

    const vins = [...new Set(rows.map((r) => str(r.fields.vin)).filter((v): v is string => !!v))]

    /*
      Everything loaded in three queries rather than three per row.

      Twenty thousand rows doing a lookup each is forty thousand round trips
      inside one transaction on a single connection — minutes of held locks for
      work that fits in memory.
    */
    const existingVehicles = vins.length === 0 ? [] : await db
      .select({ id: schema.vehicles.id, vin: schema.vehicles.vin })
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.storeId, storeId), inArray(schema.vehicles.vin, vins)))

    const vehicleByVin = new Map(existingVehicles.map((v) => [v.vin, v.id]))

    const owners = existingVehicles.length === 0 ? [] : await db
      .select({
        vehicleId: schema.customerVehicles.vehicleId,
        customerId: schema.customerVehicles.customerId,
      })
      .from(schema.customerVehicles)
      .where(and(
        eq(schema.customerVehicles.storeId, storeId),
        eq(schema.customerVehicles.isCurrent, true),
        inArray(schema.customerVehicles.vehicleId, existingVehicles.map((v) => v.id)),
      ))

    const ownerByVehicle = new Map(owners.map((o) => [o.vehicleId, o.customerId]))

    const existingCustomers = await db
      .select({
        id: schema.customers.id,
        email: schema.customers.email,
        mobilePhone: schema.customers.mobilePhone,
      })
      .from(schema.customers)
      .where(eq(schema.customers.storeId, storeId))

    /*
      Matched on email or phone, never on name.

      Two John Smiths at one rooftop is not a hypothetical, and merging them
      would put one customer's declined brakes on the other's prep sheet. A
      duplicate customer record is a tidiness problem; a merged one is a
      privacy incident.
    */
    const customerByEmail = new Map<string, string>()
    const customerByPhone = new Map<string, string>()
    for (const c of existingCustomers) {
      if (c.email) customerByEmail.set(c.email.toLowerCase(), c.id)
      if (c.mobilePhone) customerByPhone.set(c.mobilePhone, c.id)
    }

    const existingKeys = new Set<string>()
    if (existingVehicles.length > 0) {
      const priorDeclines = await db
        .select({
          vehicleId: schema.declinedServices.vehicleId,
          declinedAt: schema.declinedServices.declinedAt,
          description: schema.declinedServices.description,
        })
        .from(schema.declinedServices)
        .where(and(
          eq(schema.declinedServices.storeId, storeId),
          inArray(schema.declinedServices.vehicleId, existingVehicles.map((v) => v.id)),
        ))
      for (const d of priorDeclines) {
        existingKeys.add(declineKey(d.vehicleId, d.declinedAt, d.description))
      }
    }

    const toInsert: (typeof schema.declinedServices.$inferInsert)[] = []
    let unknownVehicleRows = 0

    for (const row of rows) {
      const vin = str(row.fields.vin)
      const description = str(row.fields.description)
      const quotedAmount = num(row.fields.quotedAmount)
      const declinedAt = date(row.fields.declinedAt)
      if (!vin || !description || quotedAmount === undefined || !declinedAt) continue

      // ---- the vehicle
      let vehicleId = vehicleByVin.get(vin)
      if (!vehicleId) {
        const make = str(row.fields.make)
        // The VIN encodes its own model year at position 10, so a row without
        // a year column is still enough to create a vehicle correctly.
        const modelYear = num(row.fields.modelYear)
          ?? modelYearFromVin(vin, declinedAt.getUTCFullYear() + 1)

        if (!make || !modelYear) {
          /*
            Rejected rather than invented.

            `make` and `model_year` are not nullable, and a vehicle created as
            "2019 UNKNOWN" is worse than a row that did not import: it reads
            that way on a prep sheet in front of a customer, and the warranty
            engine has no reference data for it, so every coverage answer on
            that car becomes "verify in the OEM portal".
          */
          unknownVehicleRows++
          outcome.rejections.push({
            line: row.line,
            field: 'vin',
            fieldLabel: 'VIN',
            value: vin,
            reason: 'This VIN is not on file and the row has no make to create it from. Import your vehicle list first, or map a Make column.',
          })
          outcome.rejected++
          continue
        }

        const [created] = await db.insert(schema.vehicles).values({
          storeId,
          vin,
          vinValid: true,
          make: make.toUpperCase(),
          model: str(row.fields.model) ?? null,
          modelYear,
        }).returning({ id: schema.vehicles.id })

        if (!created) continue
        vehicleId = created.id
        vehicleByVin.set(vin, vehicleId)
        outcome.vehiclesCreated++
      }

      // ---- the customer
      let customerId = ownerByVehicle.get(vehicleId)
      if (!customerId) {
        const email = str(row.fields.customerEmail)
        const phone = str(row.fields.customerPhone)
        const name = str(row.fields.customerName)

        if (email) customerId = customerByEmail.get(email)
        if (!customerId && phone) customerId = customerByPhone.get(phone)

        if (!customerId) {
          if (!name && !email && !phone) {
            outcome.rejections.push({
              line: row.line,
              field: 'customerName',
              fieldLabel: 'Customer',
              value: '',
              reason: 'This vehicle has no owner on file and the row names no customer. A decline has to belong to somebody.',
            })
            outcome.rejected++
            continue
          }

          const parts = name ? nameParts(name) : { firstName: null, lastName: 'Unknown' }
          const [created] = await db.insert(schema.customers).values({
            storeId,
            firstName: parts.firstName,
            lastName: parts.lastName,
            email: email ?? null,
            mobilePhone: phone ?? null,
          }).returning({ id: schema.customers.id })

          if (!created) continue
          customerId = created.id
          outcome.customersCreated++
          if (email) customerByEmail.set(email, customerId)
          if (phone) customerByPhone.set(phone, customerId)
        }

        await db.insert(schema.customerVehicles).values({
          storeId, customerId, vehicleId, isCurrent: true,
        })
        ownerByVehicle.set(vehicleId, customerId)
      }

      // ---- the decline itself
      const key = declineKey(vehicleId, declinedAt, description)
      if (existingKeys.has(key)) {
        outcome.skippedDuplicates++
        continue
      }
      existingKeys.add(key)

      toInsert.push({
        storeId,
        customerId,
        vehicleId,
        description,
        quotedAmount: quotedAmount.toFixed(2),
        declinedAt,
        declineReason: str(row.fields.declineReason) ?? null,
        mileageAtDecline: num(row.fields.mileageAtDecline) ?? null,
      })
    }

    // Chunked so one statement does not carry thirty thousand rows of
    // parameters, which drivers and poolers both dislike.
    const CHUNK = 500
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(schema.declinedServices).values(toInsert.slice(i, i + CHUNK))
    }
    outcome.imported = toInsert.length

    if (unknownVehicleRows > 0) {
      outcome.notes.push(
        `${unknownVehicleRows.toLocaleString()} row(s) were for vehicles not on file and had no make to create them from. Import your vehicle list and run this again — duplicates are skipped, so re-running is safe.`,
      )
    }
    if (outcome.skippedDuplicates > 0) {
      outcome.notes.push(
        `${outcome.skippedDuplicates.toLocaleString()} row(s) were already on file and were left alone.`,
      )
    }
    if (outcome.vehiclesCreated > 0) {
      outcome.notes.push(
        `${outcome.vehiclesCreated.toLocaleString()} vehicle(s) were created from this file. Their coverage will read "verify in the OEM portal" until an in-service date is known.`,
      )
    }

    if (batch) {
      await db.update(schema.importBatches).set({
        status: outcome.rejected > 0 ? 'PARTIAL' : 'SUCCESS',
        processedRows: outcome.imported,
        failedRows: outcome.rejected,
        // Capped: an error report is for finding the pattern, and nobody reads
        // twenty thousand of them. The count above is the honest total.
        errorReport: outcome.rejections.length > 0
          ? JSON.stringify(outcome.rejections.slice(0, 500))
          : null,
        finishedAt: new Date(),
      }).where(eq(schema.importBatches.id, batch.id))
    }

    return outcome
  })
}

/** Batches for a store, newest first. For the onboarding screen. */
export async function recentImports(db: ScopedDb, storeId: string, limit = 10) {
  return db
    .select({
      id: schema.importBatches.id,
      entity: schema.importBatches.entity,
      fileName: schema.importBatches.fileName,
      status: schema.importBatches.status,
      totalRows: schema.importBatches.totalRows,
      processedRows: schema.importBatches.processedRows,
      failedRows: schema.importBatches.failedRows,
      finishedAt: schema.importBatches.finishedAt,
      createdAt: schema.importBatches.createdAt,
    })
    .from(schema.importBatches)
    .where(eq(schema.importBatches.storeId, storeId))
    .orderBy(schema.importBatches.createdAt)
    .limit(limit)
}
