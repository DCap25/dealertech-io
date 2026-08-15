import { describe, expect, it } from 'vitest'
import {
  checkOdometer, overrideSummary, validateOverride, type LastReading,
} from './check'

const last = (mileage: number): LastReading => ({
  mileage,
  recordedAt: new Date('2026-06-19T10:00:00'),
  source: 'WRITE_UP',
})

describe('checkOdometer', () => {
  it('passes a reading that moved forward', () => {
    expect(checkOdometer(92_000, last(91_710)).status).toBe('OK')
  })

  it('passes a reading identical to the last one', () => {
    // A vehicle towed in, or back the same day. Not movement backwards, so
    // there is nothing to explain.
    expect(checkOdometer(91_710, last(91_710)).status).toBe('OK')
  })

  it('passes when there is no history to compare against', () => {
    // First visit. Nothing is suspicious about a number we have never seen.
    expect(checkOdometer(50_000, null).status).toBe('OK')
  })

  it('flags a reading below the last recorded one', () => {
    const result = checkOdometer(91_000, last(91_710))
    expect(result.status).toBe('BELOW_LAST_READING')
    if (result.status !== 'BELOW_LAST_READING') return
    expect(result.shortfall).toBe(710)
    expect(result.headline).toContain('91,000')
    expect(result.headline).toContain('91,710')
  })

  it('calls a small shortfall minor and a large one major', () => {
    // Severity only sets the tone. Both still require confirming.
    const small = checkOdometer(91_610, last(91_710))
    const large = checkOdometer(80_000, last(91_710))
    expect(small.status === 'BELOW_LAST_READING' && small.severity).toBe('MINOR')
    expect(large.status === 'BELOW_LAST_READING' && large.severity).toBe('MAJOR')
  })

  it('spots a dropped trailing digit and says so', () => {
    // 91,710 typed as 9,171 — the single most common way this happens.
    const result = checkOdometer(9_171, last(91_710))
    expect(result.status).toBe('BELOW_LAST_READING')
    if (result.status !== 'BELOW_LAST_READING') return
    expect(result.likelyCause?.kind).toBe('DROPPED_DIGIT')
    expect(result.likelyCause?.message).toMatch(/last digit/)
  })

  it('spots a trip meter being read instead of the odometer', () => {
    const result = checkOdometer(347, last(91_710))
    expect(result.status).toBe('BELOW_LAST_READING')
    if (result.status !== 'BELOW_LAST_READING') return
    expect(result.likelyCause?.kind).toBe('TRIP_METER')
  })

  it('offers no guess when the number is just lower', () => {
    // Better to say nothing than to invent an explanation. A wrong guess sends
    // the advisor looking in the wrong place.
    const result = checkOdometer(85_000, last(91_710))
    expect(result.status).toBe('BELOW_LAST_READING')
    if (result.status !== 'BELOW_LAST_READING') return
    expect(result.likelyCause).toBeNull()
  })

  it('does not fire on a blank or nonsense entry', () => {
    // An empty odometer box is caught by the existing "enter the reading"
    // check. Raising a rollback warning for it would be noise on top of an
    // error the advisor is already being shown.
    expect(checkOdometer(0, last(91_710)).status).toBe('OK')
    expect(checkOdometer(Number.NaN, last(91_710)).status).toBe('OK')
  })
})

describe('validateOverride', () => {
  it('refuses to proceed with no confirmation at all', () => {
    expect(validateOverride(null).ok).toBe(false)
    expect(validateOverride({ reasonCode: '', note: '' }).ok).toBe(false)
  })

  it('refuses a reason it does not recognise', () => {
    // The client sends this; the server decides. A hand-rolled POST must not
    // be able to file an arbitrary string as a reason.
    expect(validateOverride({ reasonCode: 'BECAUSE_I_SAID_SO', note: '' }).ok).toBe(false)
  })

  it('accepts a listed reason on its own', () => {
    const result = validateOverride({ reasonCode: 'CLUSTER_REPLACED', note: '' })
    expect(result.ok).toBe(true)
  })

  it('refuses "something else" without saying what', () => {
    // A record that says only OTHER looks like diligence without carrying any.
    const result = validateOverride({ reasonCode: 'OTHER', note: '   ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not a record/)
  })

  it('accepts "something else" once it is explained', () => {
    const result = validateOverride({ reasonCode: 'OTHER', note: 'Cluster swapped by a prior owner.' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.note).toBe('Cluster swapped by a prior owner.')
  })
})

describe('overrideSummary', () => {
  it('records both numbers and the reason in one line', () => {
    const line = overrideSummary('CLUSTER_REPLACED', 'New cluster fitted at 40k.', 12_000, 91_710)
    expect(line).toContain('12,000')
    expect(line).toContain('91,710')
    expect(line).toContain('Instrument cluster has been replaced')
    expect(line).toContain('New cluster fitted at 40k.')
  })

  it('reads properly with no note', () => {
    expect(overrideSummary('PRIOR_ENTRY_WRONG', '', 91_000, 91_710)).toBe(
      'Accepted 91,000 against a previous 91,710 — The previous reading was recorded wrong.',
    )
  })
})
