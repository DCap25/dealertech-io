import type { PrepSheet } from '@/lib/prep-sheet'
import {
  buildCoverageSegments, easyYesReasons, estimateGross, vinLastSix,
  type OpportunityDecision,
} from '@/lib/prep-sheet/presentation'
import type { CopilotContext, CopilotOpportunityLine } from './types'

/**
 * Turn a prep sheet into the facts the model may use.
 *
 * Pure and I/O-free. This is the only place the Co-Pilot learns anything about
 * the visit, which makes "did it make that up?" answerable by reading one
 * function rather than auditing a prompt.
 */
export function buildCopilotContext(
  sheet: PrepSheet,
  decisions: Record<string, OpportunityDecision> = {},
  asOf: Date = new Date(),
): CopilotContext {
  const segments = buildCoverageSegments(sheet, asOf)

  const opportunities: CopilotOpportunityLine[] = sheet.opportunities.map((o) => ({
    id: o.id,
    title: o.title,
    detail: o.detail,
    urgency: o.urgency,
    payer: o.likelyPayer,
    price: o.estimatedAmount,
    customerOwes: o.customerOutOfPocket,
    gross: estimateGross(o.estimatedAmount),
    decision: decisions[o.id] ?? 'PENDING',
    easyYes: easyYesReasons(o).map((r) => r.label),
    talkTrack: o.talkTrack,
  }))

  let remainingValue = 0
  let acceptedValue = 0
  for (const line of opportunities) {
    if (line.decision === 'PENDING') remainingValue += line.price
    if (line.decision === 'ACCEPTED') acceptedValue += line.price
  }

  return {
    customerName: sheet.customer.name,
    vehicle: `${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim(),
    vinLast6: vinLastSix(sheet.vehicle.vin),
    mileage: sheet.projectedMileage,
    concern: sheet.appointment?.concerns ?? null,
    visitCount: sheet.customer.visitCount,
    lifetimeSpend: sheet.customer.lifetimeSpend,
    alerts: sheet.alerts,
    coverage: segments.map((s) => ({
      key: s.key,
      label: s.label,
      status: s.active ? `${s.primary} (${s.secondary})` : 'Expired',
      detail: s.detail,
    })),
    opportunities,
    remainingValue,
    acceptedValue,
  }
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/**
 * Render the context as the grounding block that goes in the prompt.
 *
 * Plain text rather than JSON: it costs fewer tokens, and the model quotes
 * back plain figures more reliably than it quotes back nested keys.
 */
export function renderContext(ctx: CopilotContext): string {
  const lines: string[] = []

  lines.push('## This visit')
  lines.push(
    `${ctx.customerName} — ${ctx.vehicle} (VIN …${ctx.vinLast6}), ${ctx.mileage.toLocaleString()} miles.`,
  )
  lines.push(
    `${ctx.visitCount} previous visits, ${money(ctx.lifetimeSpend)} lifetime spend.`,
  )
  if (ctx.concern) lines.push(`Customer's own words: "${ctx.concern}"`)
  if (ctx.alerts.length > 0) {
    lines.push(`Alerts: ${ctx.alerts.join(' | ')}`)
  }

  lines.push('')
  lines.push('## Coverage on file (decided by the coverage engine, not by you)')
  if (ctx.coverage.length === 0) {
    lines.push('No factory warranty or purchased products on file.')
  } else {
    for (const c of ctx.coverage) {
      lines.push(`- ${c.label}: ${c.status}. ${c.detail}`)
    }
  }

  lines.push('')
  lines.push('## Opportunities, already ranked')
  if (ctx.opportunities.length === 0) {
    lines.push('Nothing outstanding on this vehicle.')
  } else {
    for (const o of ctx.opportunities) {
      const owed =
        o.customerOwes === 0
          ? 'customer owes nothing'
          : `customer owes ${money(o.customerOwes)} of ${money(o.price)}`
      lines.push(
        `- [${o.id}] ${o.title} — ${o.urgency}, ${owed}, paid by ${o.payer}, ` +
          `${money(o.gross)} store gross. Status: ${o.decision}.`,
      )
      lines.push(`    Detail: ${o.detail}`)
      if (o.easyYes.length > 0) lines.push(`    Why it lands: ${o.easyYes.join(', ')}`)
    }
  }

  lines.push('')
  lines.push(
    `Still on the table: ${money(ctx.remainingValue)}. Already added to the RO: ${money(ctx.acceptedValue)}.`,
  )

  return lines.join('\n')
}
