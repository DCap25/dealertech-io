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

      {/*
        The coverage answer is the hook, not the product. A visitor convinced
        by this screen used to have nowhere to go but the booking form; now the
        page says out loud that this is one screen of a workspace, names the
        rest, and offers the two ways in — a walkthrough, or the tour code a
        walkthrough comes with. The workspace itself stays behind the code on
        purpose: this page gives away outputs, not the product.
      */}
      <section className="mt-14 border-t border-[var(--rule)] pt-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          One screen of it
        </p>
        <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
          The coverage answer is where the workspace starts, not where it ends.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">
          In the product, this answer arrives already worked into the advisor&rsquo;s morning: a
          prep sheet per appointment, a customer menu built to be handed over, and a follow-up
          list that never lets a declined job go quiet.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {(
            [
              [
                'The prep sheet',
                'Every appointment arrives as a one-screen brief — coverage still active, declined work re-priced, maintenance projected to the odometer they will actually arrive with, tires predicted to a date. Ranked by what to present first.',
                '/#how',
              ],
              [
                'The menu',
                'Three answers of equal weight, Not today first, and the covered total as the first number the customer sees. Built to be physically handed over mid-conversation with nothing on it needing to be explained away.',
                '/#menu',
              ],
              [
                'The follow-up',
                'Every decline becomes a dated task with a dollar figure and a talk track. So does expiring prepaid maintenance and a customer gone quiet. Your BDC works a ranked list instead of a spreadsheet.',
                '/#how',
              ],
            ] as const
          ).map(([title, body, href]) => (
            <Link
              key={title}
              href={href}
              className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 transition hover:border-[var(--ink)]"
            >
              <h3 className="text-base font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/#demo"
            className="touch-target inline-flex items-center rounded-xl bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85"
          >
            Book a walkthrough
          </Link>
          <Link
            href="/tour"
            className="touch-target inline-flex items-center rounded-xl border border-[var(--rule)] px-6 py-3 text-sm font-semibold transition hover:border-[var(--ink)]"
          >
            Have a tour code? →
          </Link>
        </div>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          A walkthrough comes with a tour code — the whole workspace, explored at your own pace as
          an advisor, a manager, or the BDC.
        </p>
      </section>

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
