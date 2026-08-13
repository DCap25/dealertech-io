/**
 * Vehicle systems — the top level of the component taxonomy.
 *
 * These are deliberately aligned with how OEM warranties and VSC tiers actually
 * carve up a vehicle, NOT with how a parts catalog does. A parts catalog cares
 * where a part lives; a coverage decision cares who pays for it.
 */

export const SYSTEMS = [
  'ENGINE',
  'TRANSMISSION',
  'DRIVETRAIN',
  'HYBRID_EV',
  'FUEL',
  'COOLING',
  'ELECTRICAL',
  'EXHAUST_EMISSIONS',
  'STEERING',
  'SUSPENSION',
  'BRAKES',
  'HVAC',
  'ELECTRONICS',
  'SAFETY_ADAS',
  'BODY_EXTERIOR',
  'BODY_INTERIOR',
  'GLASS',
  'TIRES_WHEELS',
  'MAINTENANCE',
] as const

export type System = (typeof SYSTEMS)[number]

export const SYSTEM_LABELS: Record<System, string> = {
  ENGINE: 'Engine',
  TRANSMISSION: 'Transmission',
  DRIVETRAIN: 'Drivetrain',
  HYBRID_EV: 'Hybrid / EV',
  FUEL: 'Fuel System',
  COOLING: 'Cooling System',
  ELECTRICAL: 'Electrical',
  EXHAUST_EMISSIONS: 'Exhaust & Emissions',
  STEERING: 'Steering',
  SUSPENSION: 'Suspension',
  BRAKES: 'Brakes',
  HVAC: 'Heating & Air Conditioning',
  ELECTRONICS: 'Electronics & Infotainment',
  SAFETY_ADAS: 'Safety & Driver Assistance',
  BODY_EXTERIOR: 'Body — Exterior',
  BODY_INTERIOR: 'Body — Interior',
  GLASS: 'Glass',
  TIRES_WHEELS: 'Tires & Wheels',
  MAINTENANCE: 'Maintenance',
}
