import { describe, expect, it } from 'vitest'
import { buildBoard, type BoardInput, type ManagerRepairOrder } from './board'

const AS_OF = new Date('2026-08-12T12:00:00')
const PERIOD = {
  start: new Date('2026-08-10T00:00:00'),
  end: new Date('2026-08-17T00:00:00'),
  label: 'This week',
}

function ro(over: Partial<ManagerRepairOrder> = {}): ManagerRepairOrder {
  return {
    repairOrderId: 'ro-1',
    advisorId: 'marcus',
    closedAt: new Date('2026-08-11T10:00:00'),
    sold: 500,
    customerPay: 400,
    laborGross: 360,
    hoursSold: 2,
    ...over,
  }
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    advisors: [
      { advisorId: 'marcus', name: 'Marcus Reyes', role: 'ADVISOR' },
      { advisorId: 'dana', name: 'Dana Whitfield', role: 'ADVISOR' },
    ],
    appointments: [],
    repairOrders: [],
    followUps: [],
    period: PERIOD,
    asOf: AS_OF,
    ...over,
  }
}

describe('buildBoard — advisor rows', () => {
  it('attributes repair orders to the advisor who closed them', () => {
    const board = buildBoard(
      input({
        repairOrders: [
          ro({ repairOrderId: 'a', advisorId: 'marcus', sold: 600 }),
          ro({ repairOrderId: 'b', advisorId: 'dana', sold: 200 }),
        ],
      }),
    )
    expect(board.advisors.map((r) => [r.name, r.sold])).toEqual([
      ['Marcus Reyes', 600],
      ['Dana Whitfield', 200],
    ])
  })

  it('ranks by sold value, not alphabetically', () => {
    const board = buildBoard(
      input({
        repairOrders: [
          ro({ repairOrderId: 'a', advisorId: 'dana', sold: 900 }),
          ro({ repairOrderId: 'b', advisorId: 'marcus', sold: 100 }),
        ],
      }),
    )
    expect(board.advisors[0]?.name).toBe('Dana Whitfield')
  })

  it('lists an advisor with no closed work rather than dropping them', () => {
    // A quiet advisor is exactly who a manager is looking for. Omitting the
    // row would make them invisible on the one screen meant to surface them.
    const board = buildBoard(input({ repairOrders: [ro({ advisorId: 'marcus' })] }))
    const dana = board.advisors.find((r) => r.advisorId === 'dana')
    expect(dana).toBeDefined()
    expect(dana?.rosClosed).toBe(0)
    expect(dana?.averagePerRo).toBe(0)
  })

  it('leaves a manager who writes no repair orders off the table', () => {
    // Otherwise the person reading the board sits at the bottom of it on a
    // permanent line of zeros.
    const board = buildBoard(
      input({
        advisors: [
          { advisorId: 'marcus', name: 'Marcus Reyes', role: 'ADVISOR' },
          { advisorId: 'ray', name: 'Ray Delgado', role: 'SERVICE_MANAGER' },
        ],
        repairOrders: [ro({ advisorId: 'marcus' })],
      }),
    )
    expect(board.advisors.map((r) => r.advisorId)).toEqual(['marcus'])
  })

  it('gives a manager a row as soon as they do the work', () => {
    const board = buildBoard(
      input({
        advisors: [
          { advisorId: 'marcus', name: 'Marcus Reyes', role: 'ADVISOR' },
          { advisorId: 'ray', name: 'Ray Delgado', role: 'SERVICE_MANAGER' },
        ],
        repairOrders: [ro({ advisorId: 'ray', sold: 900 })],
      }),
    )
    expect(board.advisors.map((r) => r.advisorId)).toEqual(['ray', 'marcus'])
  })

  it('gives a manager a row for appointments alone, before anything closes', () => {
    const board = buildBoard(
      input({
        advisors: [{ advisorId: 'ray', name: 'Ray Delgado', role: 'SERVICE_MANAGER' }],
        appointments: [
          { advisorId: 'ray', scheduledAt: new Date('2026-08-12T08:00:00'), status: 'ARRIVED' },
        ],
      }),
    )
    expect(board.advisors).toHaveLength(1)
  })

  it('ignores repair orders closed outside the period', () => {
    const board = buildBoard(
      input({
        repairOrders: [
          ro({ repairOrderId: 'in', closedAt: new Date('2026-08-11T09:00:00') }),
          ro({ repairOrderId: 'before', closedAt: new Date('2026-08-09T09:00:00') }),
          ro({ repairOrderId: 'after', closedAt: new Date('2026-08-18T09:00:00') }),
        ],
      }),
    )
    expect(board.department.rosClosed).toBe(1)
  })

  it('averages per repair order, not per line', () => {
    const board = buildBoard(
      input({
        repairOrders: [
          ro({ repairOrderId: 'a', sold: 1000 }),
          ro({ repairOrderId: 'b', sold: 200 }),
        ],
      }),
    )
    expect(board.department.averagePerRo).toBe(600)
  })
})

describe('buildBoard — covered revenue', () => {
  it('is the gap between the ticket and what the customer paid', () => {
    const board = buildBoard(input({ repairOrders: [ro({ sold: 500, customerPay: 120 })] }))
    expect(board.department.covered).toBe(380)
  })

  it('never goes negative when a customer paid more than the ticket', () => {
    // A rounding or import error should not print a negative saving on a
    // manager's screen; it should print nothing.
    const board = buildBoard(input({ repairOrders: [ro({ sold: 100, customerPay: 150 })] }))
    expect(board.department.covered).toBe(0)
  })
})

describe('buildBoard — effective labor rate', () => {
  it('divides labor gross by hours sold', () => {
    const board = buildBoard(input({ repairOrders: [ro({ laborGross: 370, hoursSold: 2 })] }))
    expect(board.department.effectiveLaborRate).toBe(185)
  })

  it('reports null rather than a fantasy rate on a fraction of an hour', () => {
    const board = buildBoard(input({ repairOrders: [ro({ laborGross: 90, hoursSold: 0.2 })] }))
    expect(board.department.effectiveLaborRate).toBeNull()
  })

  it('reports null when no hours were sold at all', () => {
    const board = buildBoard(input({ repairOrders: [] }))
    expect(board.department.effectiveLaborRate).toBeNull()
  })
})

describe('buildBoard — today’s drive', () => {
  const appointments = [
    { advisorId: 'marcus', scheduledAt: new Date('2026-08-12T08:00:00'), status: 'ARRIVED' },
    { advisorId: 'marcus', scheduledAt: new Date('2026-08-12T09:00:00'), status: 'SCHEDULED' },
    { advisorId: null, scheduledAt: new Date('2026-08-12T10:00:00'), status: 'SCHEDULED' },
    { advisorId: 'dana', scheduledAt: new Date('2026-08-13T08:00:00'), status: 'SCHEDULED' },
  ]

  it('counts only today', () => {
    const board = buildBoard(input({ appointments }))
    expect(board.drive.total).toBe(3)
  })

  it('surfaces appointments nobody owns', () => {
    const board = buildBoard(input({ appointments }))
    expect(board.drive.unassigned).toBe(1)
  })

  it('separates cars in the shop from cars still to come', () => {
    const board = buildBoard(input({ appointments }))
    expect(board.drive.active).toBe(1)
    expect(board.drive.notArrived).toBe(2)
  })

  it('counts a nulled advisor against nobody’s row', () => {
    const board = buildBoard(input({ appointments }))
    const total = board.advisors.reduce((sum, r) => sum + r.appointmentsToday, 0)
    expect(total).toBe(2)
  })
})

describe('buildBoard — backlog', () => {
  const followUps = [
    { ownerRole: 'BDC' as const, trigger: 'DECLINED_SERVICE_FOLLOW_UP', dueAt: new Date('2026-06-01T09:00:00'), estimatedValue: 600 },
    { ownerRole: 'ADVISOR' as const, trigger: 'CSI_PRE_EMPTION', dueAt: new Date('2026-08-12T09:00:00'), estimatedValue: 0 },
    { ownerRole: 'ADVISOR' as const, trigger: 'WARRANTY_EXPIRING', dueAt: new Date('2026-08-20T09:00:00'), estimatedValue: 2400 },
  ]

  it('counts overdue against asOf, never the wall clock', () => {
    const board = buildBoard(input({ followUps }))
    expect(board.backlog.overdue).toBe(1)
    expect(board.backlog.worstOverdueDays).toBe(72)
  })

  it('counts something due today as due, not as overdue', () => {
    // The 09:00 task is earlier than the 12:00 asOf, but a task due today is
    // still workable today — calling it late would put the whole drive in red
    // every morning.
    const board = buildBoard(input({ followUps }))
    expect(board.backlog.dueToday).toBe(1)
  })

  it('splits by who owns the call', () => {
    const board = buildBoard(input({ followUps }))
    expect(board.backlog.byOwner).toEqual({ ADVISOR: 2, BDC: 1 })
  })

  it('totals the money sitting in the list', () => {
    const board = buildBoard(input({ followUps }))
    expect(board.backlog.value).toBe(3000)
  })

  it('reports zero days overdue when nothing is late', () => {
    const board = buildBoard(input({ followUps: [followUps[2]!] }))
    expect(board.backlog.worstOverdueDays).toBe(0)
  })
})

describe('buildBoard — trend', () => {
  it('compares sold value against the previous window', () => {
    const board = buildBoard(
      input({
        repairOrders: [ro({ sold: 1500 })],
        previousRepairOrders: [ro({ sold: 1000, closedAt: new Date('2026-08-04T10:00:00') })],
      }),
    )
    expect(board.department.soldChangePercent).toBe(50)
  })

  it('is null when there is nothing to compare against', () => {
    // Not zero. "Flat" and "no basis" are different facts and a manager will
    // read a flat arrow as a real result.
    const board = buildBoard(input({ repairOrders: [ro()], previousRepairOrders: [] }))
    expect(board.department.soldChangePercent).toBeNull()
  })
})

describe('buildAttention', () => {
  it('flags unassigned appointments first', () => {
    const board = buildBoard(
      input({
        appointments: [
          { advisorId: null, scheduledAt: new Date('2026-08-12T08:00:00'), status: 'SCHEDULED' },
        ],
      }),
    )
    expect(board.attention[0]).toMatchObject({ key: 'unassigned', tone: 'ALERT' })
  })

  it('escalates a month-old follow-up above a merely late one', () => {
    const late = buildBoard(
      input({
        followUps: [
          { ownerRole: 'BDC', trigger: 'X', dueAt: new Date('2026-08-09T09:00:00'), estimatedValue: 0 },
        ],
      }),
    )
    const ancient = buildBoard(
      input({
        followUps: [
          { ownerRole: 'BDC', trigger: 'X', dueAt: new Date('2026-05-09T09:00:00'), estimatedValue: 0 },
        ],
      }),
    )
    expect(late.attention.find((a) => a.key === 'overdue-backlog')?.tone).toBe('WATCH')
    expect(ancient.attention.find((a) => a.key === 'overdue-backlog')?.tone).toBe('ALERT')
  })

  it('will not call out a lagging advisor on a thin sample', () => {
    // Four repair orders each. One transmission job is the whole gap.
    const board = buildBoard(
      input({
        repairOrders: [
          ...[1, 2, 3, 4].map((i) => ro({ repairOrderId: `m${i}`, advisorId: 'marcus', sold: 2000 })),
          ...[1, 2, 3, 4].map((i) => ro({ repairOrderId: `d${i}`, advisorId: 'dana', sold: 100 })),
        ],
      }),
    )
    expect(board.attention.some((a) => a.key.startsWith('lagging-'))).toBe(false)
  })

  it('calls out a lagging advisor once the sample supports it', () => {
    const board = buildBoard(
      input({
        repairOrders: [
          ...[1, 2, 3, 4, 5].map((i) => ro({ repairOrderId: `m${i}`, advisorId: 'marcus', sold: 2000 })),
          ...[1, 2, 3, 4, 5].map((i) => ro({ repairOrderId: `d${i}`, advisorId: 'dana', sold: 100 })),
        ],
      }),
    )
    const item = board.attention.find((a) => a.key === 'lagging-dana')
    expect(item?.tone).toBe('WATCH')
    // Phrased as a question about tickets, not a judgement about the person.
    expect(item?.detail).toContain('compares tickets, not effort')
  })

  it('says nothing about a lagging advisor when only one has a real sample', () => {
    const board = buildBoard(
      input({
        repairOrders: [1, 2, 3, 4, 5].map((i) =>
          ro({ repairOrderId: `m${i}`, advisorId: 'marcus', sold: 100 }),
        ),
      }),
    )
    expect(board.attention.some((a) => a.key.startsWith('lagging-'))).toBe(false)
  })

  it('explains an empty window instead of showing a silent wall of zeros', () => {
    const board = buildBoard(input())
    expect(board.attention.some((a) => a.key === 'no-ros')).toBe(true)
  })

  it('reports covered revenue as a win', () => {
    const board = buildBoard(input({ repairOrders: [ro({ sold: 500, customerPay: 100 })] }))
    expect(board.attention.find((a) => a.key === 'covered')?.tone).toBe('GOOD')
  })
})
