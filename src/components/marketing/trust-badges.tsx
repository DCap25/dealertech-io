import Link from 'next/link'
import { SUBPROCESSORS } from '@/lib/site/legal'

/**
 * The badge wall, built the only way we are entitled to build one.
 *
 * ---------------------------------------------------------------------------
 * WHY A BADGE WALL AT ALL, WHEN WE HOLD NOTHING
 * ---------------------------------------------------------------------------
 * A dealer's IT contact arrives at a trust page having just left three vendors
 * whose compliance sections are a row of certification roundels. Prose alone
 * loses that comparison before it is read — not because the prose is worse,
 * but because a wall of seals answers "is this a serious vendor" in about a
 * second and three paragraphs of mechanism take ninety.
 *
 * So this gives the page the same one-second answer, out of the only material
 * we actually own: eight claims that are true of the code, each one an
 * *internal link to the section that describes the mechanism behind it*. That
 * is the whole design constraint and the reason it is honest. A rented badge
 * points outward at somebody else's certificate. Every badge here points
 * inward, at our own page, at a paragraph a reader can hold us to. If a claim
 * cannot survive being one click from its own substantiation, it does not get
 * a badge.
 *
 * Three things keep it from reading as a certification claim:
 *   - the eyebrow says "self-attested" before the reader reaches the rows;
 *   - the caption under the heading says nobody issued these;
 *   - the strip below attributes every real certificate to the vendor that
 *     earned it, and the closing line sends the reader to the section that
 *     lists what we do not hold.
 * Remove any of those three and this becomes the thing it was built not to be.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SEALS ARE DRAWN HERE AND NOT FETCHED
 * ---------------------------------------------------------------------------
 * Every glyph and every seal below is inline SVG. No icon package, no sprite
 * sheet, no remote asset — the public surface promises that a visitor's
 * browser contacts nobody else, and `src/lib/site/marketing-surface.test.ts`
 * enforces it. Note that the vendor links in the strip are plain anchors: an
 * `<a href>` is content the reader may choose to follow, not a subresource the
 * browser fetches on load, so it hands no third party the visitor's IP and the
 * tripwire correctly does not police it. What it polices is the set of things
 * that fire on load without the reader deciding anything: an absolute `src=`,
 * a stylesheet element pointing at another host, a cross-origin fetch, and a
 * script tag. An anchor is none of those, so no exemption was needed and the
 * test was not touched.
 *
 * Nothing here reproduces anybody's certification mark. The seals are our own
 * drawing on our own grid, and the words inside them are set in the site's own
 * typeface. A BSI kitemark, an AICPA logo, a PCI SSC roundel and the ISO
 * marks are all somebody else's property and none of them appears on this
 * page in any form.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY href IS TESTED
 * ---------------------------------------------------------------------------
 * The failure mode of a wall like this is not a lie, it is rot: somebody
 * renames a heading, the badge keeps its confident sentence, and the link that
 * was the entire justification for the confidence lands halfway down a page
 * with no anchor. The test in `marketing-surface.test.ts` reads the hrefs out
 * of this file and asserts each target page still carries the id. A badge
 * whose proof has gone missing fails the suite rather than the reader.
 */

/* ---------------------------------------------------------------- glyphs */

/**
 * One drawing surface for all eight, so the seals cannot drift apart.
 *
 * Consistency is the thing doing the work here: eight glyphs at one stroke
 * weight on one grid read as a set that somebody designed, and eight glyphs at
 * assorted weights read as clip art.
 *
 * This is a *nested* `<svg>`, not a standalone one: it is only ever rendered
 * inside `SealMark`'s 100-unit drawing, where `x`/`y`/`width`/`height` place
 * it in the middle of the medallion and its own `viewBox` keeps every glyph on
 * the 24-unit grid they were drawn on. Nesting rather than positioning with
 * CSS means the glyph scales with the seal — one number below changes the size
 * of all eight and they stay centred.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      x={35}
      y={35}
      width={30}
      height={30}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Shield with a check — a commitment given and kept. */
const SHIELD_CHECK = (
  <Glyph>
    <path d="M12 3 4.5 6v5.8c0 4 3.1 7.5 7.5 9.2 4.4-1.7 7.5-5.2 7.5-9.2V6L12 3Z" />
    <path d="m8.9 12 2.3 2.3 4-4.3" />
  </Glyph>
)

/**
 * A message bubble, struck through. Nothing is sent.
 *
 * Squared off with a tail rather than drawn as an oval, which is not a
 * stylistic preference: at this size an oval with a line through it and a
 * cookie with a line through it are the same picture, and another badge in the
 * same list is a cookie.
 */
const BUBBLE_OFF = (
  <Glyph>
    <rect x="3.6" y="5.2" width="16.8" height="10.8" rx="2.4" />
    <path d="M8.4 16v3.6L12.6 16" />
    <path d="M5.6 18.4 18.4 5.6" />
  </Glyph>
)

/** A cookie, struck through. Crumbs kept clear of the strike. */
const COOKIE_OFF = (
  <Glyph>
    <circle cx="12" cy="12" r="8" />
    {/* Heavier than the set's stroke on purpose: a round cap at 1.5 is a
        smudge at this render size, and three invisible crumbs make this
        glyph a plain struck-through circle. */}
    <path d="M9.3 10h.01M12 8.3h.01M14.7 14.4h.01" strokeWidth={2.4} />
    <path d="M6.4 17.6 17.6 6.4" />
  </Glyph>
)

/** A padlock whose body is ruled into rows — locked at the row. */
const LOCK_ROWS = (
  <Glyph>
    <path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10" />
    <rect x="4.6" y="10" width="14.8" height="9.6" rx="2" />
    <path d="M8 13.4h8M8 16.4h5" />
  </Glyph>
)

/** A page with a check — read by a machine, agreed by a person. */
const DOC_CHECK = (
  <Glyph>
    <path d="M14 3.5H7.6A1.6 1.6 0 0 0 6 5.1v13.8a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6V7.5L14 3.5Z" />
    <path d="M14 3.5v3.4a.6.6 0 0 0 .6.6H18" />
    <path d="m9.3 14.2 1.9 1.9 3.5-3.9" />
  </Glyph>
)

/** A payment card, struck through. It never arrives here. */
const CARD_OFF = (
  <Glyph>
    <rect x="3.2" y="6" width="17.6" height="12" rx="2" />
    <path d="M3.2 10h17.6" />
    <path d="M5.6 18.4 18.4 5.6" />
  </Glyph>
)

/** A database with a pin on it — the data, and where it is. */
const DATA_PIN = (
  <Glyph>
    <ellipse cx="10.5" cy="6.4" rx="6" ry="2.6" />
    <path d="M4.5 6.4v5.2c0 1.3 2.3 2.4 5.3 2.6" />
    <path d="M16.5 6.4v2.7" />
    <path d="M17.6 20.6c1.8-2.3 3-3.8 3-5.3a3 3 0 1 0-6 0c0 1.5 1.2 3 3 5.3Z" />
    <path d="M17.6 15.2h.01" />
  </Glyph>
)

/** An envelope with the report going out of it. */
const REPORT_OUT = (
  <Glyph>
    <path d="M20.4 11.4v6.1a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9V8.1a1.9 1.9 0 0 1 1.9-1.9h6.6" />
    <path d="m4 7.3 6.9 5a1.9 1.9 0 0 0 2.2 0l2.3-1.7" />
    <path d="M18.4 3.2v6.1M16 5.6l2.4-2.4 2.4 2.4" />
  </Glyph>
)

/* ------------------------------------------------------------- the seal */

/**
 * The seal.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS COPYING, AND THE ONE THING IT REFUSES TO COPY
 * ---------------------------------------------------------------------------
 * The shape is borrowed openly from the certification roundel every enterprise
 * trust portal is decorated with: a ring, arc text curved around it, an
 * emblem in the middle. That shape is doing a job no paragraph can do — it
 * signals "a process happened here" in the fraction of a second before the
 * reader has read anything at all.
 *
 * What is NOT borrowed is the authority. On a real kitemark the arc text names
 * the auditor, because the auditor is who is speaking. Ours does exactly the
 * same thing, and that single honest detail is what makes the whole device
 * legitimate: our seals say DEALERTECH.IO around the top and SELF-ATTESTED
 * around the bottom, so the mark names its own issuer as us and its own
 * standing as a claim rather than a certificate. The vendor seals say HELD BY
 * SUPABASE, because Supabase holds it and we do not.
 *
 * The consequence worth stating plainly: there is no crop of any seal on this
 * page that becomes a false claim. Screenshot one, drop it into a deck, and
 * the words "SELF-ATTESTED" or the holder's name travel with the picture.
 * That property is the reason the arc text exists at all, and it is why the
 * arc is not decoration that can be quietly shortened when it gets tight.
 *
 * ---------------------------------------------------------------------------
 * HOW THE ARC TEXT IS DRAWN
 * ---------------------------------------------------------------------------
 * Two invisible arcs and a `<textPath>` on each, both anchored at the middle
 * of their arc so a longer or shorter string stays centred instead of drifting
 * off one end.
 *
 * The direction of travel is the whole trick. SVG lays glyphs down with their
 * "up" to the left of the path's direction, so:
 *   - the top arc runs left → over the top → right (`sweep-flag 1`), which
 *     puts glyph-up on the outside of the ring, the way the top of a stamp
 *     reads;
 *   - the bottom arc runs left → under the bottom → right (`sweep-flag 0`),
 *     which puts glyph-up on the *inside*. Drawn the other way round, the
 *     bottom line comes out upside down — that was the first attempt and it
 *     looked like a mistake rather than a seal.
 *
 * Because the two bands grow in opposite directions, their baselines are not
 * the same radius: the top baseline sits at 40 and grows outward to ~46.5, the
 * bottom baseline sits at 45.5 and grows inward to ~39. Both therefore occupy
 * the same 39–46.5 band between the outer ring (48) and the medallion (37),
 * which is what makes the two lines look like one ring of type rather than two
 * accidents. Setting both baselines to one radius was tried first and the
 * bottom line either collided with the medallion or hung outside the ring,
 * depending on which radius was chosen.
 *
 * The bottom arc is given the larger radius on purpose: the bottom strings are
 * the longer ones ("SELF-ATTESTED · 2026", "THEIR AUDIT · LINKED") and the
 * longer string needs the longer arc. Measured in the browser with
 * `getComputedTextLength`, the worst case on each band — "HELD BY ANTHROPIC"
 * on top, "SELF-ATTESTED · 2026" underneath — runs to about 77% of its
 * semicircle, which leaves roughly twenty degrees of clear ring at each side
 * rather than two lines of type meeting in a smudge.
 *
 * The two diamonds at nine and three o'clock sit in that gap. They are the
 * classic seal device for exactly this reason — they stop the eye where the
 * type stops, so a short string does not read as a ring with a piece missing.
 *
 * Legibility was the constraint that set the font size, not the geometry.
 * 7.5 units was tried first and is a grey smear at the mobile size; 8.4 was
 * legible but left a quarter of each band empty once the strings were actually
 * measured. The type is now 9 units, which is about 6.8px on the 76px mobile
 * seal and 8.3px on the 92px desktop one, uppercase at weight 700. It is
 * small — arc text on a seal is always small — but it resolves as words at
 * arm's length, which was the test.
 *
 * Tracking was pulled back to 0.35 units from the 0.8 the first draft used:
 * heavier letter-spacing makes a seal look more like a seal and makes the
 * words harder to read, and the words are the point of this one.
 */

/** Left point → over the top → right point. Glyph-up faces outward. */
const ARC_TOP = 'M 10,50 A 40,40 0 0 1 90,50'

/** Left point → under the bottom → right point. Glyph-up faces inward. */
const ARC_BOTTOM = 'M 4.5,50 A 45.5,45.5 0 0 0 95.5,50'

function SealMark({
  /**
   * Unique within the page, because `<textPath>` resolves its arc by document
   * fragment and twelve seals sharing one id would all hang their type off the
   * first seal's arc. Derived from the row's own key at every call site.
   */
  id,
  top,
  bottom,
  /** Our seals: the badge's own glyph in the medallion. */
  glyph,
  /** Vendor seals: the standard's short name, set in two lines of strong type. */
  primary,
  secondary,
}: {
  id: string
  top: string
  bottom: string
  glyph?: React.ReactNode
  primary?: string
  secondary?: string
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      /*
        Hidden from assistive technology, and not because the words are
        unimportant — because every one of them is already in the text beside
        it. The eyebrow says self-attested, the card says the vendor's name,
        and the card's own line says what they hold. A screen reader that read
        the seal too would hear each row twice.
      */
      aria-hidden="true"
      className="h-[76px] w-[76px] shrink-0 sm:h-[92px] sm:w-[92px]"
    >
      <defs>
        <path id={`${id}-top`} d={ARC_TOP} fill="none" />
        <path id={`${id}-bottom`} d={ARC_BOTTOM} fill="none" />
      </defs>

      {/* The stamp: tinted disc, outer ring, then the medallion cut out of it
          in paper with the dashed ring the original design used. Signal green
          is the only colour in the block, exactly as before — twelve quiet
          cards with one accent each, sitting near the "what we do not hold"
          callout rather than shouting over it. */}
      <circle cx="50" cy="50" r="48" fill="var(--signal-soft)" />
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="var(--signal)"
        strokeOpacity={0.35}
        strokeWidth={0.9}
      />
      <circle cx="50" cy="50" r="37" fill="var(--paper)" />
      <circle
        cx="50"
        cy="50"
        r="37"
        fill="none"
        stroke="var(--signal)"
        strokeOpacity={0.3}
        strokeWidth={0.8}
      />
      <circle
        cx="50"
        cy="50"
        r="33.5"
        fill="none"
        stroke="var(--signal)"
        strokeOpacity={0.28}
        strokeWidth={0.8}
        strokeDasharray="2.2 2.6"
      />

      {/* Where the type stops. */}
      {[7, 93].map((x) => (
        <rect
          key={x}
          x={-1.35}
          y={-1.35}
          width={2.7}
          height={2.7}
          transform={`translate(${x} 50) rotate(45)`}
          fill="var(--signal)"
          fillOpacity={0.5}
        />
      ))}

      {/* The authority, named on the mark. */}
      <text
        fontSize={9}
        fontWeight={700}
        letterSpacing={0.35}
        fill="var(--ink-soft)"
        textAnchor="middle"
      >
        <textPath href={`#${id}-top`} startOffset="50%">
          {top}
        </textPath>
      </text>
      <text
        fontSize={9}
        fontWeight={700}
        letterSpacing={0.35}
        fill="var(--ink-soft)"
        textAnchor="middle"
      >
        <textPath href={`#${id}-bottom`} startOffset="50%">
          {bottom}
        </textPath>
      </text>

      {/* The medallion. One or the other, never both. */}
      {glyph ? (
        /* `color` rather than `stroke`: the glyphs are drawn with
           `stroke="currentColor"`, so one declaration here tints the whole
           set and each glyph keeps its own fills and stroke widths. */
        <g style={{ color: 'var(--signal)' }}>{glyph}</g>
      ) : (
        <>
          <text
            x="50"
            y="49.2"
            fontSize={11.5}
            fontWeight={800}
            letterSpacing={-0.1}
            fill="var(--ink)"
            textAnchor="middle"
          >
            {primary}
          </text>
          <text
            x="50"
            y="59.2"
            fontSize={7.8}
            fontWeight={700}
            letterSpacing={0.6}
            fill="var(--ink-soft)"
            textAnchor="middle"
          >
            {secondary}
          </text>
        </>
      )}
    </svg>
  )
}

/* ----------------------------------------------------------- the claims */

/**
 * The three groups, in the order a reader meets them.
 *
 * Borrowed from the taxonomy every enterprise trust portal sorts its roundels
 * into, because a dealer's IT contact working a questionnaire is looking for a
 * shape they recognise. The order is deliberate and it is the honest one:
 * what the law requires of us first, what we choose to do second, and what
 * somebody else was actually audited for last — not the reverse, which is how
 * a page borrows credibility from its vendors.
 */
const GROUPS = {
  regulations: 'Regulations we operate under',
  standards: 'Standards and practices, self-attested',
} as const

/**
 * Eight badges, eight sections.
 *
 * `line` is held to a hard rule: it may not promise more than the section at
 * `href` already says. Each one below was written by reading its target, and
 * the comment on each records the sentence it is compressing, so a future
 * edit to either side has somewhere to check itself against.
 *
 * `group` sorts the badge into one of the two headings above; every badge is
 * in exactly one and the rendering below filters rather than reorders, so this
 * list stays in the order it was written and reviewed in.
 */
export const TRUST_BADGES: {
  glyph: React.ReactNode
  label: string
  line: string
  href: string
  group: keyof typeof GROUPS
}[] = [
  {
    glyph: SHIELD_CHECK,
    label: 'FTC Safeguards — service provider',
    // /compliance#safeguards: "a contractual posture, not a certification",
    // and "We will sign your service-provider addendum."
    line: 'The written commitment the Rule requires you to obtain, and we sign your addendum. A contractual posture, not a certificate.',
    href: '/compliance#safeguards',
    group: 'regulations',
  },
  {
    glyph: BUBBLE_OFF,
    label: 'TCPA by design — zero SMS',
    // /compliance#tcpa: "does not send text messages. Not throttled, not
    // opt-in-gated — the capability is not built."
    line: 'The product sends no text messages at all. Not throttled, not opt-in-gated — the capability is not built.',
    href: '/compliance#tcpa',
    group: 'regulations',
  },
  {
    glyph: COOKIE_OFF,
    label: 'Zero cookies before sign-in',
    // /legal/cookies#before-you-sign-in: "Zero cookies… without setting
    // anything in your browser and without loading anything from another
    // company's servers."
    line: 'An anonymous visitor receives nothing, and no page here loads anything from another company’s servers.',
    href: '/legal/cookies#before-you-sign-in',
    group: 'standards',
  },
  {
    glyph: LOCK_ROWS,
    label: 'Row-level security, forced',
    // /security#tenancy: "Row-level security is FORCED on every table" and
    // "a query that forgets its store filter returns zero rows".
    line: 'Forced on every table, so a query that forgets its store filter returns zero rows rather than another dealership’s.',
    href: '/security#tenancy',
    group: 'standards',
  },
  {
    glyph: DOC_CHECK,
    label: 'AI never decides price or coverage',
    // /responsible-ai#boundaries: "No model decides what a customer is
    // charged… No model decides whether something is covered… No model writes
    // to a customer's record without a person confirming it."
    line: 'Prices resolve from your own op-code book and coverage is a deterministic waterfall. No model writes without a person.',
    href: '/responsible-ai#boundaries',
    group: 'standards',
  },
  {
    glyph: CARD_OFF,
    label: 'Card data never touches us',
    // /security#infrastructure: "No card data ever reaches our application;
    // card entry happens on Stripe's hosted pages." The second sentence is
    // the disclaimer from /compliance#not-held, restated so the badge cannot
    // be misread as a PCI claim of our own.
    line: 'Card entry happens on Stripe’s hosted pages. The PCI obligation is theirs; we hold no attestation of our own.',
    href: '/security#infrastructure',
    group: 'standards',
  },
  {
    glyph: DATA_PIN,
    label: 'US data residency',
    // /compliance#where-data-lives: "In the United States, with Supabase…
    // and Netlify… We do not replicate dealership data outside the US."
    line: 'Database, documents and hosting in the United States. Dealership data is not replicated outside it.',
    href: '/compliance#where-data-lives',
    group: 'regulations',
  },
  {
    glyph: REPORT_OUT,
    label: 'Responsible disclosure',
    // /security#disclosure: the published address, the good-faith
    // no-legal-action commitment, and the security.txt pointer.
    line: 'A published address, safe harbour for good-faith research, and machine-readable details at /.well-known/security.txt.',
    href: '/security#disclosure',
    group: 'standards',
  },
]

/* -------------------------------------------- their audits, attributed */

/**
 * What each of our four subprocessors publicly holds — and where they say so.
 *
 * Keyed off `SUBPROCESSORS` rather than a retyped list, and typed as a total
 * record of those names, so adding a fifth subprocessor to `legal.ts` fails
 * the type-check here until somebody has gone and read that vendor's trust
 * page. That is the intended friction: an unattributed vendor on this strip
 * would be the one place on the site where a certification appears next to a
 * name with nothing standing behind it.
 *
 * `holds` is transcribed from the vendor's own public page on the date in
 * `AUDITS_CHECKED`, and the strip says so. We are not in a position to verify
 * anybody's certificate; what we can do is name the page where they publish
 * it and let the reader go and look, which is why every row carries the link
 * and none of them carries a logo.
 *
 * `seal` is the single strongest mark from `holds`, promoted onto the
 * medallion because a seal can only hold one thing legibly. The full list
 * stays in the card text — the seal is a pointer into the sentence beside it,
 * not a summary that replaces it. Both lines are ordinary words set in this
 * site's typeface; none of them is anybody's registered mark redrawn.
 */
const AUDITS: Record<
  (typeof SUBPROCESSORS)[number]['name'],
  { holds: string; trustPage: string; seal: { primary: string; secondary: string } }
> = {
  Supabase: {
    holds: 'SOC 2 Type II · ISO 27001 · HIPAA available on their paid tiers',
    trustPage: 'https://supabase.com/security',
    seal: { primary: 'SOC 2', secondary: 'TYPE II' },
  },
  Stripe: {
    holds: 'PCI DSS Service Provider Level 1 · SOC 1 and SOC 2 Type II · public SOC 3',
    trustPage: 'https://docs.stripe.com/security',
    seal: { primary: 'PCI DSS', secondary: 'LEVEL 1' },
  },
  Anthropic: {
    // ISO 42001 rather than the SOC 2 the other three also hold: it is the AI
    // management standard, and Anthropic is the only vendor on this list whose
    // work here is a model reading a customer's contract.
    holds: 'SOC 2 Type II · ISO 27001 · ISO 42001 for AI management',
    trustPage: 'https://trust.anthropic.com',
    seal: { primary: 'ISO', secondary: '42001' },
  },
  Netlify: {
    holds: 'SOC 2 Type II · ISO 27001',
    trustPage: 'https://www.netlify.com/security/',
    seal: { primary: 'ISO', secondary: '27001' },
  },
}

/** When the four rows above were last read off the vendors' own pages. */
const AUDITS_CHECKED = '21 August 2026'

/* ------------------------------------------------------------ rendering */

/**
 * A group heading.
 *
 * Set as a small tracked label with a rule running off to the right rather
 * than as another bold sentence, so the three of them organise the rows
 * without competing with the section's own heading above them.
 */
function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 flex items-center gap-4">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--ink-soft)]">
        {children}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--rule)]" />
    </div>
  )
}

/**
 * One claim: the sentence on the left, the seal on the right.
 *
 * The whole card is the link, as it always was — the seal is not a separate
 * target and there is nothing on the card that goes anywhere else. Text first
 * in the DOM so keyboard and reading order start with the claim rather than
 * with a decoration.
 */
function Badge({ badge }: { badge: (typeof TRUST_BADGES)[number] }) {
  return (
    <Link
      href={badge.href}
      className="group flex items-center gap-4 rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 transition hover:border-[var(--signal)]/40 sm:gap-6 sm:p-5"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="block text-[14px] font-bold leading-snug tracking-tight text-[var(--ink)] sm:text-[15px]">
          {badge.label}
        </span>
        <span className="mt-1.5 block text-[13px] leading-relaxed text-[var(--ink-soft)]">
          {badge.line}
        </span>
        <span className="mt-2.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ink-soft)] transition group-hover:text-[var(--signal)]">
          Read the section →
        </span>
      </span>
      <SealMark
        id={`seal-${badge.href.replace(/[^a-z]+/gi, '-')}`}
        top="DEALERTECH.IO"
        bottom="SELF-ATTESTED · 2026"
        glyph={badge.glyph}
      />
    </Link>
  )
}

/**
 * The whole block: what the law asks of us, what we hold ourselves to, then
 * their certificates, then the pointer at the section that says we hold none.
 *
 * Mounted on `/compliance` and `/security` only. Not the homepage — a badge
 * wall in a sales context is exactly the reading this design spends its
 * effort avoiding — and not inside a legal document, where a decorated grid
 * would sit oddly against text somebody may one day have to enforce.
 */
export function TrustBadges() {
  return (
    <section className="mt-12 border-t border-[var(--rule)] pt-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
        Self-attested — every badge links to its own proof
      </p>
      <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
        Certifications, attestations, standards, and regulations
      </h2>
      <p className="mt-3 text-base font-semibold leading-relaxed text-[var(--ink)]">
        Eight claims you can check in eight clicks
      </p>
      <p className="mt-2 leading-relaxed text-[var(--ink-soft)]">
        Nobody issued these. Each one is a statement about how this software is built, and each one
        is a link to the section of this site that describes the mechanism behind it — so a claim
        that stops being true has somewhere visible to fail.
      </p>

      {/* ---------------------------------- what the law asks of us anyway */}
      <GroupHead>{GROUPS.regulations}</GroupHead>
      <div className="mt-4 space-y-3">
        {TRUST_BADGES.filter((b) => b.group === 'regulations').map((badge) => (
          <Badge key={badge.href} badge={badge} />
        ))}
      </div>

      {/* ------------------------------- what we hold ourselves to anyway */}
      <GroupHead>{GROUPS.standards}</GroupHead>
      <div className="mt-4 space-y-3">
        {TRUST_BADGES.filter((b) => b.group === 'standards').map((badge) => (
          <Badge key={badge.href} badge={badge} />
        ))}
      </div>

      {/* --------------------------------------------- their audits, theirs */}
      <GroupHead>Certifications and attestations</GroupHead>
      <h4 className="mt-4 text-base font-bold tracking-tight sm:text-lg">
        The infrastructure is audited. The audits are theirs.
      </h4>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        The four companies we hand data to hold the certifications we do not. Those certificates
        belong to them, cover their platforms, and say nothing about our application. We name them
        because a vendor questionnaire asks and the answer should be findable — not to stand closer
        to them than the facts allow.
      </p>

      <ul className="mt-4 space-y-3">
        {SUBPROCESSORS.map((vendor) => {
          const audit = AUDITS[vendor.name]
          return (
            <li
              key={vendor.name}
              className="flex items-center gap-4 rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 sm:gap-6 sm:p-5"
            >
              <div className="min-w-0 flex-1">
                {/*
                  A text wordmark, set in the site's own type. No vendor logo:
                  a logo file would be a third-party mark used without a
                  licence and — served from their CDN, which is how these
                  usually arrive — a subresource that puts the visitor's IP in
                  four more companies' logs on a page promising the opposite.
                */}
                <p className="text-[15px] font-bold tracking-tight text-[var(--ink)]">
                  {vendor.name}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                  {audit.holds}
                </p>
                <p className="mt-2 text-[13px]">
                  <a
                    href={audit.trustPage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--ink)] underline underline-offset-4"
                  >
                    Their audit, linked
                  </a>
                  <span className="text-[var(--ink-soft)]"> — verify it at the source.</span>
                </p>
              </div>
              {/*
                The holder's name is on the mark, not under it. A seal reading
                "SOC 2 TYPE II" beside the word Supabase could be cropped into
                a claim about us; one reading "HELD BY SUPABASE" around the
                outside cannot be.
              */}
              <SealMark
                id={`seal-${vendor.name.toLowerCase()}`}
                top={`HELD BY ${vendor.name.toUpperCase()}`}
                bottom="THEIR AUDIT · LINKED"
                primary={audit.seal.primary}
                secondary={audit.seal.secondary}
              />
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-[var(--ink-soft)]">
        Read off each vendor&rsquo;s own public compliance page on {AUDITS_CHECKED}; theirs is the
        authoritative version and it can change without us noticing.
      </p>

      <div className="mt-5 rounded-2xl border border-[var(--rule)] bg-[var(--paper-tint)] p-5 text-sm leading-relaxed text-[var(--ink-soft)] sm:p-6">
        <strong className="text-[var(--ink)]">Ours would be listed above this strip.</strong> There
        are none yet — no SOC, no ISO, no attestation of our own — and the{' '}
        <a href="#not-held" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          section further down this page
        </a>{' '}
        says so without softening it.
      </div>
    </section>
  )
}
