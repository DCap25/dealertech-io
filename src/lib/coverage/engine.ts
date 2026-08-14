import { addMonths, differenceInCalendarMonths, isAfter } from 'date-fns'
import { getComponentGroup, resolveComponentGroup, type ComponentGroup } from '@/lib/taxonomy'
import { computeWarrantySnapshot, type TermStatus, type WarrantySnapshot } from '@/lib/warranty'
import { isMachineRead } from './types'
import type {
  Confidence,
  Contract,
  CoverageDetermination,
  CoverageInput,
  PrepaidEntitlement,
  ReasoningStep,
} from './types'

const DISCLAIMER =
  'Advisory only. DealerTech does not adjudicate claims — the administrator or OEM does. Verify coverage and obtain authorization before beginning work or quoting a customer.'

const DEFAULT_GOODWILL_WINDOW_MONTHS = 12

/** Confidence ordering, so downgrades compose. */
const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }
const BY_RANK: Confidence[] = ['LOW', 'LOW', 'MEDIUM', 'HIGH']

function downgrade(current: Confidence, to: Confidence): Confidence {
  return RANK[to] < RANK[current] ? to : current
}

class Trace {
  readonly steps: ReasoningStep[] = []
  fired(rule: string, detail: string) {
    this.steps.push({ rule, outcome: 'FIRED', detail })
  }
  skipped(rule: string, detail: string) {
    this.steps.push({ rule, outcome: 'SKIPPED', detail })
  }
  notApplicable(rule: string, detail: string) {
    this.steps.push({ rule, outcome: 'NOT_APPLICABLE', detail })
  }
}

/**
 * Absolute odometer reading at which a contract lapses.
 *
 * `expirationMiles` is an explicit odometer limit. `termMiles` is miles of
 * coverage from the odometer at sale — but when the sale mileage is unknown
 * (the common case for a new-car contract) it is treated as an absolute limit,
 * which is how these contracts are normally written.
 */
function contractExpirationMiles(contract: Contract): number | null {
  if (contract.expirationMiles !== undefined) return contract.expirationMiles
  if (contract.termMiles === null) return null
  if (contract.purchaseMileage !== undefined) return contract.purchaseMileage + contract.termMiles
  return contract.termMiles
}

function contractExpirationDate(contract: Contract): Date | null {
  if (contract.expirationDate) return contract.expirationDate
  if (contract.termMonths === null) return null
  return addMonths(contract.purchaseDate, contract.termMonths)
}

export function isContractActive(
  contract: Contract,
  currentMileage: number,
  asOf: Date,
): { active: boolean; reason: string } {
  if (contract.status !== 'ACTIVE') {
    return { active: false, reason: `contract status is ${contract.status}` }
  }
  const expiresOn = contractExpirationDate(contract)
  if (expiresOn && isAfter(asOf, expiresOn)) {
    return { active: false, reason: `expired on ${expiresOn.toISOString().slice(0, 10)}` }
  }
  const expiresAtMiles = contractExpirationMiles(contract)
  if (expiresAtMiles !== null && currentMileage > expiresAtMiles) {
    return {
      active: false,
      reason: `odometer ${currentMileage.toLocaleString()} exceeds limit of ${expiresAtMiles.toLocaleString()}`,
    }
  }
  return { active: true, reason: 'within term and mileage' }
}

/**
 * Whether a VSC covers a component, honouring tier semantics.
 *
 * This is the fork that costs stores real money: an exclusionary contract
 * covers anything not expressly excluded, while an inclusionary one covers
 * nothing that is not expressly named.
 */
export function vscCoversComponent(
  contract: Contract,
  group: ComponentGroup,
): { covered: boolean; reason: string } {
  if (group.wearItem) {
    return { covered: false, reason: `${group.label} is a wear item — excluded by every service contract` }
  }
  if (group.maintenanceItem) {
    return { covered: false, reason: `${group.label} is scheduled maintenance — not a mechanical breakdown` }
  }
  if (contract.tierType === 'EXCLUSIONARY') {
    const excluded = contract.excludedComponentGroups.includes(group.key)
    return excluded
      ? { covered: false, reason: `${group.label} is on the exclusion list of this exclusionary contract` }
      : { covered: true, reason: `exclusionary tier and ${group.label} is not excluded` }
  }
  const listed = contract.coveredComponentGroups.includes(group.key)
  return listed
    ? { covered: true, reason: `${group.label} is a named covered component` }
    : {
        covered: false,
        reason: `inclusionary (named-component) tier and ${group.label} is not named — silence means NOT covered`,
      }
}

/**
 * The factory warranty term covering this component, if any.
 * Ordered longest-lived first so the advisor sees the most durable coverage.
 */
export function warrantyTermCovering(
  group: ComponentGroup,
  snapshot: WarrantySnapshot,
): TermStatus | undefined {
  if (group.wearItem) return undefined
  if (group.maintenanceItem) return undefined

  const candidates: (TermStatus | null | undefined)[] = []
  if (group.emissionsFederalLong) candidates.push(snapshot.emissionsLong)
  if (group.hybridEvEligible) candidates.push(snapshot.hybridEv)
  if (group.corrosionEligible) candidates.push(snapshot.corrosion)
  if (group.powertrainEligible) candidates.push(snapshot.powertrain)
  candidates.push(snapshot.basic)
  if (group.emissionsFederalShort) candidates.push(snapshot.emissionsShort)

  return candidates.find((t): t is TermStatus => Boolean(t?.active))
}

function findEntitlement(
  entitlements: PrepaidEntitlement[],
  group: ComponentGroup,
  asOf: Date,
): { entitlement: PrepaidEntitlement; remaining: number } | undefined {
  for (const e of entitlements) {
    if (e.componentGroupKey !== group.key) continue
    if (e.expiresOn && isAfter(asOf, e.expiresOn)) continue
    const remaining = e.totalAllowed - e.used
    if (remaining > 0) return { entitlement: e, remaining }
  }
  return undefined
}

/** Contracts whose provenance is shaky must not produce confident answers. */
function contractTrustPenalty(contract: Contract): Confidence {
  if (isMachineRead(contract.source) && !contract.verifiedAt) return 'LOW'
  if (contract.extractionConfidence === 'LOW') return 'LOW'
  if (contract.extractionConfidence === 'MEDIUM') return 'MEDIUM'
  return 'HIGH'
}

/**
 * Determines who pays for one operation on one vehicle.
 *
 * Strict waterfall, first match wins:
 *   open recall → prepaid maintenance → tire & wheel → factory warranty
 *   → service contract → customer pay
 *
 * Note on goodwill: it is deliberately NOT returned as a payer. Goodwill is a
 * discretionary request to the OEM, not an entitlement, and labelling it a
 * payer invites an advisor to promise something the manufacturer has not
 * agreed to. It surfaces instead as a required action on a customer-pay
 * determination, which is the honest framing and still prompts the ask.
 */
export function evaluateCoverage(input: CoverageInput): CoverageDetermination {
  const asOf = input.asOf ?? new Date()
  const { vehicle, operation, store } = input
  const contracts = input.contracts ?? []
  const entitlements = input.prepaidEntitlements ?? []
  const recalls = input.openRecalls ?? []

  const trace = new Trace()
  const requiredActions: string[] = []
  const alternatives: string[] = []
  let confidence: Confidence = 'HIGH'

  const total = operation.laborAmount + operation.partsAmount

  // ---------------------------------------------------------------- resolve
  let group: ComponentGroup | undefined
  if (operation.componentGroupKey) {
    group = getComponentGroup(operation.componentGroupKey)
    if (group) {
      trace.fired('resolve-component', `Explicit component group: ${group.label}`)
    } else {
      trace.skipped('resolve-component', `Unknown component group key "${operation.componentGroupKey}"`)
    }
  }
  if (!group) {
    const resolved = resolveComponentGroup(operation.description)
    if (resolved) {
      group = resolved.group
      confidence = downgrade(confidence, resolved.confidence)
      trace.fired(
        'resolve-component',
        `Resolved "${operation.description}" to ${resolved.group.label} via "${resolved.matchedOn}" (${resolved.confidence} confidence)`,
      )
    }
  }

  const bail = (detail: string): CoverageDetermination => {
    trace.skipped('waterfall', detail)
    return {
      payer: 'CUSTOMER_PAY',
      componentGroup: group,
      customerOutOfPocket: total,
      coveredAmount: 0,
      deductible: 0,
      deductibleType: 'NONE',
      requiredActions: [
        'Could not identify the component from the description. Select a component group manually before relying on this answer.',
      ],
      confidence: 'LOW',
      reasoning: trace.steps,
      alternatives: ['Any coverage may apply — this is not a determination that the customer owes the money.'],
      disclaimer: DISCLAIMER,
    }
  }

  if (!group) {
    return bail(`"${operation.description}" did not match any known component group`)
  }

  if (group.coverageVaries) {
    confidence = downgrade(confidence, 'MEDIUM')
    trace.fired(
      'coverage-varies',
      `${group.label}: ${group.coverageNote ?? 'treatment differs between manufacturers and administrators'}`,
    )
  }

  // ---------------------------------------------------------------- warranty
  const snapshot = computeWarrantySnapshot({
    make: vehicle.make,
    modelYear: vehicle.modelYear,
    inServiceDate: vehicle.inServiceDate,
    currentMileage: vehicle.currentMileage,
    asOf,
    isOriginalOwner: vehicle.isOriginalOwner,
    isHybridOrEv: vehicle.isHybridOrEv ?? false,
    state: store.state,
  })
  if (!snapshot.known) confidence = downgrade(confidence, 'LOW')

  const finish = (
    d: Omit<CoverageDetermination, 'reasoning' | 'disclaimer' | 'componentGroup' | 'confidence' | 'requiredActions' | 'alternatives'>,
  ): CoverageDetermination => ({
    ...d,
    componentGroup: group,
    requiredActions,
    confidence,
    reasoning: trace.steps,
    alternatives,
    disclaimer: DISCLAIMER,
  })

  // ------------------------------------------------------- 1. OPEN RECALL
  const recall = recalls.find((r) => r.componentGroupKeys.includes(group.key))
  if (recall) {
    trace.fired(
      'open-recall',
      `Campaign ${recall.campaignNumber} covers ${group.label}: ${recall.description}`,
    )
    if (recall.isCandidate) {
      confidence = downgrade(confidence, 'MEDIUM')
      requiredActions.push(
        `Campaign ${recall.campaignNumber} is a CANDIDATE from an NHTSA make/model/year lookup, not a VIN-level remedy check. Confirm it is open for this VIN in the OEM portal before promising the customer.`,
      )
      alternatives.push('If the campaign was already performed, fall through to the next payer.')
    }
    return finish({
      payer: 'OEM_RECALL',
      customerOutOfPocket: 0,
      coveredAmount: total,
      deductible: 0,
      deductibleType: 'NONE',
    })
  }
  trace.notApplicable('open-recall', 'No open campaign matches this component')

  // ------------------------------------------------- 2. PREPAID MAINTENANCE
  if (group.maintenanceItem) {
    const hit = findEntitlement(entitlements, group, asOf)
    if (hit) {
      const { entitlement, remaining } = hit
      trace.fired(
        'prepaid-maintenance',
        `${remaining} of ${entitlement.totalAllowed} ${group.label} visits remaining on the prepaid plan`,
      )
      if (entitlement.expiresOn) {
        const monthsLeft = differenceInCalendarMonths(entitlement.expiresOn, asOf)
        if (monthsLeft <= 3) {
          requiredActions.push(
            `Prepaid plan expires ${entitlement.expiresOn.toISOString().slice(0, 10)} with ${remaining} visit(s) unused — use it or lose it. Book the next visit before the customer leaves.`,
          )
        }
      }
      return finish({
        payer: 'PPM',
        customerOutOfPocket: 0,
        coveredAmount: total,
        deductible: 0,
        deductibleType: 'NONE',
        contractId: entitlement.contractId,
      })
    }
    trace.skipped('prepaid-maintenance', `No remaining prepaid entitlement for ${group.label}`)
  } else {
    trace.notApplicable('prepaid-maintenance', `${group.label} is not a scheduled maintenance item`)
  }

  // ------------------------------------------------------ 3. TIRE & WHEEL
  if (group.tireWheelEligible) {
    const tw = contracts.find((c) => c.productType === 'TIRE_WHEEL')
    if (tw) {
      const active = isContractActive(tw, vehicle.currentMileage, asOf)
      if (!active.active) {
        trace.skipped('tire-and-wheel', `${tw.adminCompany} tire & wheel policy: ${active.reason}`)
      } else {
        const cause = operation.damageCause ?? 'UNKNOWN'
        if (cause === 'WEAR') {
          trace.skipped(
            'tire-and-wheel',
            'Damage cause is normal wear — road hazard policies cover impact damage, not tread wear',
          )
        } else if (cause === 'COLLISION') {
          trace.skipped('tire-and-wheel', 'Collision damage is an insurance matter, not road hazard')
        } else {
          const min = tw.minimumTreadDepth32nds
          const tread = operation.treadDepth32nds
          if (min !== undefined && tread !== undefined && tread < min) {
            trace.skipped(
              'tire-and-wheel',
              `Tread at ${tread}/32" is below the policy minimum of ${min}/32" — claim would be denied`,
            )
            alternatives.push(
              `Tire is below the ${min}/32" policy floor. Sell replacement as customer pay, and note the policy still covers the OTHER tires.`,
            )
          } else {
            if (min !== undefined && tread === undefined) {
              confidence = downgrade(confidence, 'MEDIUM')
              requiredActions.push(
                `Measure tread depth before filing. This policy requires at least ${min}/32" remaining.`,
              )
            }
            if (cause === 'UNKNOWN') {
              confidence = downgrade(confidence, 'MEDIUM')
              requiredActions.push(
                'Confirm the damage is road hazard (impact, puncture, cut) — wear is not covered.',
              )
            }
            confidence = downgrade(confidence, contractTrustPenalty(tw))
            if (tw.requiresPriorAuthorization) {
              requiredActions.push(
                `Call ${tw.adminCompany}${tw.claimPhone ? ` at ${tw.claimPhone}` : ''} for authorization BEFORE mounting.`,
              )
            }
            const deductible = tw.deductibleAmount
            const covered = Math.max(0, Math.min(total, (tw.perTireLimit ?? total)) - deductible)
            trace.fired(
              'tire-and-wheel',
              `${tw.adminCompany} road hazard policy covers ${group.label}${tw.perTireLimit ? `, limit $${tw.perTireLimit} per tire` : ''}`,
            )
            return finish({
              payer: 'TIRE_WHEEL',
              customerOutOfPocket: Math.max(0, total - covered),
              coveredAmount: covered,
              deductible,
              deductibleType: tw.deductibleType,
              contractId: tw.id,
            })
          }
        }
      }
    } else {
      trace.skipped('tire-and-wheel', 'No tire & wheel policy on file')
      alternatives.push(
        'No tire & wheel coverage on file — worth selling, especially on low-profile or run-flat fitments.',
      )
    }
  } else {
    trace.notApplicable('tire-and-wheel', `${group.label} is not a tire or wheel component`)
  }

  // --------------------------------------------------- 4. FACTORY WARRANTY
  const term = warrantyTermCovering(group, snapshot)
  if (term) {
    trace.fired(
      'factory-warranty',
      `${term.name} is active — ${term.monthsRemaining ?? '∞'} months and ${term.milesRemaining?.toLocaleString() ?? '∞'} miles remaining`,
    )
    // A term about to lapse deserves a flag: the repair may straddle expiry.
    const nearExpiry =
      (term.monthsRemaining !== null && term.monthsRemaining <= 3) ||
      (term.milesRemaining !== null && term.milesRemaining <= 3000)
    if (nearExpiry) {
      confidence = downgrade(confidence, 'MEDIUM')
      requiredActions.push(
        `${term.name} is nearly exhausted (${term.monthsRemaining ?? '∞'} months / ${term.milesRemaining?.toLocaleString() ?? '∞'} miles left). Verify in the OEM portal and open the RO before it lapses.`,
      )
      alternatives.push('Warranty expiring — prime moment to present a service contract.')
    }
    for (const w of snapshot.warnings) requiredActions.push(w)
    return finish({
      payer: 'OEM_WARRANTY',
      customerOutOfPocket: 0,
      coveredAmount: total,
      deductible: 0,
      deductibleType: 'NONE',
      warrantyTermName: term.name,
    })
  }
  trace.skipped(
    'factory-warranty',
    group.wearItem || group.maintenanceItem
      ? `${group.label} is a wear/maintenance item — never a warranty repair`
      : 'No active factory warranty term covers this component',
  )

  // ---------------------------------------------------- 5. SERVICE CONTRACT
  const vscs = contracts.filter((c) => c.productType === 'VSC')
  for (const vsc of vscs) {
    const active = isContractActive(vsc, vehicle.currentMileage, asOf)
    if (!active.active) {
      trace.skipped('service-contract', `${vsc.adminCompany} VSC: ${active.reason}`)
      continue
    }
    const covers = vscCoversComponent(vsc, group)
    if (!covers.covered) {
      trace.skipped('service-contract', `${vsc.adminCompany} VSC does not cover it — ${covers.reason}`)
      continue
    }
    confidence = downgrade(confidence, contractTrustPenalty(vsc))
    if (isMachineRead(vsc.source) && !vsc.verifiedAt) {
      requiredActions.push(
        'This contract was read from a document and has not been verified by a human. Confirm the terms before relying on them.',
      )
    }
    if (vsc.requiresPriorAuthorization) {
      requiredActions.push(
        `PRIOR AUTHORIZATION REQUIRED. Call ${vsc.adminCompany}${vsc.claimPhone ? ` at ${vsc.claimPhone}` : ''} before teardown — starting work first is the most common reason a valid claim is denied.`,
      )
    }
    if (vsc.tierType === 'INCLUSIONARY') {
      requiredActions.push(
        `${vsc.adminCompany} contract is a named-component (inclusionary) tier. Confirm the exact part is listed before promising coverage.`,
      )
    }
    trace.fired(
      'service-contract',
      `${vsc.adminCompany} ${vsc.coverageTier ?? vsc.tierType} contract covers ${group.label} — ${covers.reason}`,
    )
    const deductible = vsc.deductibleAmount
    const covered = Math.max(0, total - deductible)
    return finish({
      payer: 'VSC',
      customerOutOfPocket: Math.min(total, deductible),
      coveredAmount: covered,
      deductible,
      deductibleType: vsc.deductibleType,
      contractId: vsc.id,
    })
  }
  if (vscs.length === 0) {
    trace.skipped('service-contract', 'No service contract on file')
  }

  // -------------------------------------------------------- 6. CUSTOMER PAY
  // Goodwill is surfaced here as a prompt, never as a promise.
  const windowMonths = store.goodwillWindowMonths ?? DEFAULT_GOODWILL_WINDOW_MONTHS
  const referenceTerm = group.powertrainEligible ? snapshot.powertrain : snapshot.basic
  if (
    referenceTerm &&
    !referenceTerm.active &&
    referenceTerm.expiredBy === 'TIME' &&
    referenceTerm.monthsRemaining !== null &&
    Math.abs(referenceTerm.monthsRemaining) <= windowMonths &&
    !group.wearItem &&
    !group.maintenanceItem
  ) {
    const history = input.history
    const loyal = (history?.visitCount ?? 0) >= 3 || (history?.lifetimeSpend ?? 0) >= 2500
    if (loyal) {
      trace.fired(
        'goodwill-candidate',
        `${referenceTerm.name} lapsed only ${Math.abs(referenceTerm.monthsRemaining)} months ago and the customer has ${history?.visitCount ?? 0} visits / $${(history?.lifetimeSpend ?? 0).toLocaleString()} lifetime spend`,
      )
      requiredActions.push(
        `GOODWILL CANDIDATE — ${referenceTerm.name} expired only ${Math.abs(referenceTerm.monthsRemaining)} months ago and this is a loyal customer. Submit a policy adjustment request to the OEM BEFORE quoting. Goodwill is discretionary, so do not promise it.`,
      )
      alternatives.push('OEM goodwill / policy adjustment may cover part or all of this repair.')
    }
  }

  trace.fired('customer-pay', `No coverage applies — customer pays $${total.toFixed(2)}`)
  return finish({
    payer: 'CUSTOMER_PAY',
    customerOutOfPocket: total,
    coveredAmount: 0,
    deductible: 0,
    deductibleType: 'NONE',
  })
}

export { BY_RANK }
