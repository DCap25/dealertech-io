import Link from 'next/link'
import { DemoForm } from './demo-form'

export const metadata = {
  title: 'Coverage Engine',
  description: 'Paste a VIN and a concern. See who pays before you write the RO.',
}

export default function DemoPage() {
  return (
    <main className="mkt mx-auto max-w-7xl px-5 py-6 sm:px-6 sm:py-10">
      {/*
        A visitor who arrives here from the marketing page used to hit a dead
        end — no way back, and no way to ask for a walkthrough from the one
        screen most likely to convince them.
      */}
      <nav className="mb-8 flex items-center justify-between gap-4 border-b border-[var(--rule)] pb-4">
        <Link href="/" className="text-[15px] font-bold tracking-tight">
          DealerTech<span className="text-[var(--signal)]">.io</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
          >
            ← Back to the site
          </Link>
          <Link
            href="/#demo"
            className="touch-target inline-flex items-center rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85"
          >
            Book a walkthrough
          </Link>
        </div>
      </nav>

      <header className="mb-8 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          Coverage arbitration engine
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Know who pays before you write the RO.
        </h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          A VIN and a customer concern are enough. The engine checks open recalls, prepaid
          maintenance, tire &amp; wheel, every factory warranty term, and any service contract on
          file — in that order — then tells you who pays, what the customer owes, and what you
          must do before starting work.
        </p>
      </header>

      <DemoForm />

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
        <p>
          VIN decoding uses the free NHTSA vPIC service. Recall data comes from NHTSA by
          make/model/year — <strong>not by VIN</strong>, and without remedy status, so campaigns are
          shown as candidates to verify in the OEM portal rather than as confirmed open recalls.
        </p>
        <p className="mt-2">
          Factory warranty terms are reference data and vary by model and model year. DealerTech
          advises; the administrator or manufacturer adjudicates.
        </p>
      </footer>
    </main>
  )
}
