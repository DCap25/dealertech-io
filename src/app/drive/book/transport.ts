/**
 * The `transport_type` enum, restated for the booking surface.
 *
 * Its own module because the action file is `'use server'` — every export from
 * one of those has to be an async function, so a constant the form and the
 * action both need cannot live there.
 *
 * Restated rather than derived from the Drizzle enum so the action can validate
 * a hand-posted value without importing the schema into anything that renders.
 * Anything unrecognised becomes a drop-off, which is the safe default: it
 * promises the customer nothing the store has not agreed to.
 */
export const TRANSPORT_TYPES = [
  'WAITER', 'DROP_OFF', 'LOANER', 'RENTAL', 'SHUTTLE', 'PICKUP_DELIVERY', 'TOW_IN',
] as const

export type TransportType = (typeof TRANSPORT_TYPES)[number]

export function transportFrom(raw: string): TransportType {
  return (TRANSPORT_TYPES as readonly string[]).includes(raw) ? (raw as TransportType) : 'DROP_OFF'
}
