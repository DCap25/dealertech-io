/**
 * Live end-to-end smoke check against real NHTSA endpoints.
 * Run: npx tsx scripts/smoke.ts
 */
import { runLookup } from '@/lib/demo/run-lookup'
import type { Contract } from '@/lib/coverage'

const zurich: Contract = {
  id: 'vsc-demo',
  productType: 'VSC',
  adminCompany: 'Zurich',
  contractNumber: 'ZUR-77213',
  purchaseDate: new Date('2019-06-15'),
  termMonths: 120,
  termMiles: 150_000,
  deductibleAmount: 100,
  deductibleType: 'PER_VISIT',
  coverageTier: 'Platinum',
  tierType: 'EXCLUSIONARY',
  coveredComponentGroups: [],
  excludedComponentGroups: [],
  requiresPriorAuthorization: true,
  claimPhone: '800-555-0100',
  status: 'ACTIVE',
  source: 'MANUAL',
}

async function scenario(label: string, req: Parameters<typeof runLookup>[0]) {
  const r = await runLookup(req)
  console.log('\n' + '='.repeat(72))
  console.log(label)
  console.log('='.repeat(72))
  if (r.errors.length) console.log('ERRORS:', r.errors)
  if (r.vehicle) {
    console.log(
      `Vehicle : ${r.vehicle.modelYear} ${r.vehicle.make} ${r.vehicle.model}` +
        `${r.vehicle.isHybridOrEv ? '  [HYBRID/EV detected from VIN]' : ''}`,
    )
  }
  if (r.warranty) {
    const t = (x: { name: string; active: boolean; monthsRemaining: number | null; milesRemaining: number | null } | null) =>
      x ? `${x.name}: ${x.active ? 'ACTIVE' : 'expired'} (${x.monthsRemaining ?? '∞'}mo / ${x.milesRemaining?.toLocaleString() ?? '∞'}mi)` : null
    console.log('Warranty:')
    for (const term of [r.warranty.basic, r.warranty.powertrain, r.warranty.emissionsLong, r.warranty.hybridEv]) {
      const line = t(term)
      if (line) console.log('   ', line)
    }
  }
  console.log(`Recalls : ${r.candidateRecalls.length} candidate campaign(s) for this make/model/year`)
  const d = r.determination
  if (d) {
    console.log(`\n>>> PAYER: ${d.payer}   confidence=${d.confidence}`)
    console.log(`    component: ${d.componentGroup?.label ?? '(unresolved)'}`)
    console.log(`    customer pays $${d.customerOutOfPocket.toFixed(2)}, covered $${d.coveredAmount.toFixed(2)}`)
    if (d.warrantyTermName) console.log(`    via: ${d.warrantyTermName}`)
    if (d.requiredActions.length) {
      console.log('    REQUIRED ACTIONS:')
      for (const a of d.requiredActions) console.log(`      - ${a}`)
    }
  }
}

const base = {
  currentMileage: 78_000,
  inServiceDate: new Date('2019-06-15'),
  isOriginalOwner: true,
  state: 'TX',
  laborRate: 185,
  laborAmount: 800,
  partsAmount: 1400,
  visitCount: 6,
  lifetimeSpend: 3800,
}

async function main() {
  await scenario('1) 2013 F-150, catalytic converter, no contracts — federal 8/80 should rescue it', {
    ...base,
    vin: '1FTFW1ET9DFC10312',
    concern: 'P0420 catalytic converter efficiency below threshold',
    inServiceDate: new Date('2013-06-15'),
    currentMileage: 71_000,
  })

  await scenario('2) 2013 F-150, A/C compressor, exclusionary VSC on file', {
    ...base,
    vin: '1FTFW1ET9DFC10312',
    concern: 'a/c compressor not cooling',
    inServiceDate: new Date('2013-06-15'),
    contracts: [zurich],
  })

  await scenario('3) 2019 Tesla Model 3 in CALIFORNIA, HV battery at 120k', {
    ...base,
    vin: '5YJ3E1EA7KF317806',
    concern: 'hybrid battery reduced range',
    currentMileage: 120_000,
    state: 'CA',
    partsAmount: 13_000,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
