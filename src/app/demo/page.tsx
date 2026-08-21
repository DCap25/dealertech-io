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

      {/*
        The coverage answer is the hook, not the product — and the workspace
        overview sits ABOVE the engine on purpose. It used to live below the
        form, where discovering that this is one screen of a product was a
        reward for scrolling past the thing most visitors came to poke at.
        Now the page states its frame first — here is the workspace, here are
        the two ways in — and the engine runs live directly beneath it. The
        workspace itself stays behind the tour code: this page gives away
        outputs, not the product.
      */}
      <header className="mb-8 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          Live demo
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Know who pays before you write the RO.
        </h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          This page runs our coverage arbitration engine, live — one screen of the workspace your
          advisors would use. In the product, its answer arrives already worked into the
          advisor&rsquo;s morning: a prep sheet per appointment, a customer menu built to be
          handed over, and a follow-up list that never lets a declined job go quiet.
        </p>
      </header>

      <section className="mb-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              [
                'The prep sheet',
                'Every appointment arrives as a one-screen brief — coverage, declined work, tires predicted to a date. Ranked by what to present first.',
                '/#how',
              ],
              [
                'The menu',
                'Three answers of equal weight, Not today first, and the covered total as the first number the customer sees.',
                '/#menu',
              ],
              [
                'The follow-up',
                'Every decline becomes a dated task with a dollar figure and a talk track. Your BDC works a ranked list, not a spreadsheet.',
                '/#how',
              ],
            ] as const
          ).map(([title, body, href]) => (
            <Link
              key={title}
              href={href}
              className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-4 transition hover:border-[var(--ink)]"
            >
              <h3 className="text-base font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
            </Link>
          ))}
        </div>

        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          <Link
            href="/#demo"
            className="font-semibold text-[var(--ink)] underline underline-offset-4"
          >
            Ask for a tour code
          </Link>{' '}
          and explore the whole workspace at your own pace — as an advisor, a manager, or the
          BDC. The walkthrough comes after, on your own VINs.{' '}
          <Link
            href="/tour"
            className="font-semibold text-[var(--ink)] underline underline-offset-4"
          >
            Have a code? →
          </Link>
        </p>
      </section>

      {/* --------------------------------------------- the engine, live */}
      <div className="mb-6 border-t border-[var(--rule)] pt-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          Coverage arbitration engine
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--ink-soft)]">
          Try it. A VIN and a customer concern are enough. The engine checks open recalls, prepaid
          maintenance, tire &amp; wheel, every factory warranty term, and any service contract on
          file — in that order — then tells you who pays, what the customer owes, and what you
          must do before starting work.
        </p>
      </div>

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
