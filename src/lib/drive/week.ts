import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * The week, read as advisors' books.
 *
 * ---------------------------------------------------------------------------
 * WHY CARDS AND NOT PREP SHEETS
 * ---------------------------------------------------------------------------
 * The day view is a worklist — an advisor works today one ranked conversation
 * at a time, and every card carries the full sheet. Nobody works
 * Thursday-after-next that way; they look at it as load. So the week renders a
 * light card derived *from* the sheet rather than the sheet itself: the engine
 * stays the only authority on opportunities (the safety flag below is read off
 * its output, never re-derived), and the view carries only what a card two
 * weeks out can honestly say. Deliberately absent: money. Whether a week of
 * projected opportunity belongs on this screen is DRIVE_PLAN §9 Q4, still
 * open — a comment marks the spot in the page.
 *
 * Per DRIVE_PLAN D2 (decided): the schedule is the advisor's book, so the
 * grouping primitive here is "whose book", with the unassigned pool as its own
 * book — those are the appointments an advisor may claim at write-up.
 *
 * Pure and I/O-free. The pages render over it; the loader feeds it.
 */

export interface WeekCard {
  appointmentId: string
  scheduledAt: Date
  /**
   * Placed on the grid by `scheduledAt`, with `promisedAt` shown on the card —
   * DRIVE_PLAN §9 Q5's recommendation, pending Dan's confirmation. Whichever
   * one a view leads with becomes the number the store manages to.
   */
  promisedAt: Date | null
  transportType: string
  status: string | null
  advisorId: string | null
  advisorName: string | null
  customerName: string
  vehicleLabel: string
  concerns: string | null
  /** The engine found a SAFETY-urgency opportunity on this vehicle. */
  hasSafetyItem: boolean
  /** Waiters are the load that hurts — a lounge holds only so many people. */
  isWaiter: boolean
}

/** One book's slice of one day. The unassigned pool is the `null`-id book. */
export interface DayBook {
  advisorId: string | null
  advisorName: string
  cards: WeekCard[]
}

export const UNASSIGNED_LABEL = 'Unassigned'

export function toWeekCard(sheet: PrepSheet): WeekCard | null {
  const a = sheet.appointment
  if (!a) return null
  return {
    appointmentId: a.id,
    scheduledAt: a.scheduledAt,
    promisedAt: a.promisedAt,
    transportType: a.transportType,
    status: a.status ?? null,
    advisorId: a.advisorId ?? null,
    advisorName: a.advisorName,
    customerName: sheet.customer.name,
    vehicleLabel: `${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim(),
    concerns: a.concerns,
    hasSafetyItem: sheet.opportunities.some((o) => o.urgency === 'SAFETY'),
    isWaiter: a.transportType === 'WAITER',
  }
}

/** Local-midnight key, so grouping agrees with what a person calls "Tuesday". */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The seven days of the week containing `anchor`, Monday first.
 *
 * Monday-start because a service drive's week starts when the weekend's
 * drop-offs are written up, and because Saturday belongs at the end of the row
 * it closes rather than the start of the next one.
 */
export function weekDays(anchor: Date): Date[] {
  const monday = new Date(anchor)
  monday.setHours(12, 0, 0, 0) // midday, so DST shifts stay on the calendar date
  const offset = (monday.getDay() + 6) % 7 // Sun=0 → 6, Mon=1 → 0
  monday.setDate(monday.getDate() - offset)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

/** Cards grouped by calendar day, each day's cards in arrival order. */
export function cardsByDay(cards: WeekCard[]): Map<string, WeekCard[]> {
  const out = new Map<string, WeekCard[]>()
  for (const card of [...cards].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    const key = dayKey(card.scheduledAt)
    out.set(key, [...(out.get(key) ?? []), card])
  }
  return out
}

/**
 * One day's cards as books — one per advisor, the unassigned pool last.
 *
 * Books are ordered by name so the dealership view's rows hold still between
 * days and between visits; a row order that reshuffles with load reads as the
 * page being broken. The pool is pinned last because it is the row a manager
 * scans for "who is going to claim these".
 */
export function booksForDay(cards: WeekCard[]): DayBook[] {
  const byAdvisor = new Map<string, DayBook>()
  const pool: DayBook = { advisorId: null, advisorName: UNASSIGNED_LABEL, cards: [] }

  for (const card of cards) {
    if (!card.advisorId) {
      pool.cards.push(card)
      continue
    }
    const existing = byAdvisor.get(card.advisorId)
    if (existing) existing.cards.push(card)
    else byAdvisor.set(card.advisorId, {
      advisorId: card.advisorId,
      advisorName: card.advisorName ?? 'Unnamed advisor',
      cards: [card],
    })
  }

  const books = [...byAdvisor.values()].sort((a, b) => a.advisorName.localeCompare(b.advisorName))
  return pool.cards.length > 0 ? [...books, pool] : books
}

/**
 * What lands on an advisor's "Mine" view: their book, plus the pool.
 *
 * The pool is theirs to claim — hiding it would make Mine a lie about what
 * their day might hold, and D4's claim-at-arrival model depends on advisors
 * seeing it.
 *
 * `advisorId` here is the id as the source system reports it. On the mock
 * adapter and the seed that IS the DealerTech user id, so matching against the
 * signed-in user works; a real DMS reports its own advisor ids, and Mine will
 * need the externalRefs identity mapping before it is true there. Stated
 * rather than solved — the mapping belongs to the adapter integration, not to
 * this view.
 */
export function mineCards(cards: WeekCard[], advisorId: string): WeekCard[] {
  return cards.filter((c) => c.advisorId === advisorId || c.advisorId === null)
}

export type WeekView = 'mine' | 'all'

/**
 * Where each role lands. A filter default, not a permission — anyone can
 * toggle to Everyone; they cover for each other, and hiding the store's week
 * buys nothing.
 */
export function defaultWeekView(isAdvisor: boolean): WeekView {
  return isAdvisor ? 'mine' : 'all'
}
