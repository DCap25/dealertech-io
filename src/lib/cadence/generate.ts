import { addDays, differenceInCalendarDays } from 'date-fns'
import { computeWarrantySnapshot } from '@/lib/warranty'
import type {
  CadenceContext, CadenceRule, ExistingTask, GeneratedTask,
} from './types'

/**
 * Turns a store's cadence rules into today's follow-up worklist.
 *
 * Pure and I/O-free. The nightly job calls this once per customer and writes
 * the results; the tests call it directly.
 *
 * The discipline being imported is the variable-ops one: a sales CRM enforces
 * follow-up for years after a delivery, while fixed ops typically stops at
 * "see you in six months." Every rule here exists because a specific kind of
 * customer otherwise goes quiet.
 */

const DEFAULT_LOOKAHEAD_DAYS = 7

/** Money left on the table when a prepaid visit expires unused, per visit. */
const PPM_VISIT_VALUE = 84
/** Typical service-contract gross when sold in the lane. */
const VSC_UPSELL_VALUE = 2400

const MAINTENANCE_INTERVALS: { key: string; label: string; miles: number; value: number }[] = [
  { key: 'OIL_CHANGE', label: 'Oil & Filter Change', miles: 7500, value: 84 },
  { key: 'TIRE_ROTATION', label: 'Tire Rotation', miles: 7500, value: 29 },
  { key: 'BRAKE_FLUID_SERVICE', label: 'Brake Fluid Exchange', miles: 45000, value: 183 },
  { key: 'TRANS_FLUID_SERVICE', label: 'Transmission Fluid Service', miles: 60000, value: 367 },
]

/**
 * Has a task already been raised for this target recently?
 *
 * Keyed on the SOURCE, not the rule, whenever a source exists. Keying on the
 * rule was wrong once sibling touches collapse in the dedupe step: a run would
 * store the card under the 40-day rule, the next run would find nothing for
 * the 10-day rule, fire again, and the worklist would grow on every run.
 *
 * Without a source (post-visit thank-you, dormant recovery) there is nothing
 * to key on but the rule itself.
 */
function inCooldown(
  rule: CadenceRule,
  existing: ExistingTask[],
  customerId: string,
  vehicleId: string | null,
  sourceKey: string | null,
  asOf: Date,
): boolean {
  return existing.some((task) => {
    if (task.customerId !== customerId) return false

    if (sourceKey) {
      if (task.sourceKey !== sourceKey) return false
    } else {
      if (task.cadenceRuleId !== rule.id) return false
      if (vehicleId && task.vehicleId && task.vehicleId !== vehicleId) return false
    }

    // An open task always blocks a duplicate, however old it is.
    if (task.status === 'PENDING' || task.status === 'IN_PROGRESS') return true
    return differenceInCalendarDays(asOf, task.createdAt) < rule.cooldownDays
  })
}

export function generateCadenceTasks(context: CadenceContext): GeneratedTask[] {
  const { asOf, customer, vehicles, rules, existingTasks, store } = context
  const lookahead = context.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS
  const horizon = addDays(asOf, lookahead)
  const out: GeneratedTask[] = []

  /**
   * Do-not-call suppresses the whole worklist, not individual rules.
   * A customer who asked not to be contacted must not reappear because a
   * different trigger happened to fire.
   */
  if (customer.doNotCall) return []

  const activeRules = rules.filter((r) => r.isActive)

  const emit = (
    rule: CadenceRule,
    task: Omit<GeneratedTask, 'cadenceRuleId' | 'trigger' | 'customerId' | 'priority' | 'assignToRole'>,
  ) => {
    if (task.dueAt > horizon) return
    if (inCooldown(rule, existingTasks, customer.id, task.vehicleId, task.sourceKey, asOf)) return
    out.push({
      ...task,
      cadenceRuleId: rule.id,
      trigger: rule.trigger,
      customerId: customer.id,
      priority: rule.priority,
      assignToRole: rule.assignToRole,
      talkTrack: task.talkTrack || rule.talkTrack || '',
    })
  }

  for (const rule of activeRules) {
    switch (rule.trigger) {
      // ------------------------------------------------- after a visit
      case 'POST_VISIT_THANK_YOU':
      case 'CSI_PRE_EMPTION': {
        if (!customer.lastRoClosedAt) break
        const dueAt = addDays(customer.lastRoClosedAt, rule.offsetDays)
        if (dueAt < addDays(asOf, -30)) break // too stale to be worth a call
        const isCsi = rule.trigger === 'CSI_PRE_EMPTION'
        emit(rule, {
          vehicleId: vehicles[0]?.id ?? null,
          title: isCsi ? 'Catch any issue before the OEM survey' : 'Thank-you and quality check',
          detail: `Last visit closed ${differenceInCalendarDays(asOf, customer.lastRoClosedAt)} days ago.`,
          talkTrack: rule.talkTrack ??
            (isCsi
              ? 'Ask directly whether anything fell short. A detractor caught now is a detractor you can fix.'
              : 'Confirm the concern is resolved and the vehicle is behaving.'),
          estimatedValue: 0,
          dueAt,
          sourceKey: `visit:${customer.lastRoClosedAt.toISOString().slice(0, 10)}`,
        })
        break
      }

      // ------------------------------------------ declined work re-offer
      case 'DECLINED_SERVICE_FOLLOW_UP': {
        for (const vehicle of vehicles) {
          for (const decline of vehicle.openDeclines) {
            const dueAt = addDays(decline.declinedAt, rule.offsetDays)
            emit(rule, {
              vehicleId: vehicle.id,
              title: `Re-offer: ${decline.description}`,
              detail: `Declined ${differenceInCalendarDays(asOf, decline.declinedAt)} days ago on the ${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim() +
                ` — quoted $${decline.quotedAmount.toLocaleString()}.`,
              talkTrack: rule.talkTrack ??
                'Reference the exact item and re-quote at today\'s prices. Lead with safety, not discount.',
              estimatedValue: decline.quotedAmount,
              dueAt,
              sourceKey: `decline:${decline.id}`,
              sourceDeclinedServiceId: decline.id,
              componentGroupKey: decline.componentGroupKey,
            })
          }
        }
        break
      }

      // ------------------------------------------------ maintenance due
      case 'MAINTENANCE_DUE_MILEAGE':
      case 'OEM_SCHEDULE_INTERVAL': {
        for (const vehicle of vehicles) {
          // A booked visit already solves this — do not call to book a booking.
          if (vehicle.nextAppointmentAt) continue
          const perDay = vehicle.avgMilesPerDay ?? 0
          if (perDay <= 0) continue

          for (const interval of MAINTENANCE_INTERVALS) {
            const lastAt = vehicle.lastServiceMileageByGroup[interval.key]
            if (lastAt === undefined) continue // no history — do not guess
            const dueAtMiles = lastAt + interval.miles
            const milesRemaining = dueAtMiles - vehicle.currentMileage
            const trigger = rule.offsetMiles ?? 500
            if (milesRemaining > trigger) continue

            // Convert the remaining miles into a date the customer will reach it.
            const daysAway = Math.max(0, Math.round(milesRemaining / perDay))
            emit(rule, {
              vehicleId: vehicle.id,
              title: `${interval.label} due`,
              detail: milesRemaining <= 0
                ? `Overdue by ${Math.abs(milesRemaining).toLocaleString()} miles on the ${vehicle.modelYear} ${vehicle.make}.`
                : `Reaches ${dueAtMiles.toLocaleString()} miles in about ${daysAway} days at their current rate.`,
              talkTrack: rule.talkTrack ??
                'Offer two specific appointment times rather than asking when they would like to come in.',
              estimatedValue: interval.value,
              dueAt: addDays(asOf, Math.min(daysAway, lookahead)),
              sourceKey: `maint:${vehicle.id}:${interval.key}:${dueAtMiles}`,
              componentGroupKey: interval.key,
            })
          }
        }
        break
      }

      // ------------------------------------------- prepaid plan expiring
      case 'PPM_EXPIRING': {
        for (const vehicle of vehicles) {
          for (const entitlement of vehicle.prepaidEntitlements) {
            const remaining = entitlement.totalAllowed - entitlement.used
            if (remaining <= 0 || !entitlement.expiresOn) continue
            // Negative offsetDays means "fire this far BEFORE expiry".
            const dueAt = addDays(entitlement.expiresOn, rule.offsetDays)
            const daysLeft = differenceInCalendarDays(entitlement.expiresOn, asOf)
            if (daysLeft < 0) continue

            emit(rule, {
              vehicleId: vehicle.id,
              title: `${remaining} prepaid ${entitlement.label} expiring`,
              detail: `Plan expires in ${daysLeft} days with ${remaining} visit${remaining === 1 ? '' : 's'} unused.`,
              talkTrack: rule.talkTrack ??
                'They already paid for these. Use it or lose it — this is the cheapest possible reason to book a visit.',
              estimatedValue: remaining * PPM_VISIT_VALUE,
              dueAt,
              /*
                No componentGroupKey, deliberately.

                This task chases an unused plan balance, not a job. Four prepaid
                oil changes expiring is not resolved by selling one of them —
                three are still on the table and the plan still runs out. Tagging
                it with OIL_CHANGE would make the next closed RO mark it done and
                drop the other three on the floor.
              */
              sourceKey: `ppm:${entitlement.contractId}:${entitlement.componentGroupKey}`,
            })
          }
        }
        break
      }

      // ---------------------------------------- factory warranty closing
      case 'WARRANTY_EXPIRING': {
        for (const vehicle of vehicles) {
          const hasVsc = vehicle.contracts.some((c) => c.productType === 'VSC' && c.status === 'ACTIVE')
          if (hasVsc) continue

          const snapshot = computeWarrantySnapshot({
            make: vehicle.make,
            modelYear: vehicle.modelYear,
            inServiceDate: vehicle.inServiceDate ?? new Date(vehicle.modelYear, 0, 1),
            currentMileage: vehicle.currentMileage,
            asOf,
            isOriginalOwner: vehicle.isOriginalOwner,
            isHybridOrEv: vehicle.isHybridOrEv,
            state: store.state,
          })
          const term = snapshot.basic?.active ? snapshot.basic : snapshot.powertrain
          if (!term?.active || !term.expiresOn) continue

          const dueAt = addDays(term.expiresOn, rule.offsetDays)
          emit(rule, {
            vehicleId: vehicle.id,
            title: `${term.name} ending — service contract window`,
            detail: `${term.monthsRemaining ?? '∞'} months and ${term.milesRemaining?.toLocaleString() ?? '∞'} miles left, with no contract on file.`,
            talkTrack: rule.talkTrack ??
              'Coverage is about to end. Once it lapses the conversation gets much harder and the price goes up.',
            estimatedValue: VSC_UPSELL_VALUE,
            dueAt,
            sourceKey: `warranty:${vehicle.id}:${term.name}`,
          })
        }
        break
      }

      // ------------------------------------------------- open recall
      case 'OPEN_RECALL': {
        for (const vehicle of vehicles) {
          if (vehicle.nextAppointmentAt) continue
          for (const recall of vehicle.openRecalls) {
            emit(rule, {
              vehicleId: vehicle.id,
              title: `Open recall ${recall.campaignNumber}`,
              detail: recall.parkIt
                ? `DO NOT DRIVE advisory. ${recall.description}`
                : recall.description || 'Manufacturer campaign outstanding.',
              talkTrack: rule.talkTrack ??
                'Manufacturer-funded and free to them. Verify it is open for this VIN in the OEM portal first.',
              estimatedValue: 0,
              dueAt: asOf,
              sourceKey: `recall:${vehicle.id}:${recall.campaignNumber}`,
            })
          }
        }
        break
      }

      // ----------------------------------------------- dormant recovery
      case 'DORMANT_CUSTOMER': {
        if (!customer.lastVisitAt) break
        const daysSince = differenceInCalendarDays(asOf, customer.lastVisitAt)
        if (daysSince < rule.offsetDays) break
        if (vehicles.some((v) => v.nextAppointmentAt)) break

        emit(rule, {
          vehicleId: vehicles[0]?.id ?? null,
          title: 'Win back a lapsed customer',
          detail: `No visit in ${Math.round(daysSince / 30)} months. ${customer.visitCount} lifetime visits, $${customer.lifetimeSpend.toLocaleString()} spent.`,
          talkTrack: rule.talkTrack ??
            'Lead with a complimentary inspection, not a discount. Find out where they have been going and why.',
          // A returning customer is worth roughly one average visit.
          estimatedValue: customer.visitCount > 0
            ? Math.round(customer.lifetimeSpend / customer.visitCount)
            : 0,
          dueAt: asOf,
          sourceKey: `dormant:${customer.lastVisitAt.toISOString().slice(0, 7)}`,
        })
        break
      }

      case 'MISSED_APPOINTMENT':
      case 'MAINTENANCE_DUE_TIME':
      case 'CONTRACT_EXPIRING':
      case 'STATE_INSPECTION_DUE':
      case 'SEASONAL':
        // Defined in the schema and configurable by a store, but not yet
        // generated. Listed explicitly so the switch stays exhaustive.
        break
    }
  }

  /**
   * One task per thing, not one task per rule.
   *
   * A store commonly configures several touches on the same trigger — a 10-day
   * re-offer and a 40-day re-offer, say. On a decline that is already six
   * months old BOTH offsets have elapsed, so the same brake job would produce
   * two identical cards. Collapse to the most urgent touch: highest priority
   * wins, and on a tie the later due date, which is the more recent step in
   * the sequence.
   */
  const bySource = new Map<string, GeneratedTask>()
  const deduped: GeneratedTask[] = []
  for (const task of out) {
    if (!task.sourceKey) {
      deduped.push(task)
      continue
    }
    const key = `${task.vehicleId ?? '-'}:${task.sourceKey}`
    const existing = bySource.get(key)
    if (!existing) {
      bySource.set(key, task)
      continue
    }
    const better =
      task.priority < existing.priority ||
      (task.priority === existing.priority && task.dueAt > existing.dueAt)
    if (better) bySource.set(key, task)
  }

  // Highest value first within the same rule priority, so a rep working top
  // down is always working the most valuable call available.
  return [...deduped, ...bySource.values()].sort(
    (a, b) => a.priority - b.priority || b.estimatedValue - a.estimatedValue,
  )
}
