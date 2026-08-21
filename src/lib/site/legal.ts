/**
 * The facts a lawyer will want to change.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Every trust and legal page on the public site reads its entity name, contact
 * address, governing-law sentence and "last updated" date from here, and none
 * of them hardcode any of it. That is the entire point: when counsel reads the
 * drafts before the first customer signs anything, the edits they ask for —
 * the registered entity, a filed DBA, a named state, a role address, a real
 * postal address — are a change to this one file rather than a hunt through
 * nine pages for the seven places each fact was retyped.
 *
 * The pages themselves carry the prose. This carries only what changes when
 * somebody with a bar licence reads it.
 *
 * Nothing here is legal advice, and nothing here has been reviewed by counsel.
 * See `LAST_UPDATED` — the dates are the honest statement of that.
 */

/**
 * The company. DealerTech.io is a product of it, not a company itself.
 *
 * Whether "DealerTech.io" needs a DBA filing to appear on a dealer contract is
 * an open question for counsel — the marketing name and the contracting entity
 * are deliberately kept separate everywhere below so that answer can land
 * without rewriting the pages.
 */
export const LEGAL_ENTITY = 'The DAS Board LLC'

/** How the product refers to itself in prose. */
export const PRODUCT_NAME = 'DealerTech.io'

/**
 * One address for everything until role addresses exist.
 *
 * Privacy requests, security disclosure and press all land here. Splitting it
 * into privacy@/security@/press@ before there is a second person to read them
 * would advertise a triage that does not exist.
 */
export const CONTACT_EMAIL = 'info@dealertech.io'

/**
 * The other product under the same LLC.
 *
 * Named in the footer rather than behind a parent marketing site: a dealer
 * checking who they are about to sign with should find the same company on
 * both storefronts without a third property existing to maintain.
 */
export const SIBLING_PRODUCT = {
  name: 'The DAS Board',
  url: 'https://thedasboard.com',
  /** What it is, in the fewest words that distinguish it from this one. */
  description: 'variable-ops management',
} as const

/**
 * Governing law, written around rather than guessed at.
 *
 * Naming a state we have not confirmed would be the one kind of error in a
 * contract that is expensive and silent — it survives review because it looks
 * like every other terms page. The phrasing below is correct whatever the
 * answer turns out to be, and counsel replaces it with the state.
 */
export const GOVERNING_LAW_TEXT =
  `the state in which ${LEGAL_ENTITY} is organized`

/**
 * The registered postal address.
 *
 * Deliberately absent. Several privacy regimes expect a mailing address on a
 * privacy policy, and we do not have one to publish yet — so the pages state
 * the email contact and say nothing about post, rather than printing a
 * placeholder that reads as real. Filling this in is on the pre-launch list.
 */
export const POSTAL_ADDRESS: string | null = null

/**
 * When each document was last written.
 *
 * Shown on the page, because a legal document with no date is a legal document
 * nobody can tell is stale. ISO strings so the rendering is one helper and the
 * ordering is sortable; the display format lives in `formatUpdated`.
 *
 * Change the date in the same edit that changes the words. A "last updated"
 * that lags the text is worse than none.
 */
export const LAST_UPDATED = {
  privacy: '2026-08-20',
  terms: '2026-08-19',
  cookies: '2026-08-19',
  // Re-dated when the badge wall and its attribution strip landed on both
  // pages: new claims on the page, new date under the title.
  security: '2026-08-21',
  compliance: '2026-08-21',
  responsibleAi: '2026-08-19',
} as const

export type LegalDocument = keyof typeof LAST_UPDATED

/**
 * The date a page prints under its title.
 *
 * `UTC` is not decoration: an ISO date string parses as midnight UTC, and
 * formatting that in a timezone behind it renders the previous day. A privacy
 * policy that claims to be a day older than it is, only for readers west of
 * Greenwich, is exactly the kind of bug nobody reports.
 */
export function formatUpdated(document: LegalDocument): string {
  return new Date(`${LAST_UPDATED[document]}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Everyone we hand data to, and what they do with it.
 *
 * The complete list — there is no fifth. It is short enough to publish, which
 * is itself the selling point, and it is stated here once so the privacy
 * policy, the security page and the compliance page cannot drift into three
 * different answers to the same procurement question.
 *
 * Adding a vendor that touches customer data means adding it here, in the same
 * commit, and re-dating the three documents that print it.
 */
export const SUBPROCESSORS = [
  {
    name: 'Supabase',
    url: 'https://supabase.com',
    purpose:
      'Postgres database, authentication, and the private bucket customer documents are stored in. This is where dealership data lives.',
  },
  {
    name: 'Stripe',
    url: 'https://stripe.com',
    purpose:
      'Subscription billing. Stripe holds the card; we never receive or store card numbers.',
  },
  {
    name: 'Anthropic',
    url: 'https://anthropic.com',
    purpose:
      'The model that reads uploaded service contracts and answers Co-Pilot questions. API data is not used to train models.',
  },
  {
    name: 'Netlify',
    url: 'https://netlify.com',
    purpose: 'Hosting and the scheduled jobs that run overnight.',
  },
] as const

/**
 * Status pages worth linking when something is wrong.
 *
 * The order is diagnostic rather than alphabetical: Netlify first because if
 * the site will not load at all it is the layer in front, then the database,
 * then the two services a single feature depends on.
 */
export const DEPENDENCY_STATUS_PAGES = [
  { name: 'Netlify', url: 'https://www.netlifystatus.com', covers: 'the site itself and the overnight jobs' },
  { name: 'Supabase', url: 'https://status.supabase.com', covers: 'sign-in, the database, document storage' },
  { name: 'Stripe', url: 'https://status.stripe.com', covers: 'billing and checkout' },
  { name: 'Anthropic', url: 'https://status.anthropic.com', covers: 'contract extraction and the Co-Pilot' },
] as const
