'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { isSalesRole } from '@/lib/auth/sales'
import { canManageStaff } from '@/lib/team/roster'
import {
  assignAdvisor, assignedBy, capacityWarnings, dayRulesFor, mayOverrideHours, outsideHours,
  shouldClaimOwnership, slotsForDay, type Slot,
} from '@/lib/scheduling'
import {
  loadAdvisorsOnDutyScoped, loadDayBookScoped, loadOwningAdvisorScoped,
  loadSchedulingRulesScoped,
} from '@/lib/scheduling/store-rules'
import { transportFrom } from './transport'

/**
 * Booking — the first write in DealerTech that creates an appointment.
 *
 * ---------------------------------------------------------------------------
 * THIN, BECAUSE EVERYTHING THAT DECIDES IS PURE
 * ---------------------------------------------------------------------------
 * Slots, load, warnings and the assignment cascade all live in
 * `src/lib/scheduling/` and are tested there without a database. This file
 * reads the inputs, calls them, and writes the row. It recomputes rather than
 * trusting the form: a server action is a POST endpoint whether or not a page
 * rendered, so the advisor the client says the cascade picked is a claim, not
 * a fact.
 *
 * Warn, don't block (DRIVE_PLAN D3). Every capacity sentence comes back with
 * `ok: true` and the appointment already written — the booker may know exactly
 * why a fifth write-up at 8:00 is fine, and a refusal only teaches them to
 * record it somewhere we cannot see. The single hard stop is outside store
 * hours, and even that has an override.
 *
 * ---------------------------------------------------------------------------
 * ONE ACTION, TWO DOORS (P3)
 * ---------------------------------------------------------------------------
 * The delivery introduction books through here rather than through an action
 * of its own. It is the same act — a customer, a car, a slot, the cascade, the
 * capacity sentences — and forking it would mean two places that decide who
 * gets the appointment, which is exactly the divergence the pure engine exists
 * to prevent. What differs is *how it is recorded*: `source: SALES_INTRO`,
 * `visit_context: FIRST_SERVICE`, who sold the car, who was introduced. So the
 * fork is a flag on the form and about thirty lines below, not a file.
 */

export interface BookingState {
  ok?: boolean
  error?: string
  appointmentId?: string
  /** Said after the fact, never instead of the booking. */
  warnings?: string[]
  /**
   * The time is outside store hours and nothing has been written.
   *
   * Returned as its own field rather than as `error` because the form has a
   * real decision to render — the sentence, and a checkbox to book it anyway
   * for whoever is allowed to.
   */
  outsideHours?: { message: string; overridable: boolean }
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/** A failure the booker should read, as opposed to one we should fix. */
class BookingError extends Error {}

export async function bookAppointment(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  // A server action is a POST endpoint whether or not a page ever
  // rendered, so the guard belongs here and not only in the middleware.
  const user = await requireUser()

  const date = text(formData, 'date')
  const time = text(formData, 'time')
  if (!date || !time) return { error: 'Pick a day and a time.' }

  const when = new Date(`${date}T${time}:00`)
  if (Number.isNaN(when.getTime())) return { error: 'That is not a time we can read.' }

  const transportType = transportFrom(text(formData, 'transportType'))
  const concerns = text(formData, 'concerns')
  const overrideHours = formData.get('overrideHours') === 'on'

  /*
    Which door this came through.

    `introduction` is the delivery walk-over (D5); anything else is the ordinary
    drive booking. The flag comes off the form, so it is a claim — which is why
    the role check below reads the session and not this.
  */
  const introduction = text(formData, 'intent') === 'SALES_INTRO'
  const introducedAdvisorId = text(formData, 'introducedAdvisorId') || null

  /*
    DRIVE_PLAN §9 Q2 — OPEN, built per the recommendation: a SALES user books
    first services and nothing else.

    Enforced here and not only by the fence on the pages, because a server
    action is a POST endpoint whether or not a page ever rendered — the fence
    stops a salesperson *opening* /drive/book, and this stops them posting to
    it. Widening the answer later is deleting this block; narrowing it after
    the sales floor has the habit would be a fight.
  */
  if (isSalesRole(user.role) && !introduction) {
    return { error: 'A first service at delivery is the booking this account can make.' }
  }

  /*
    On an introduction the advisor picker IS the request — D5 says the
    introduced advisor enters the cascade as its step-1 REQUESTED, so the two
    fields are the same fact arriving under two names, and collapsing them here
    keeps `assignAdvisor` unaware that introductions exist.
  */
  const requestedAdvisorId = introduction
    ? introducedAdvisorId
    : text(formData, 'requestedAdvisorId') || null

  // Where the booking came from, when it came from a follow-up.
  const taskId = text(formData, 'taskId') || null
  const callLogId = text(formData, 'callLogId') || null

  const existingCustomerId = text(formData, 'customerId') || null
  const existingVehicleId = text(formData, 'vehicleId') || null

  /**
   * ---------------------------------------------------------------------------
   * ONE SCOPE FOR THE WHOLE ACTION
   * ---------------------------------------------------------------------------
   * `withCurrentUserScope` is both boundaries at once — the transaction that
   * makes the appointment and the follow-up it closes one act, and the tenant
   * boundary that stops any of it landing in another dealership. The reads are
   * inside it too, which is the substantive part: this action is handed a
   * customer id, a vehicle id and a task id, and copies `storeId` off nothing
   * but its own session. A lookup on the privileged connection would happily
   * resolve another store's customer and the appointment would be written
   * against them.
   */
  let result: BookingState
  try {
    result = await withCurrentUserScope(async (db) => {
      const storeId = user.storeId

      const rules = await loadSchedulingRulesScoped(db, storeId)

      /*
        The one hard stop, and it stops here — before anything is written and
        before anything is looked up. A manager may push through it, and
        anybody may for a tow-in, because a tow-in is not a scheduling choice:
        the truck arrives when it arrives and the car is already in the lot.
      */
      const closed = outsideHours(rules, when)
      if (closed) {
        const override = mayOverrideHours({
          isManager: canManageStaff(user.role),
          transportType,
        })
        if (!overrideHours || !override.allowed) {
          return {
            outsideHours: { message: closed, overridable: override.allowed },
          }
        }
      }

      /*
        The customer, either found or made.

        Found is the normal path and the one the form leads with — a store's own
        customer already carries the history every other surface reads. The
        inline create exists because the alternative is telling a BDC rep with a
        stranger on the phone to go and use a different screen first, and the
        appointment is the thing that must not be lost.
      */
      let customerId = existingCustomerId
      let vehicleId = existingVehicleId

      if (customerId) {
        const [customer] = await db.select({ id: schema.customers.id })
          .from(schema.customers).where(eq(schema.customers.id, customerId)).limit(1)
        if (!customer) return { error: 'That customer is not on this store’s books.' }

        /*
          And the vehicle, separately.

          The policy on `appointments` checks the appointment's own store_id and
          nothing else, so a vehicle id posted by hand would satisfy the foreign
          key while belonging to another dealership. Resolving it through the
          scoped connection is what makes that impossible: another store's
          vehicle simply is not there, and the appointment is booked without one
          rather than against somebody else's car.
        */
        if (vehicleId) {
          const [vehicle] = await db.select({ id: schema.vehicles.id })
            .from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1)
          if (!vehicle) vehicleId = null
        }

        /*
          A car this customer did not have before.

          The repeat buyer is the whole reason this branch exists: somebody who
          bought a truck here in 2022 is on the books already, and the sedan
          they are being handed the keys to this morning is not. Without this
          the introduction would either book against the old vehicle — the one
          fact on the appointment that would then be wrong for the rest of its
          life — or against no vehicle at all, and the first-service cue would
          have nothing to say.

          Same rule as the new-customer branch below: only when a real VIN, make
          and year arrive.
        */
        if (!vehicleId) {
          const created = await createVehicle(db, storeId, customerId, formData, introduction)
          if (created) vehicleId = created
        }
      } else {
        const firstName = text(formData, 'newFirstName')
        const lastName = text(formData, 'newLastName')
        const mobilePhone = text(formData, 'newMobilePhone')
        if (!lastName && !firstName) {
          return { error: 'Find the customer, or give a name for a new one.' }
        }

        const [created] = await db.insert(schema.customers).values({
          storeId,
          firstName: firstName || null,
          lastName: lastName || null,
          mobilePhone: mobilePhone || null,
        }).returning({ id: schema.customers.id })
        if (!created) throw new BookingError('Could not create the customer.')
        customerId = created.id

        vehicleId = await createVehicle(db, storeId, customerId, formData, introduction)
      }

      /*
        The cascade, recomputed on the server. The form's advisor dropdown is a
        *request*, which is step 1 — everything after it is decided here from
        the day's book, not from anything the client sent.

        **The owning step is live.** `customers.owning_advisor_id` arrived with
        migration 0029, so step 2 of D4 is reachable for the first time: a
        customer who has a guy gets their guy, whether or not this booker
        thought to ask. `assignAdvisor` itself is unchanged — landing P3 was a
        loader change, which is what the seam was built for.

        A brand-new customer created moments ago has no owner, so the read is
        skipped rather than run against a row we just wrote and already know
        the answer for.

        The three reads are sequential rather than a `Promise.all`: one scope is
        one transaction is one connection, so parallel here would only look
        parallel (src/db/scoped.ts).
      */
      const advisors = await loadAdvisorsOnDutyScoped(db, storeId)
      const dayBook = await loadDayBookScoped(db, storeId, when)
      const owningAdvisorId = existingCustomerId && customerId
        ? await loadOwningAdvisorScoped(db, customerId)
        : null
      const slots = slotsForDay(rules, when)

      const decision = assignAdvisor({
        requestedAdvisorId,
        owningAdvisorId,
        advisors,
        dayAppointments: dayBook,
        autoAssign: dayRulesFor(rules, when)?.autoAssign ?? true,
      })

      const warnings = capacityWarnings({
        rules,
        slots,
        slotStart: slotStartFor(slots, when),
        advisorId: decision.advisorId,
        advisors,
        dayAppointments: dayBook,
        isWaiter: transportType === 'WAITER',
      })

      const now = new Date()
      const [appointment] = await db.insert(schema.appointments).values({
        storeId,
        customerId,
        vehicleId: vehicleId || null,
        advisorId: decision.advisorId,
        scheduledAt: when,
        status: 'SCHEDULED',
        /*
          The desk this came from, not the job title. A BDC rep books as BDC; an
          advisor, a service manager and a fixed-ops director all book as
          ADVISOR, because from the customer's side and from every retention
          report's side that is what happened — somebody at the drive booked it.
          A MANAGER source would split the drive's own bookings in two for no
          question anybody asks.
        */
        source: introduction ? 'SALES_INTRO' : user.role === 'BDC' ? 'BDC' : 'ADVISOR',
        transportType,
        // The customer's own words, never an op-code description.
        customerConcerns: concerns || null,
        createdBy: user.id,
        assignedBy: assignedBy(decision.reason, user.id),
        assignmentReason: decision.reason,
        /*
          The delivery introduction's own three columns (D5). Written only on
          that path, so an ordinary booking leaves them null rather than
          carrying a `visit_context` nobody set.

          `introducedAdvisorId` is stored beside `advisorId` even though they
          agree today. They are different facts and they will diverge: a
          reassignment moves the advisor and must not rewrite who the customer
          actually shook hands with at delivery.
        */
        ...(introduction
          ? {
              visitContext: 'FIRST_SERVICE' as const,
              soldByUserId: user.id,
              introducedAdvisorId: introducedAdvisorId ?? null,
            }
          : {}),
        createdAt: now,
        updatedAt: now,
      }).returning({ id: schema.appointments.id })

      if (!appointment) throw new BookingError('Could not save the appointment.')

      /*
        The relationship, when the introduction created one — DRIVE_PLAN D6.

        Three conditions, and each one is load-bearing. It is an introduction:
        an ordinary booking is somebody ringing up, not a handshake. An advisor
        was actually named: an introduction with nobody named forms no
        relationship, and the customer meets their advisor at the first visit
        instead (see `shouldClaimOwnership` for why that is better than letting
        the balancer's pick become "their guy"). And nobody owns them yet: the
        rule this column lives or dies by is that it is never silently
        reassigned.

        `decision.advisorId` rather than the raw form field, so an id naming
        somebody who does not work here cannot become a customer's advisor —
        the cascade has already dropped it by then.

        In the same transaction as the appointment: a relationship recorded
        against a booking that rolled back would route the next six months of
        this customer's visits off an event that never happened.
      */
      if (introduction) {
        const claim = shouldClaimOwnership({
          currentOwnerId: owningAdvisorId,
          advisorId: decision.reason === 'REQUESTED' ? decision.advisorId : null,
          source: 'SALES_INTRO',
          at: now,
        })
        if (claim && customerId) {
          await db.update(schema.customers).set({
            owningAdvisorId: claim.advisorId,
            owningAdvisorSince: claim.since,
            owningAdvisorSource: claim.source,
            updatedAt: now,
          }).where(eq(schema.customers.id, customerId))
        }
      }

      /*
        Close the loop the booking came from.

        This is the whole reason `resulting_appointment_id` exists: the
        retention engine is measured in appointments set, and until now nothing
        could ever write that column. In the same transaction as the
        appointment, because a booking that does not close its task means the
        rep rings the same customer again tomorrow — and a task closed against
        an appointment that rolled back is worse.

        The task is completed rather than merely linked. A follow-up that
        produced a booking is done, and APPOINTMENT_SET is exactly the outcome
        the worklist already offers for it.
      */
      if (taskId) {
        const [task] = await db.select({ id: schema.cadenceTasks.id })
          .from(schema.cadenceTasks).where(eq(schema.cadenceTasks.id, taskId)).limit(1)
        if (task) {
          await db.update(schema.cadenceTasks).set({
            status: 'COMPLETED',
            completedAt: now,
            completedByUserId: user.id,
            outcome: 'APPOINTMENT_SET',
            resultingAppointmentId: appointment.id,
            updatedAt: now,
          }).where(eq(schema.cadenceTasks.id, taskId))
        }
      }

      /*
        A call log is a record of something that happened, so only the link is
        written — there is no status on it to close.
      */
      if (callLogId) {
        await db.update(schema.callLogs)
          .set({ resultingAppointmentId: appointment.id })
          .where(eq(schema.callLogs.id, callLogId))
      }

      return { ok: true, appointmentId: appointment.id, warnings }
    })
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message }
    console.error('[book] transaction rolled back:', error)
    return { error: 'Could not book that appointment. Nothing was saved — try again.' }
  }

  // After the commit. Revalidating a write that then rolled back would leave
  // the drive showing an appointment that does not exist.
  if (result.ok) {
    revalidatePath('/drive')
    revalidatePath('/drive/week')
    revalidatePath('/follow-up')
    revalidatePath('/introduce')
  }
  return result
}

/**
 * The car, when the form carried enough of one — and null when it did not.
 *
 * Only with a real VIN, make and year. `vehicles.vin` is NOT NULL and unique
 * per store, and a placeholder would be a permanent lie in the one column every
 * coverage lookup keys off. No vehicle is a state the schema already allows —
 * `appointments.vehicle_id` is nullable — and the write-up attaches the real one
 * when the car is in front of somebody who can read the plate.
 *
 * Shared by both branches of the booking because the delivery introduction made
 * it two cases rather than one: a repeat buyer is already on the books and the
 * car they were just handed the keys to is not.
 */
async function createVehicle(
  db: ScopedDb,
  storeId: string,
  customerId: string,
  formData: FormData,
  /**
   * True on the delivery introduction, where the dealership demonstrably sold
   * this car — it is being introduced by the person who sold it, minutes ago.
   * `sold_by_store` has existed on the ownership link since 0000 and nothing
   * has ever been able to set it truthfully; the introduction can, and the
   * ownership panel and every goodwill argument read it.
   */
  soldByStore = false,
): Promise<string | null> {
  const vin = text(formData, 'newVin').toUpperCase()
  const make = text(formData, 'newMake').toUpperCase()
  const modelYear = Number(text(formData, 'newModelYear'))
  if (!vin || !make || !Number.isFinite(modelYear) || modelYear <= 1900) return null

  const [vehicle] = await db.insert(schema.vehicles).values({
    storeId,
    vin,
    make,
    model: text(formData, 'newModel') || null,
    modelYear,
  }).returning({ id: schema.vehicles.id })
  if (!vehicle) return null

  await db.insert(schema.customerVehicles).values({
    storeId,
    customerId,
    vehicleId: vehicle.id,
    isCurrent: true,
    soldByStore,
    /*
      A purchase date only where there genuinely was a purchase we witnessed.
      A BDC rep keying a stranger's car has no idea when they bought it, and
      "today" would be a fabricated fact in a column the warranty and loyalty
      arguments both read.

      Nothing sets `isOriginalOwner` on either path, deliberately. The
      introduction knows the store sold the car; it does not know whether the
      car was new, and on Hyundai, Kia, Genesis and Mitsubishi that flag
      decides whether a 10yr/100k powertrain term applies at all. A confident
      wrong answer there is worse than the conservative default.
    */
    purchasedAt: soldByStore ? new Date().toISOString().slice(0, 10) : null,
  })
  return vehicle.id
}

/**
 * The slot a chosen time falls in.
 *
 * Falls back to the time itself when it lands outside the grid — the 7am tow-in
 * that came through the override has no box on the grid, and the warnings are
 * still worth computing against the hour it actually arrives.
 */
function slotStartFor(slots: Slot[], when: Date): Date {
  const t = when.getTime()
  return slots.find((s) => t >= s.start.getTime() && t < s.end.getTime())?.start ?? when
}
