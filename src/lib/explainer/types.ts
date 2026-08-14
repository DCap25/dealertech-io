/**
 * Customer-facing service explainers.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE ALLOWED TO SAY
 * ---------------------------------------------------------------------------
 * An explainer describes the *mechanism* — what the part does, how it wears,
 * and what happens mechanically if it is left. It is general knowledge about
 * how cars work, not a claim about this customer's car.
 *
 * The one exception is a real measurement. When the technician wrote down 3mm
 * of pad or 4/32" of tread, plotting that number against the scale is both the
 * most persuasive thing on the screen and completely true. Everything else on
 * the diagram is the generic scale it is being plotted against.
 *
 * What they must never do is manufacture urgency. A cabin air filter is a
 * comfort item and the copy says so; an air filter does not meaningfully
 * change fuel economy and the copy says that too. A customer who catches one
 * exaggeration reasonably discounts the brake warning as well, and the brake
 * warning is the one that matters.
 */

/**
 * Diagram renderers, deliberately few.
 *
 * Fifteen bespoke animations would be fifteen things to maintain and would
 * drift apart visually. These six cover every component group the shop
 * actually sells, because the underlying physics repeats: things wear thin,
 * fluids degrade, passages clog, capacity fades, geometry drifts, gaps widen.
 */
export type DiagramKind =
  | 'LAYER_WEAR'
  | 'FLUID_LIFE'
  | 'FLOW_RESTRICTION'
  | 'CAPACITY_FADE'
  | 'GEOMETRY'
  | 'IGNITION'

export interface Scene {
  /** How long this beat holds. Total across scenes lands in the 10–30s brief. */
  holdMs: number
  /** One sentence. Read at arm's length, on a tablet, in a noisy drive lane. */
  caption: string
}

/**
 * The scale a measurement is plotted against.
 *
 * `fresh` is the part when new, `present` is where the industry recommends
 * raising it, `limit` is where it stops being serviceable or legal. All three
 * are properties of the part, not of this vehicle.
 */
export interface MeasurementScale {
  unit: string
  unitLabel: string
  fresh: number
  present: number
  limit: number
  /** What `limit` means, in words a customer can check. */
  limitMeans: string
}

export interface Explainer {
  /** Matches Opportunity.componentGroupKey. */
  key: string
  /** Neutral and descriptive. Not a sales headline. */
  title: string
  diagram: DiagramKind
  scenes: Scene[]
  /**
   * The mechanical consequence of waiting. Stated as cause and effect, with
   * no time pressure attached — "the rotor gets scored" rather than "act now".
   */
  ifIgnored: string
  /** Present only where a technician records a number for this group. */
  scale?: MeasurementScale
  /**
   * Said out loud when the honest answer is "this is comfort, not safety".
   * Rendered as prominently as the rest of the explainer.
   */
  candour?: string
}

/** A real reading for this vehicle, if the inspection captured one. */
export interface Reading {
  value: number
  unit: string
  /** LF / RF / LR / RR, when the measurement is per corner. */
  position: string | null
}
