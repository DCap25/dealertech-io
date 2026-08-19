import Link from 'next/link'
import { DemoRequestForm } from './request-demo/demo-form'
import { CoverageContrast } from '@/components/marketing/coverage-contrast'
import { DepartmentPreview } from '@/components/marketing/department-preview'
import { LeakCalculator } from '@/components/marketing/leak-calculator'
import { PrepSheetPreview } from '@/components/marketing/prep-sheet-preview'
import { MarketingFooter } from '@/components/marketing/site-footer'
import { WearPreview } from '@/components/marketing/wear-preview'

export const metadata = {
  title: 'Know who pays before you write the RO',
  description:
    'DealerTech reads the coverage your customer already owns, predicts what wears out next, and never lets a declined job go quiet. Service drive intelligence for franchise dealerships.',
}

/* ------------------------------------------------------------------ bits */

function Section({
  id,
  tint,
  className,
  children,
}: {
  id?: string
  tint?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className={`border-t border-[var(--rule)] px-5 py-16 sm:px-6 sm:py-24 ${
        tint ? 'bg-[var(--paper-tint)]' : ''
      } ${className ?? ''}`}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
      {children}
    </p>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-4 max-w-3xl text-3xl font-bold leading-[1.12] tracking-tight sm:text-[2.75rem]">
      {children}
    </h2>
  )
}

function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
      {children}
    </p>
  )
}

/** A leak, stated as a specific mechanism rather than a vague benefit. */
function Leak({
  number,
  title,
  body,
}: {
  number: string
  title: string
  body: string
}) {
  return (
    <div className="mkt-reveal rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 sm:p-6">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm text-[var(--signal)]">{number}</span>
        <h3 className="text-lg font-bold leading-snug">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
    </div>
  )
}

function Step({
  number,
  title,
  body,
}: {
  number: string
  title: string
  body: string
}) {
  return (
    <div className="mkt-reveal border-t-2 border-[var(--ink)] pt-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--ink-soft)]">
        {number}
      </p>
      <h3 className="mt-2 text-xl font-bold">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
    </div>
  )
}

function Honest({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-[var(--rule)] pl-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function HomePage() {
  return (
    <div className="mkt flex min-h-full flex-col bg-[var(--paper)] text-[var(--ink)]">
      {/* ------------------------------------------------------------ nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--rule)] bg-[var(--paper)]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <Link href="/" className="text-[15px] font-bold tracking-tight">
            DealerTech<span className="text-[var(--signal)]">.io</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-5">
            <a
              href="#how"
              className="hidden rounded-lg px-2 py-1.5 text-[var(--ink-soft)] transition hover:text-[var(--ink)] sm:block"
            >
              How it works
            </a>
            <a
              href="#managers"
              className="hidden rounded-lg px-2 py-1.5 text-[var(--ink-soft)] transition hover:text-[var(--ink)] sm:block"
            >
              For managers
            </a>
            {/*
              Hidden on the narrowest screens, where the header has room for
              the two things a phone visitor needs: a way in, and a way to ask
              for a walkthrough. The hero carries its own link to the demo.
            */}
            <Link
              href="/demo"
              className="hidden rounded-lg px-2 py-1.5 text-[var(--ink-soft)] transition hover:text-[var(--ink)] sm:block"
            >
              Live demo
            </Link>
            {/*
              A customer of ours arriving at the front door is not a prospect —
              they are an advisor about to start a shift. Without this the only
              way back into the product is knowing to type /login.
            */}
            <Link
              href="/login"
              className="touch-target inline-flex items-center rounded-lg px-2 py-1.5 font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
            >
              Sign in
            </Link>
            <a
              href="#demo"
              className="touch-target inline-flex items-center rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85"
            >
              Book a walkthrough
            </a>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden px-5 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
        <div className="mkt-hero-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:items-center lg:gap-14">
          <div>
            <Eyebrow>Service drive intelligence · Franchise dealerships</Eyebrow>
            <h1 className="mt-5 text-[2.5rem] font-bold leading-[1.03] tracking-[-0.02em] sm:text-6xl lg:text-[4.25rem]">
              Your sales floor runs
              <br className="hidden sm:block" /> on a process.
              <br />
              <span className="text-[var(--ink-soft)]">
                Your service drive
                <br className="hidden sm:block" /> runs on memory.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
              Variable ops logs every up, desks every deal, presents a full menu to every customer,
              and chases them for years. Fixed ops books an appointment and hopes. DealerTech brings
              that discipline to the drive — so your advisors know{' '}
              <strong className="text-[var(--ink)]">who pays</strong> before they write the RO, and
              nothing goes quiet after the customer leaves.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#demo"
                className="touch-target inline-flex items-center rounded-xl bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] transition hover:opacity-85"
              >
                Book a walkthrough
              </a>
              <Link
                href="/demo"
                className="touch-target inline-flex items-center rounded-xl border border-[var(--rule)] px-6 py-3 text-sm font-semibold transition hover:border-[var(--ink)]"
              >
                Try the coverage engine →
              </Link>
            </div>
            <p className="mt-3.5 text-sm text-[var(--ink-soft)]">
              The demo is live and open. Paste any VIN — no signup, nothing stored.
            </p>
          </div>

          <div className="lg:pl-4">
            <PrepSheetPreview />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- leaks */}
      <Section id="leaks" tint>
        <Eyebrow>Where the money goes</Eyebrow>
        <H2>Four leaks, and none of them are your advisors&rsquo; fault.</H2>
        <Lede>
          They&rsquo;re writing 15 ROs before 10am with four tabs open. Nobody can hold this in
          their head. That&rsquo;s a systems problem.
        </Lede>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Leak
            number="01"
            title="You sold them the coverage, then paid for the repair anyway"
            body="F&I sold the service contract and earned the reserve. Two years later the advisor doesn't know it exists, bills the customer, and the store eats goodwill on a repair the contract would have paid. The same happens with factory warranty — especially the emissions and hybrid terms that run far longer than bumper-to-bumper."
          />
          <Leak
            number="02"
            title="Declined work is quoted once, then never mentioned again"
            body="An advisor quotes $1,200 in brakes, the customer says not today, and it vanishes. No system holds it, so nobody re-offers it. This is the largest untapped pool in the entire department and most stores cannot even report on it."
          />
          <Leak
            number="03"
            title="The MPI records a number, then throws it away"
            body="Your techs measure tread depth and pad thickness at every single visit. Most systems store a colour and discard the measurement. Two readings give you a wear rate; three give you a date. That turns tires from something you react to into something you book."
          />
          <Leak
            number="04"
            title="Prepaid maintenance expires unused"
            body="They already paid for those visits. It's the cheapest reason in the business to get a car back on the drive, and it silently expires because nobody is watching the ledger."
          />
        </div>
      </Section>

      {/* ----------------------------------------------------- how it works */}
      <Section id="how">
        <Eyebrow>How it works</Eyebrow>
        <H2>One question, answered before the customer walks up.</H2>

        <div className="mt-12 grid gap-10 lg:grid-cols-3">
          <Step
            number="Step 01"
            title="The prep sheet"
            body="Every morning, each appointment arrives with a one-screen brief: coverage still active, open declined work re-priced, maintenance projected against the odometer they will actually have on arrival, tires predicted to a date, and any open campaign. Ranked by what to present first."
          />
          <Step
            number="Step 02"
            title="The coverage answer"
            body="For any concern, on any VIN, the engine works a strict waterfall — open recall, prepaid maintenance, tire & wheel, every factory warranty term, then the service contract — and tells the advisor who pays, what the customer owes, and what to do before starting work."
          />
          <Step
            number="Step 03"
            title="The follow-up that happens"
            body="Every decline becomes a dated task with a talk track and a dollar figure. So does expiring prepaid maintenance, warranty about to lapse, and a customer who has gone quiet. Your BDC works a ranked list instead of a spreadsheet."
          />
        </div>
      </Section>

      {/* --------------------------------------------------------- proof */}
      <Section id="proof" tint>
        <Eyebrow>Proof, not adjectives</Eyebrow>
        <H2>The same car, twice. Opposite answers.</H2>
        <Lede>
          Hyundai, Kia and Genesis advertise a 10-year powertrain warranty. It applies to the{' '}
          <strong className="text-[var(--ink)]">original owner only</strong> — a second owner gets
          5yr/60k. Quote the headline number to a used-car buyer and the store eats the difference.
        </Lede>

        <div className="mkt-reveal mt-10">
          <CoverageContrast />
        </div>
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          Illustrative figures, drawn with the same component your advisors use.
        </p>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h3 className="text-2xl font-bold tracking-tight">
              Two measurements make a slope. A slope makes a date.
            </h3>
            <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">
              Your techs already write tread depth on every MPI. Most systems keep the colour and
              throw the number away. Keep the numbers and a tire stops being something you react to
              at 2/32 and becomes something you book at the visit before.
            </p>
            <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">
              The projection uses this customer&rsquo;s own driving rate, not an average — a
              30,000-mile-a-year commuter and a weekend car do not wear the same set of tires on the
              same schedule.
            </p>
          </div>
          <div className="mkt-reveal">
            <WearPreview />
          </div>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-bold">A converter is free years after the warranty ends</h3>
              <span className="font-mono text-xs text-[var(--signal)]">Federal 8yr/80k</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              The Clean Air Act covers the catalytic converter and the engine control module for
              eight years or 80,000 miles — on every make sold in the US, long after
              bumper-to-bumper has lapsed. An advisor checking only the 3/36 quotes four figures for
              a repair the manufacturer owes.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-bold">A hybrid battery covered in California, not Texas</h3>
              <span className="font-mono text-xs text-[var(--signal)]">CARB 10yr/150k</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              California-standard states carry a 10-year, 150,000-mile high-voltage battery term
              instead of the federal 8/100 floor. On a 120,000-mile EV that is the whole
              conversation. DealerTech reads the electrification level straight from the VIN — the
              advisor never has to know the car is electric, let alone the rule.
            </p>
          </div>
        </div>

        <p className="mt-8 text-sm text-[var(--ink-soft)]">
          None of these are hypotheticals. Run each one yourself in the{' '}
          <Link href="/demo" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            live demo
          </Link>
          .
        </p>
      </Section>

      {/* ------------------------------------------------------ managers */}
      <Section id="managers">
        <Eyebrow>For service managers and dealer principals</Eyebrow>
        <H2>The pool nobody reports on.</H2>
        <Lede>
          Every other number in your department has a report behind it. Declined work does not — it
          is quoted once, walks out of the lane, and leaves no row anywhere. Put your own figures in
          and see the size of it.
        </Lede>

        <div className="mkt-reveal mt-10">
          <LeakCalculator />
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h3 className="text-2xl font-bold tracking-tight">
              And a board that does not need a report run.
            </h3>
            <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">
              Today&rsquo;s drive, the week or month to date, and every advisor&rsquo;s results side
              by side — sold, covered revenue, average ticket, effective labor rate. Plus the two
              things you can fix before lunch: appointments with nobody&rsquo;s name on them, and
              how late the oldest follow-up is.
            </p>
            <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">
              Month-to-date compares against the same days of last month, not against all of it. A
              twelfth-of-August number measured against a whole July reports a collapse that did not
              happen, at exactly the moment you are deciding whether the month is in trouble.
            </p>
          </div>
          <div className="mkt-reveal">
            <DepartmentPreview />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- honesty */}
      <Section tint>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>What this is not</Eyebrow>
            <H2>We are not replacing your DMS.</H2>
            <Lede>
              Your DMS keeps the repair order, the parts, and the accounting. DealerTech is the
              intelligence layer beside it — the tab your advisor actually wants open. Start with a
              spreadsheet export; integrate properly once it has earned its place.
            </Lede>
          </div>
          <div className="space-y-5 self-center">
            <Honest
              title="We advise. The administrator adjudicates."
              body="Service contract terms are contracts, and they vary. Every answer carries a confidence level and routes prior-authorisation claims to the admin before teardown. We will never tell an advisor something is covered as though it were settled."
            />
            <Honest
              title="Recalls are shown as candidates, not certainties."
              body="There is no public VIN-level open-recall feed — NHTSA publishes by make, model and year, without remedy status. So we surface campaigns to verify in the OEM portal rather than pretending to know."
            />
            <Honest
              title="Consent is a record, not a checkbox."
              body="Dealerships are covered financial institutions under the FTC Safeguards Rule. Every consent change is stored as a dated, sourced event with the exact disclosure text — and where a store cannot prove consent, the screen says so."
            />
            <Honest
              title="Advisor coaching numbers stay with the advisor."
              body="Capture rate only exists because an advisor works the prep sheet honestly, and they stop the week they learn it is being marked. Managers see results — closed ROs and revenue, the same facts as the DMS. They do not see the coaching layer."
            />
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- CTA */}
      <Section id="demo">
        <div className="grid gap-12 lg:grid-cols-[1fr_28rem]">
          <div>
            <Eyebrow>Early access</Eyebrow>
            <H2>We&rsquo;re building this with a small number of stores.</H2>
            <Lede>
              DealerTech is new. We&rsquo;re working directly with a handful of franchise
              dealerships to get the workflow right before opening it up — which means you shape it,
              and you get the founder on the phone rather than a support queue.
            </Lede>
            <p className="mt-4 max-w-2xl leading-relaxed text-[var(--ink-soft)]">
              A walkthrough takes 30 minutes. Bring a VIN off your own lot and we&rsquo;ll run it
              live.
            </p>
            <dl className="mt-9 space-y-4 text-sm">
              {[
                ['01', '30-minute walkthrough on your own vehicles'],
                ['02', 'We import your service history and declined work'],
                ['03', 'Your advisors see prep sheets the next morning'],
              ].map(([n, text]) => (
                <div key={n} className="flex gap-4 border-t border-[var(--rule)] pt-4">
                  <dt className="font-mono text-[var(--signal)]">{n}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 sm:p-6">
            <DemoRequestForm source="homepage" />
          </div>
        </div>
      </Section>

      {/*
        The footer moved to a component rather than a layout, and the reasoning
        it used to carry inline still holds: this page sits directly under the
        root layout, which every other surface shares, so a footer layout there
        would put marketing links on the drive. See the note in the component.
      */}
      <MarketingFooter />
    </div>
  )
}
