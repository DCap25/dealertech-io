import Link from 'next/link'
import { TOUR_ROLES } from '@/lib/demo-tour/codes'
import { TourGate } from './tour-gate'

export const metadata = {
  title: 'Guided tour',
  description: 'Enter your access code to walk the advisor workspace as real staff.',
}

/**
 * The door to a gated demo tour.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS GATED WHEN /demo IS NOT
 * ---------------------------------------------------------------------------
 * The coverage engine at `/demo` is open to anybody with a VIN and stays that
 * way — the press page says so, and it should keep being true. It answers one
 * question and gives nothing away about how the workspace is built.
 *
 * This is the whole product: the drive, a prep sheet, the menu, the follow-up
 * list, signed in as real staff at the seeded store. That is the right thing to
 * put in front of a dealership that booked a walkthrough and the wrong thing to
 * leave open for a competitor to work through at leisure.
 *
 * The page says why out loud rather than presenting a bare code box. A gate
 * with no explanation reads as a product that is hiding something; a gate that
 * says "this one is by appointment, here is the open one meanwhile" reads as a
 * product with something worth an appointment.
 */
export default function TourPage() {
  return (
    <main className="mkt mx-auto w-full max-w-3xl px-5 py-6 sm:px-6 sm:py-10">
      {/* The same nav idiom as /demo — a way back to the site, a way to sign
          in, and a way to ask for a walkthrough from the page most likely to
          be the reason somebody wants one. */}
      <nav className="mb-8 flex items-center justify-between gap-4 border-b border-[var(--rule)] pb-4">
        <Link href="/" className="text-[15px] font-bold tracking-tight">
          DealerTech<span className="text-[var(--signal)]">.io</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
            ← Back to the site
          </Link>
          <Link
            href="/login"
            className="touch-target inline-flex items-center font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
          >
            Sign in
          </Link>
          <Link
            href="/#demo"
            className="touch-target inline-flex items-center rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85"
          >
            Book a walkthrough
          </Link>
        </div>
      </nav>

      <header className="mb-8 max-w-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          Guided tour
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Walk the drive as the people who work it.
        </h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          Your access code opens a working dealership — a real day of appointments, real prep
          sheets, real coverage answers — and lets you move through it as an advisor, a service
          manager or the BDC desk. Nothing is a screenshot and nothing is a slide.
        </p>
      </header>

      <TourGate roles={TOUR_ROLES.map((r) => ({ code: r.code, label: r.label, sees: r.sees }))} />

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs leading-relaxed text-neutral-500 dark:border-neutral-800">
        <p>
          <strong>No code?</strong>{' '}
          <Link href="/#demo" className="font-semibold underline underline-offset-4">
            Book a walkthrough
          </Link>{' '}
          and we will send you one — they last seven days. The{' '}
          <Link href="/demo" className="font-semibold underline underline-offset-4">
            coverage engine
          </Link>{' '}
          is open to everybody with no signup in the meantime: paste any VIN and a concern and you
          will see exactly what an advisor sees.
        </p>
        <p className="mt-2">
          {/*
            Said before they go in, not discovered afterwards. The store is
            shared and the data is invented — a prospect who assumes otherwise
            and types a real customer's name into it has been misled by
            omission.
          */}
          The tour dealership is fictional and shared between everyone touring this week, so you may
          see somebody else&rsquo;s edits and they may see yours. Please do not type real customer
          details into it. Picking a role signs you in, which sets the session cookie described in
          our{' '}
          <Link href="/legal/cookies" className="font-semibold underline underline-offset-4">
            cookie policy
          </Link>
          ; signing out clears it.
        </p>
      </footer>
    </main>
  )
}
