import { isEasyYes, wasPresented } from './metrics'
import type { OutcomeRecord, Streak } from './types'

/**
 * Private streaks.
 *
 * Counted in consecutive *visits*, not days — a streak that breaks because an
 * advisor took a day off is a punishment for having a life, and it teaches
 * people to distrust the number. Only visits where the advisor actually worked
 * a prep sheet count.
 *
 * Both streaks measure presenting, never closing. A customer's no should not
 * cost an advisor a streak they earned by doing their job properly — and
 * neither should a call-me, which reaches both predicates below through
 * `wasPresented` and keeps a run alive exactly as an acceptance does. That is
 * the whole point of the rule: the advisor controls the asking, and a call-me
 * is the asking having gone well.
 */

interface Visit {
  appointmentId: string
  at: Date
  outcomes: OutcomeRecord[]
}

/** Group into visits, newest first. */
export function groupByVisit(outcomes: OutcomeRecord[]): Visit[] {
  const byAppointment = new Map<string, OutcomeRecord[]>()
  for (const o of outcomes) {
    const existing = byAppointment.get(o.appointmentId)
    if (existing) existing.push(o)
    else byAppointment.set(o.appointmentId, [o])
  }

  return [...byAppointment.entries()]
    .map(([appointmentId, group]) => ({
      appointmentId,
      // A visit is dated by its last decision — when the advisor finished it.
      at: group.reduce((latest, o) => (o.decidedAt > latest ? o.decidedAt : latest), group[0]!.decidedAt),
      outcomes: group,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Current run from the most recent visit, and the best run anywhere in the history. */
function runs(visits: Visit[], qualifies: (v: Visit) => boolean): { current: number; best: number } {
  let current = 0
  for (const visit of visits) {
    if (!qualifies(visit)) break
    current += 1
  }

  let best = 0
  let run = 0
  for (const visit of visits) {
    if (qualifies(visit)) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }

  return { current, best }
}

function presentedEverything(visit: Visit): boolean {
  return visit.outcomes.every(wasPresented)
}

function capturedEveryEasyYes(visit: Visit): boolean {
  const easy = visit.outcomes.filter(isEasyYes)
  // A visit with no easy-yes items neither earns nor breaks the streak.
  return easy.length === 0 ? true : easy.every(wasPresented)
}

export function buildStreaks(outcomes: OutcomeRecord[]): Streak[] {
  const visits = groupByVisit(outcomes)
  if (visits.length === 0) return []

  const full = runs(visits, presentedEverything)
  const easy = runs(visits, capturedEveryEasyYes)

  return [
    {
      key: 'full-presentation',
      label: 'Every item presented',
      current: full.current,
      best: full.best,
      detail:
        full.current > 0
          ? `${full.current} consecutive visit${full.current === 1 ? '' : 's'} where nothing on the sheet went unmentioned.`
          : 'Present every ranked item on one visit to start a run.',
    },
    {
      key: 'easy-yes',
      label: 'Every easy-yes captured',
      current: easy.current,
      best: easy.best,
      detail:
        easy.current > 0
          ? `${easy.current} consecutive visit${easy.current === 1 ? '' : 's'} where every covered item was raised.`
          : 'Raise every covered item on one visit to start a run.',
    },
  ]
}
