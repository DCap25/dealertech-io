import { canManageStaff } from '@/lib/team/roster'
import { salesHome } from '@/lib/auth/routes'
import type { StaffRole } from '@/lib/auth/active-store'

/**
 * The Co-Pilot's second competence: how DealerTech itself works.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SOURCE CODE AND NOT A MARKDOWN FILE
 * ---------------------------------------------------------------------------
 * The obvious implementation is "read PROJECT_OVERVIEW.md at runtime". It is
 * wrong three times over. Those documents are written for whoever is building
 * the product — they carry migration numbers, known gaps, credential rotation
 * and an open-questions list — and none of that is an answer to "how do I send
 * the menu to their phone". They also change for reasons that have nothing to
 * do with the product a user sees, and a deploy artefact that reads repo
 * markdown is a deploy artefact that ships whatever somebody last typed into a
 * scoping note.
 *
 * So this is a hand-written product guide in the product's own voice, checked
 * in beside the code it describes.
 *
 * ---------------------------------------------------------------------------
 * KEEPING IT TRUE — THIS IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * **When a surface is added, moved, renamed, or has its guard changed, this
 * file must be updated in the same commit.** A guide that describes a button
 * that is not there is worse than no guide: the user goes looking, does not
 * find it, and stops believing the next answer too.
 *
 * `SURFACES` is keyed by route path, and `copilot.test.ts` walks the `src/app`
 * route tree and fails when a page has no entry here. That test is the
 * mechanism; this paragraph is only the reason.
 *
 * ---------------------------------------------------------------------------
 * ROLE SLICING
 * ---------------------------------------------------------------------------
 * `buildAppGuide` returns what the asker can actually reach, because the fences
 * are real: `fenceSales` redirects a salesperson out of fifteen pages, the
 * manager pages `notFound()` at everybody else, and `/admin` 404s at anyone who
 * is not DealerTech staff. Telling a salesperson how to work the drive would be
 * coaching them into a redirect — the same broken promise `WorkspaceNav`
 * refuses to make by not showing them the link.
 *
 * What they cannot reach is named — as names only, never as instructions — so
 * an honest "that one isn't yours, here is what is" is available to the model
 * without the guide handing over a walkthrough of a fenced screen.
 *
 * Pure and I/O-free. No customer ever appears in here; the grounding this file
 * produces contains the product, the role and at most the store's name.
 */

/** Who can open a thing. Matches the guards the pages actually run. */
export type GuideAudience =
  /** Every signed-in dealership role, `SALES` included. */
  | 'EVERYONE'
  /** Everybody except `SALES` — i.e. anything behind `fenceSales`. */
  | 'SERVICE'
  /** `canManageStaff`: service manager, fixed ops director, administrator. */
  | 'MANAGER'
  /** DealerTech staff. Not a dealership role at all. */
  | 'PLATFORM'

export interface GuideSurface {
  /**
   * The route path, exactly as the App Router names it.
   *
   * Doubles as the key, which is what lets the completeness test tie this list
   * to the file tree mechanically rather than by somebody remembering.
   */
  path: string
  name: string
  /** One or two sentences: what this screen is for. */
  purpose: string
  /** The things a person actually does on it. */
  does: string[]
  audience: GuideAudience
  /**
   * A screen a customer holds, described here so an advisor can be told what
   * the person on the other end is looking at. Staff never open these, and the
   * Co-Pilot is never mounted on them.
   */
  customerFacing?: true
}

export interface GuideWorkflow {
  name: string
  steps: string[]
  audience: GuideAudience
}

export interface GuidePrinciple {
  name: string
  detail: string
}

export interface AppGuide {
  role: StaffRole
  roleLabel: string
  isPlatformAdmin: boolean
  /** One sentence about how much of the product this person has. */
  reach: string
  surfaces: GuideSurface[]
  workflows: GuideWorkflow[]
  principles: GuidePrinciple[]
  /**
   * Screens this person cannot open, by name only.
   *
   * Deliberately not a description. It exists so the answer to "how do I see
   * the drive" from a salesperson is "that is the service department's, yours
   * is the introduction page" rather than a walkthrough of a redirect.
   */
  outOfReach: string[]
}

/* ------------------------------------------------------------------ surfaces */

/**
 * Every authenticated surface in the product, keyed by route.
 *
 * Order is the order a person meets them: the day, the visit, the customer,
 * the record, then the administration. `renderAppGuide` prints them in this
 * order, so it is also the order the model reads.
 */
export const SURFACES: GuideSurface[] = [
  /* ------------------------------------------------------------ the day */
  {
    path: '/drive',
    name: 'Today’s drive',
    purpose:
      'The day’s appointments, ranked, with a prep sheet waiting behind each one. This is where an advisor starts the morning.',
    does: [
      'See every car coming in today, ordered by what is worth the most attention.',
      'Open any appointment to its prep sheet.',
      'Look at another day with the date arrows — the drive renders any single day, not only today.',
      'Book a new appointment; the button carries the day being viewed, so a walk-in on Thursday’s drive books onto Thursday.',
      'What you see is your own book plus the unassigned pool — appointments nobody has claimed yet.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/drive/week',
    name: 'The week',
    purpose:
      'Seven days at once. The same appointments as the drive, read as load rather than as a worklist.',
    does: [
      'Toggle Mine / Everyone. Mine is your book; Everyone is one column per advisor, plus the unassigned pool.',
      'See at a glance which books are full and which are empty — that is what the Everyone view is for.',
      'The toggle is a filter, not a permission: any advisor may look at the store’s week. Changing somebody else’s assignment is manager-only.',
      'Open a day or a card to go on into the drive and the prep sheet.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/drive/book',
    name: 'Book an appointment',
    purpose:
      'The one booking form every role uses. Find or create the customer and vehicle, pick a day and a slot, and put it in an advisor’s book.',
    does: [
      'Search for the customer, or add a new one with their vehicle.',
      'Pick a day and a slot. Slots are painted with how loaded they already are.',
      'Set transport type — waiter, loaner, shuttle — and type the customer’s concern in their own words.',
      'Assign an advisor, or leave it unassigned for whoever claims it at arrival.',
      'Capacity warns, it never blocks: "Marcus is at 4 of 4" is a sentence for the booker, not a refusal.',
      'Outside store hours is the one hard stop, and a manager can override it — tow-ins happen.',
      'An appointment booked here is in DealerTech, not in the DMS. It reaches the DMS with the hand-off when the visit is written up.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/drive/[appointmentId]',
    name: 'The prep sheet',
    purpose:
      'The core screen of the product: one visit, in full, before the conversation starts. Coverage the customer already owns, what the vehicle needs, and what to say about it.',
    does: [
      'Read the coverage stack — factory warranty and purchased contracts, with the engine’s reasoning behind each ring.',
      'Read the ownership row: what this customer has already paid for, which is the strongest opener in the business.',
      'Work the ranked opportunities. Each card carries the detail, who likely pays, what the customer owes, and a talk track.',
      'Answer each one: accepted, declined, call me about this, or skipped. Totals move as you go.',
      'Open the visit card for last visit, next visit and open threads — the ninety-second version of the customer’s history.',
      'Show a wear explainer — an animation of what 3mm of pad means — next to this vehicle’s own measurement.',
      'Build the menu (see the workflow), then present it, hand a tablet over, send a link, or print it.',
      'Hand off to the DMS: a clean block to paste, plus a push of whatever the store’s adapter genuinely supports.',
      'Ask the visit Co-Pilot — the ✦ button on this screen — about this customer, their coverage, what to present next, or how to answer an objection.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/advisor',
    name: 'My day',
    purpose: 'The advisor’s own view of the day they are working.',
    does: [
      'See your appointments and where each one has got to.',
      'Jump into the write-up or the repair order for anything in progress.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/advisor/write-up/[appointmentId]',
    name: 'Write-up',
    purpose: 'Start the visit: turn an appointment into a repair order.',
    does: [
      'Confirm the customer, the vehicle and the mileage on arrival.',
      'Capture the concern in the customer’s words — it is never overwritten later.',
      'Open the repair order and carry the prep sheet’s findings into it.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/advisor/ro/[roId]',
    name: 'Repair order',
    purpose: 'Work an open repair order through to delivery.',
    does: [
      'See the lines on the RO and what has been authorised.',
      'Close the visit and record the outcome of every opportunity that was presented.',
      'Closing is what settles declines and starts the follow-up clock on anything not done today.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/advisor/scorecard',
    name: 'My scorecard',
    purpose:
      'Your own numbers, with the arithmetic explained beside each one rather than left to be guessed at.',
    does: [
      'See presentation rate, close rate, gross and the streaks behind them.',
      'Read the explanation under each metric — every figure says how it was worked out.',
      'It is yours. Nobody else’s numbers appear here; the department board is the manager’s view.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/follow-up',
    name: 'Follow-ups',
    purpose:
      'Declined work and scheduled cadence tasks, per vehicle. The reason a "not today" does not become a never.',
    does: [
      'Work the list of jobs a customer declined, re-priced and ranked by what they are worth.',
      'See cadence tasks the retention engine has raised — a service due, a contract expiring.',
      'A "call me about this" leads the list and never collapses into a decline. It is the highest-intent answer a customer gives.',
      'Filter by owner — the BDC desk is this page with `?owner=BDC`, which is exactly where /bdc sends you.',
      'Book from a follow-up, and the booking is tied back to the task that produced it.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/bdc',
    name: 'BDC desk',
    purpose:
      'The outbound desk. Not a page of its own — it opens the follow-up list filtered to BDC-owned work.',
    does: ['Go here and you land on /follow-up with the BDC owner filter already applied.'],
    audience: 'SERVICE',
  },

  /* ------------------------------------------------ customers and vehicles */
  {
    path: '/customers',
    name: 'Customers',
    purpose: 'Every customer of this store, searchable.',
    does: [
      'Search by name, phone or email.',
      'Open one for the full record and their history.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/customers/[customerId]',
    name: 'A customer’s record',
    purpose:
      'One customer, their vehicles, and the whole relationship as a single story rather than seven tables.',
    does: [
      'Read the timeline: appointments booked, kept and missed; menus presented and what was answered; repair orders opened and closed; work declined and whether it was ever resurfaced; hand-offs; calls; cadence tasks; notes; odometer readings.',
      'See open threads — the things still hanging, led by anything they asked to be called about.',
      'See who their advisor is, and since when.',
      'Jump to any of their vehicles.',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/vehicles/[vehicleId]',
    name: 'A vehicle’s record',
    purpose:
      'One car: what covers it, what has been done to it, and what it is going to need.',
    does: [
      'See factory warranty and every purchased contract, with the coverage engine’s reasoning.',
      'Read the same timeline as the customer record, narrowed to this vehicle.',
      'See the odometer trail — and any rollback the odometer engine has flagged.',
      'Add coverage the store holds on paper (see below).',
    ],
    audience: 'SERVICE',
  },
  {
    path: '/vehicles/[vehicleId]/contract',
    name: 'Upload a service agreement',
    purpose:
      'Get a service contract the customer owns into the system when the only copy is a PDF in their email or a piece of paper in the glovebox.',
    does: [
      'Upload the contract as a PDF, or a photo of it.',
      'A model reads the details off it; check them before saving — nothing is trusted blind.',
      'Saved coverage is marked as read from a document and stays unverified until somebody confirms it with the administrator.',
      'Once saved, the coverage engine uses it on every future visit, which is where it starts paying off.',
    ],
    audience: 'SERVICE',
  },

  /* ------------------------------------------------------------- delivery */
  {
    path: '/introduce',
    name: 'Introduce a customer to service',
    purpose:
      'The delivery introduction: a customer who has just bought a car is walked to the service drive and leaves with their first visit booked. It is the highest-leverage retention moment a dealership owns.',
    does: [
      'Search for the buyer, or enter a first-time buyer’s details with the vehicle.',
      'Pick the day. The suggested day comes from the maintenance interval, not from a guess.',
      'Name the advisor you walked them over to — that becomes their advisor, recorded as a real request rather than a routing accident.',
      'Book it. The visit lands on the drive marked as a first service, and the prep sheet treats it accordingly.',
      'For a salesperson this is the whole product. For everybody else it is one page among many.',
    ],
    audience: 'EVERYONE',
  },

  /* ------------------------------------------------------------- devices */
  {
    path: '/devices',
    name: 'Tablets',
    purpose: 'The tablets this store has paired, and what they are doing.',
    does: [
      'Pair a new tablet: open /present on the device, and claim the code it shows here.',
      'See every paired tablet and when it was last seen.',
      'A tablet with nothing pushed to it shows its own name and nothing else — no customer, no prices.',
    ],
    audience: 'SERVICE',
  },

  /* -------------------------------------------------- what the customer sees */
  {
    path: '/present',
    name: 'The customer tablet',
    purpose:
      'What the paired tablet shows. Staff never open this — it is opened once on the device and left there — but it is what the customer is holding.',
    does: [
      'Idle, it shows the tablet’s own name and a pairing code. Nothing about any customer.',
      'Presented (you are standing next to it): the menu, with no submit button — the conversation ends when you take it back.',
      'Handed over (they work through it alone): the same menu plus a confirm bar, so they can finish it themselves.',
      'Either way you watch their taps land on your own screen while the session is live, and "take it back" ends it.',
      'A session nobody touches for thirty minutes ends itself and the tablet goes idle.',
    ],
    audience: 'SERVICE',
    customerFacing: true,
  },
  {
    path: '/m/[token]',
    name: 'The menu link on the customer’s phone',
    purpose:
      'The same menu, on the customer’s own phone, after the technician has been under the car. This is where most of the money on a repair order is won or lost, because by then they are at work.',
    does: [
      'They open a link with a 32-byte token in it. No account, no password.',
      'It expires twelve hours after you send it, and it is scoped to that one visit.',
      'They answer each item — Not today · Call me about this · Yes — with a wear explainer available before they choose.',
      'A confirm bar tracks "3 of 7 answered" and the authorised total, and they type their name to send it.',
      'They can send it with nothing accepted. "No thank you, none of it" is a complete answer and you are better off hearing it at eleven than at four.',
      'Answers land on your prep sheet when it loads and again whenever you come back to the tab. The link is not polled; a customer may answer at lunchtime.',
      'Once sent, or once expired, the page says so plainly and stops taking taps.',
      'The link is delivered by copy and paste. DealerTech does not send text messages.',
    ],
    audience: 'SERVICE',
    customerFacing: true,
  },

  /* ------------------------------------------------------------- managers */
  {
    path: '/manager',
    name: 'The department',
    purpose:
      'The service manager’s board: how the department is doing, and which advisor needs what.',
    does: [
      'See the department’s numbers and each advisor’s alongside them.',
      'Spot the work not being followed up and the books filling unevenly.',
      'Manager-only. An advisor has no link to it and gets a 404 if they find the URL.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/team',
    name: 'Who works here',
    purpose: 'The roster: everybody with access to this store’s customers and vehicles.',
    does: [
      'Invite somebody. They get a link that grants exactly the role you named.',
      'Change a role, remove somebody, or restore them.',
      'Removing deactivates the membership and never deletes the person — they still wrote February’s repair orders.',
      'You cannot remove or demote the last manager. That is the lockout the guard exists to prevent.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/import',
    name: 'Import your history',
    purpose:
      'Bring the store’s existing history across. Prep sheets are built from what a vehicle has already been through, so this is what makes the first morning worth having.',
    does: [
      'Upload the export from your DMS and map the columns.',
      'Declined work comes across as ranked, re-priced opportunities — every job the store quoted and never chased.',
      'It stays available permanently. A group adds a rooftop, or re-exports a longer date range; this is not a one-off setup step.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/setup',
    name: 'Setup',
    purpose: 'What this store still needs before the product is working properly.',
    does: [
      'Work the checklist: op-code price book, store hours and scheduling rules, staff, tablets, history.',
      'Every step is derived from live data, so a step can come back — delete your op codes and the pricing step is outstanding again.',
      'It stays listed even when everything is green, for exactly that reason.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/billing',
    name: 'Billing',
    purpose: 'What the dealership pays, and the state of the subscription.',
    does: [
      'See the plan, the current period and the invoices.',
      'Update the card, and see what a failed payment has and has not affected.',
      'A billing problem never breaks the drive. Only administrative actions are gated.',
      'Manager-only on purpose: an advisor has no business seeing what the store pays.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/signup',
    name: 'Start a trial',
    purpose:
      'How a dealership that does not have DealerTech yet gets an account. It creates a brand-new organisation — it is not how you add a person or a rooftop to one that exists.',
    does: [
      'To add a person to this store, use the roster. To add a rooftop to an existing group, DealerTech provisions it.',
    ],
    audience: 'MANAGER',
  },
  {
    path: '/invite/[token]',
    name: 'An invitation',
    purpose:
      'The page somebody opens when a manager invites them. It is how nearly everybody here got their account.',
    does: [
      'The link grants exactly the role named when it was issued, at exactly one store.',
      'It is a one-time token — if it has been used or has expired, ask for another.',
      'Opening it sets a password and signs the person in for the first time.',
    ],
    audience: 'EVERYONE',
  },

  /* ------------------------------------------------------------- platform */
  {
    path: '/admin',
    name: 'Operations console',
    purpose:
      'DealerTech’s own console, not a dealership screen. The morning read: what needs attention across every tenant.',
    does: [
      'Rollup of failing syncs, stalled trials and accounts needing action.',
      'Reachable only by DealerTech staff. Everybody else gets a 404, so it does not announce itself.',
    ],
    audience: 'PLATFORM',
  },
  {
    path: '/admin/tenants',
    name: 'Dealerships',
    purpose: 'Every dealer group on the platform and what state it is in.',
    does: ['Find a group, see its lifecycle status, and open it in full.'],
    audience: 'PLATFORM',
  },
  {
    path: '/admin/tenants/[orgId]',
    name: 'One dealer group',
    purpose: 'A single tenant in full, with every commercial action on it.',
    does: [
      'Stores, staff counts, subscription state and sync health.',
      'Provision, comp, suspend and cancel — all recorded.',
    ],
    audience: 'PLATFORM',
  },
  {
    path: '/admin/leads',
    name: 'Leads',
    purpose: 'Inbound demo requests and what was said on the call.',
    does: ['Read a lead, record the call, and move it along.'],
    audience: 'PLATFORM',
  },
]

/* ----------------------------------------------------------------- workflows */

export const WORKFLOWS: GuideWorkflow[] = [
  {
    name: 'Present a menu and get an answer',
    audience: 'SERVICE',
    steps: [
      'Open the prep sheet from the drive.',
      'Work down the ranked opportunities, answering the ones you have already discussed.',
      'Tap Build the menu. It opens with everything already selected, so if you are in a hurry you can tap straight through.',
      'Take off anything that does not belong in this conversation. You can reorder items inside a tier; you cannot move one into a higher tier.',
      'Choose how they see it: turn your own screen around, hand a paired tablet over, send a link to their phone, or print it.',
      'Their answers come back onto the prep sheet, marked as theirs rather than yours.',
    ],
  },
  {
    name: 'Hand the tablet over',
    audience: 'SERVICE',
    steps: [
      'Build the menu first — the tablet only ever shows a menu you sent it.',
      'Choose the paired tablet and send it, then choose whether you are presenting it or handing it over.',
      'Presenting: you stay beside them and there is no submit button; the conversation ends when you take it back.',
      'Handing over: they work down the list alone and finish it themselves with the confirm bar, like a questionnaire in a waiting room.',
      'Either way you watch the taps land on your own screen. "Take it back" ends the session and the tablet goes blank.',
      'If nobody touches it for thirty minutes the server ends the session and the tablet goes idle by itself.',
    ],
  },
  {
    name: 'Send the menu to their phone',
    audience: 'SERVICE',
    steps: [
      'Build the menu, then choose the link.',
      'Copy the link and send it however you already talk to that customer. DealerTech does not send texts.',
      'The link lasts twelve hours and covers this visit only.',
      'Do not wait on the screen — they may answer in ten minutes or at lunchtime. Their answers appear on the prep sheet next time it loads.',
      'A "call me about this" is the one to act on first. It is the highest-intent answer there is.',
    ],
  },
  {
    name: 'Hand the visit off to the DMS',
    audience: 'SERVICE',
    steps: [
      'Finish the visit on the prep sheet — every item answered.',
      'Open the hand-off panel. It builds a clean block naming what was accepted, what was declined, and who chose.',
      'Copy and paste it into the RO, or push it if your store’s DMS connection supports one — the panel says which it did.',
      'DealerTech does not write the repair order. The DMS stays the system of record; this is the twenty seconds of keying made fast and correct.',
    ],
  },
  {
    name: 'Book an appointment',
    audience: 'SERVICE',
    steps: [
      'Open Book an appointment from the drive, a follow-up, or a customer record.',
      'Find the customer or add them, with the vehicle.',
      'Pick a day and a slot. Slot load is painted on; a full slot warns and still lets you book.',
      'Set the transport type and type their concern in their own words.',
      'Assign an advisor — theirs if they have one — or leave it for whoever claims it.',
    ],
  },
  {
    name: 'The delivery introduction',
    audience: 'EVERYONE',
    steps: [
      'Open Introduce a customer to service while the buyer is still in the building with the keys in their hand.',
      'Find them or enter their details and the car they just bought.',
      'Take the suggested day unless you have a reason not to — it comes from the maintenance interval for that vehicle.',
      'Name the advisor you are walking them over to and introduce them by name.',
      'Book it. It shows on the drive as a first service, and the advisor sees the coverage that was sold with the car.',
    ],
  },
  {
    name: 'Follow up on declined work',
    audience: 'SERVICE',
    steps: [
      'Open Follow-ups. Anything a customer asked to be called about is at the top.',
      'Prices are re-checked against today’s book before you quote them.',
      'Ring them, record what was said, and book it if they say yes.',
      'The booking is tied back to the task, which is how the store finds out whether following up works.',
    ],
  },
  {
    name: 'Add somebody to the store',
    audience: 'MANAGER',
    steps: [
      'Open Who works here and invite them, choosing the role at the same time.',
      'Send them the link. It grants that role and nothing else.',
      'Change or remove a role from the same page. The last manager cannot remove or demote themselves.',
    ],
  },
]

/* ---------------------------------------------------------------- principles */

export const PRINCIPLES: GuidePrinciple[] = [
  {
    name: 'Prices come from the store’s own book',
    detail:
      'Menu prices resolve from this store’s op-code price book, synced from the DMS every morning. Where no op code matches, the customer sees "Price to be confirmed" and the item is left out of every total. We would rather show nothing than a number the invoice will not honour.',
  },
  {
    name: 'A preference is not an authorization',
    detail:
      'A customer tapping Yes records what they want. The advisor still authorises the work the way they always have. Nothing a customer taps starts a job.',
  },
  {
    name: 'Tier comes from measurement, never from a choice',
    detail:
      'An advisor can include an item, exclude it, or reorder it within its tier. Nobody can promote something into "Needs attention now" — if they could, the tier would stop meaning anything and the customer would be right to stop believing it.',
  },
  {
    name: 'We advise; we do not adjudicate',
    detail:
      'Every coverage determination carries the engine’s reasoning and a confidence that only ever downgrades. The administrator or the manufacturer decides claims, not us — so never promise a customer that something will be covered.',
  },
  {
    name: 'The DMS is the system of record',
    detail:
      'DealerTech is the advisor’s daily workspace. The DMS keeps the repair order, the parts and the invoicing. We hand work back to it in a form it accepts rather than trying to replace it.',
  },
  {
    name: 'Turn the tablet around',
    detail:
      'Every customer-facing screen is built so it can be handed to the customer mid-conversation with nothing on it needing to be explained away. That is the whole bet of the product.',
  },
]

/* ------------------------------------------------------------------- slicing */

const ROLE_LABEL: Record<StaffRole, string> = {
  ADVISOR: 'service advisor',
  BDC: 'BDC agent',
  TECHNICIAN: 'technician',
  DISPATCHER: 'dispatcher',
  PARTS: 'parts counter',
  CASHIER: 'cashier',
  SERVICE_MANAGER: 'service manager',
  FIXED_OPS_DIRECTOR: 'fixed operations director',
  ADMIN: 'store administrator',
  SALES: 'salesperson',
}

/** The same predicate the fence uses, so the guide and the redirect agree. */
function isSales(role: StaffRole): boolean {
  return salesHome(role) !== null
}

/** Can this role open a thing with this audience? */
export function reaches(
  audience: GuideAudience,
  role: StaffRole,
  isPlatformAdmin: boolean,
): boolean {
  switch (audience) {
    case 'EVERYONE':
      return true
    case 'SERVICE':
      return !isSales(role)
    case 'MANAGER':
      return canManageStaff(role)
    case 'PLATFORM':
      return isPlatformAdmin
  }
}

function reachSentence(role: StaffRole, isPlatformAdmin: boolean): string {
  const platform = isPlatformAdmin
    ? ' They are also DealerTech staff, so the operations console at /admin is theirs as well.'
    : ''

  if (isSales(role)) {
    return (
      'They can reach exactly one page: the delivery introduction. Every other screen belongs to the service department, and the product sends them back to /introduce if they try one.' +
      platform
    )
  }
  if (canManageStaff(role)) {
    return (
      'They can reach every advisor surface, plus the department board, the roster, import, setup and billing.' +
      platform
    )
  }
  return (
    'They can reach every advisor surface. The department board, the roster, import, setup and billing are manager-only and they have no link to any of them.' +
    platform
  )
}

/**
 * The guide, sliced to what this person can actually reach.
 *
 * `isPlatformAdmin` is separate from the role because it is not a dealership
 * role at all — it is DealerTech staff, and a person can be both.
 */
export function buildAppGuide(
  role: StaffRole,
  options: { isPlatformAdmin?: boolean } = {},
): AppGuide {
  const isPlatformAdmin = options.isPlatformAdmin ?? false
  const can = (audience: GuideAudience) => reaches(audience, role, isPlatformAdmin)

  return {
    role,
    roleLabel: ROLE_LABEL[role],
    isPlatformAdmin,
    reach: reachSentence(role, isPlatformAdmin),
    surfaces: SURFACES.filter((s) => can(s.audience)),
    workflows: WORKFLOWS.filter((w) => can(w.audience)),
    // Principles are the product's word to everybody, including the sales
    // floor: "a preference is not an authorization" is exactly the sentence a
    // salesperson booking a first service should also have heard.
    principles: PRINCIPLES,
    outOfReach: SURFACES.filter((s) => !can(s.audience)).map((s) => s.name),
  }
}

/* ----------------------------------------------------------------- rendering */

/**
 * Render the guide as the grounding block that goes in the prompt.
 *
 * Plain text for the same reason `renderContext` is: it costs fewer tokens and
 * the model quotes a plain line back more reliably than a nested key. Byte-
 * identical for every question a given role asks, so it caches across a whole
 * shift of them.
 */
export function renderAppGuide(guide: AppGuide, storeName?: string): string {
  const lines: string[] = []

  lines.push('## What DealerTech is')
  lines.push(
    'DealerTech is the service advisor’s daily workspace at a franchise dealership: it reads the coverage a customer already owns, ranks what the vehicle needs, helps the advisor present it, and never lets declined work go quiet. The dealership’s DMS stays the system of record for repair orders, parts and invoicing.',
  )

  lines.push('')
  lines.push('## Who is asking')
  lines.push(
    `A ${guide.roleLabel}${storeName ? ` at ${storeName}` : ''}, signed in. ${guide.reach}`,
  )

  const staffSurfaces = guide.surfaces.filter((s) => !s.customerFacing)
  const customerSurfaces = guide.surfaces.filter((s) => s.customerFacing)

  lines.push('')
  lines.push('## Screens this person can open')
  for (const s of staffSurfaces) {
    lines.push(`- ${s.name} — ${s.path}`)
    lines.push(`    ${s.purpose}`)
    for (const d of s.does) lines.push(`    · ${d}`)
  }

  if (customerSurfaces.length > 0) {
    lines.push('')
    lines.push('## What the customer sees (staff never open these)')
    for (const s of customerSurfaces) {
      lines.push(`- ${s.name} — ${s.path}`)
      lines.push(`    ${s.purpose}`)
      for (const d of s.does) lines.push(`    · ${d}`)
    }
  }

  lines.push('')
  lines.push('## How the common jobs are done')
  for (const w of guide.workflows) {
    lines.push(`### ${w.name}`)
    w.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
    lines.push('')
  }

  lines.push('## Principles the product holds to')
  for (const p of guide.principles) {
    lines.push(`- ${p.name} — ${p.detail}`)
  }

  if (guide.outOfReach.length > 0) {
    lines.push('')
    lines.push('## Screens this person cannot open')
    lines.push(
      `${guide.outOfReach.join(', ')}. Named so you can say honestly that one of these is not theirs. Do not explain how to use them and do not send this person to one — the product will redirect or 404 them.`,
    )
  }

  return lines.join('\n')
}
