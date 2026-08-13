import Link from 'next/link'
import { DemoRequestForm } from './request-demo/demo-form'

export const metadata = {
  title: 'Know who pays before you write the RO',
  description:
    'DealerTech reads the coverage your customer already owns, predicts what wears out next, and never lets a declined job go quiet. Service drive intelligence for franchise dealerships.',
}

/* ------------------------------------------------------------------ bits */

function Section({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={`px-6 py-20 sm:py-28 ${className ?? ''}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">{children}</p>
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
    <div className="border-t border-neutral-200 pt-5 dark:border-neutral-800">
      <p className="font-mono text-sm text-neutral-400">{number}</p>
      <h3 className="mt-2 text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{body}</p>
    </div>
  )
}

export default function HomePage() {
  return (
    <>
      {/* ------------------------------------------------------------ nav */}
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="font-bold tracking-tight">
            DealerTech<span className="text-neutral-400">.io</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#how" className="hidden text-neutral-600 hover:text-neutral-900 sm:block dark:text-neutral-400 dark:hover:text-white">
              How it works
            </a>
            <a href="#proof" className="hidden text-neutral-600 hover:text-neutral-900 sm:block dark:text-neutral-400 dark:hover:text-white">
              Proof
            </a>
            <Link href="/demo" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
              Live demo
            </Link>
            <a
              href="#demo"
              className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Book a walkthrough
            </a>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------- hero */}
      <Section className="pb-12 pt-16 sm:pb-16 sm:pt-24">
        <div className="max-w-4xl">
          <Eyebrow>Service drive intelligence · Franchise dealerships</Eyebrow>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Your sales floor runs on a process.
            <br />
            <span className="text-neutral-400">Your service drive runs on memory.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
            Variable ops logs every up, desks every deal, presents a full menu to every customer,
            and chases them for years. Fixed ops books an appointment and hopes. DealerTech brings
            that same discipline to the drive — so your advisors know{' '}
            <strong className="text-neutral-900 dark:text-white">who pays</strong> before they write
            the RO, and nothing goes quiet after the customer leaves.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#demo"
              className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Book a walkthrough
            </a>
            <Link
              href="/demo"
              className="rounded-lg border border-neutral-300 px-6 py-3 text-sm font-semibold transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-400"
            >
              Try the coverage engine →
            </Link>
          </div>
          <p className="mt-3 text-sm text-neutral-500">
            The demo is live and open. Paste any VIN — no signup, nothing stored.
          </p>
        </div>
      </Section>

      {/* --------------------------------------------------------- leaks */}
      <Section id="leaks" className="border-t border-neutral-200 dark:border-neutral-800">
        <Eyebrow>Where the money goes</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          Four leaks, and none of them are your advisors&rsquo; fault.
        </h2>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-400">
          They&rsquo;re writing 15 ROs before 10am with four tabs open. Nobody can hold this in
          their head. That&rsquo;s a systems problem.
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
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
      <Section id="how" className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          One question, answered before the customer walks up.
        </h2>

        <div className="mt-12 grid gap-10 lg:grid-cols-3">
          <div>
            <p className="font-mono text-sm text-neutral-400">Step 01</p>
            <h3 className="mt-2 text-xl font-bold">The prep sheet</h3>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Every morning, each appointment arrives with a one-screen brief: coverage still
              active, open declined work re-priced, maintenance projected against the odometer they
              will actually have on arrival, tires predicted to a date, and any open campaign.
              Ranked by what to present first.
            </p>
          </div>
          <div>
            <p className="font-mono text-sm text-neutral-400">Step 02</p>
            <h3 className="mt-2 text-xl font-bold">The coverage answer</h3>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              For any concern, on any VIN, the engine works a strict waterfall — open recall,
              prepaid maintenance, tire &amp; wheel, every factory warranty term, then the service
              contract — and tells the advisor who pays, what the customer owes, and what to do
              before starting work.
            </p>
          </div>
          <div>
            <p className="font-mono text-sm text-neutral-400">Step 03</p>
            <h3 className="mt-2 text-xl font-bold">The follow-up that happens</h3>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Every decline becomes a dated task with a talk track and a dollar figure. So does
              expiring prepaid maintenance, warranty about to lapse, and a customer who has gone
              quiet. Your BDC works a ranked list instead of a spreadsheet.
            </p>
          </div>
        </div>
      </Section>

      {/* --------------------------------------------------------- proof */}
      <Section id="proof" className="border-t border-neutral-200 dark:border-neutral-800">
        <Eyebrow>Proof, not adjectives</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          Three answers most advisors get wrong.
        </h2>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-400">
          These aren&rsquo;t hypotheticals. Try each one yourself in the{' '}
          <Link href="/demo" className="underline">live demo</Link>.
        </p>

        <div className="mt-12 space-y-4">
          <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-lg font-bold">The same Hyundai. Two owners. Opposite answers.</h3>
              <span className="font-mono text-xs text-neutral-500">10yr/100k powertrain</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Hyundai, Kia and Genesis advertise a 10-year powertrain warranty. It applies to the{' '}
              <strong className="text-neutral-900 dark:text-white">original owner only</strong> — a
              second owner gets 5yr/60k. Same VIN, same mileage, same day: covered for one, expired
              for the other. Quote the headline number to a used-car buyer and the store eats the
              difference.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-lg font-bold">A converter is still free years after the warranty ends.</h3>
              <span className="font-mono text-xs text-neutral-500">Federal 8yr/80k emissions</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              The Clean Air Act covers the catalytic converter and the engine control module for
              eight years or 80,000 miles — on every make sold in the US, long after
              bumper-to-bumper has lapsed. An advisor checking only the 3/36 quotes four figures
              for a repair the manufacturer owes.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-lg font-bold">A hybrid battery covered in California, not in Texas.</h3>
              <span className="font-mono text-xs text-neutral-500">CARB 10yr/150k</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              California-standard states carry a 10-year, 150,000-mile high-voltage battery term
              instead of the federal 8/100 floor. On a 120,000-mile EV that is the whole
              conversation. DealerTech reads the electrification level straight from the VIN — the
              advisor never has to know the car is electric, let alone the rule.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- honesty */}
      <Section className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>What this is not</Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">
              We are not replacing your DMS.
            </h2>
            <p className="mt-4 text-neutral-600 dark:text-neutral-400">
              Your DMS keeps the repair order, the parts, and the accounting. DealerTech is the
              intelligence layer beside it — the tab your advisor actually wants open. Start with a
              spreadsheet export; integrate properly once it has earned its place.
            </p>
          </div>
          <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div>
              <h3 className="text-sm font-bold">We advise. The administrator adjudicates.</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Service contract terms are contracts, and they vary. Every answer carries a
                confidence level and routes prior-authorisation claims to the admin before teardown.
                We will never tell an advisor something is covered as though it were settled.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold">Recalls are shown as candidates, not certainties.</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                There is no public VIN-level open-recall feed — NHTSA publishes by make, model and
                year, without remedy status. So we surface campaigns to verify in the OEM portal
                rather than pretending to know.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold">Consent is a record, not a checkbox.</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Dealerships are covered financial institutions under the FTC Safeguards Rule. Every
                consent change is stored as a dated, sourced event with the exact disclosure text —
                and where a store cannot prove consent, the screen says so.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- CTA */}
      <Section id="demo" className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="grid gap-12 lg:grid-cols-[1fr_28rem]">
          <div>
            <Eyebrow>Early access</Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              We&rsquo;re building this with a small number of stores.
            </h2>
            <p className="mt-4 max-w-xl text-neutral-600 dark:text-neutral-400">
              DealerTech is new. We&rsquo;re working directly with a handful of franchise
              dealerships to get the workflow right before opening it up — which means you shape
              it, and you get the founder on the phone rather than a support queue.
            </p>
            <p className="mt-4 max-w-xl text-neutral-600 dark:text-neutral-400">
              A walkthrough takes 30 minutes. Bring a VIN off your own lot and we&rsquo;ll run it
              live.
            </p>
            <dl className="mt-8 space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="font-mono text-neutral-400">01</dt>
                <dd>30-minute walkthrough on your own vehicles</dd>
              </div>
              <div className="flex gap-3">
                <dt className="font-mono text-neutral-400">02</dt>
                <dd>We import your service history and declined work</dd>
              </div>
              <div className="flex gap-3">
                <dt className="font-mono text-neutral-400">03</dt>
                <dd>Your advisors see prep sheets the next morning</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <DemoRequestForm source="homepage" />
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------- footer */}
      <footer className="mt-auto border-t border-neutral-200 px-6 py-10 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-neutral-500">
          <p>
            <span className="font-bold text-neutral-900 dark:text-white">DealerTech.io</span> ·
            Service drive intelligence
          </p>
          <nav className="flex flex-wrap gap-5">
            <Link href="/demo" className="hover:text-neutral-900 dark:hover:text-white">Live demo</Link>
            <a href="#how" className="hover:text-neutral-900 dark:hover:text-white">How it works</a>
            <a href="#demo" className="hover:text-neutral-900 dark:hover:text-white">Book a walkthrough</a>
          </nav>
        </div>
        <p className="mx-auto mt-6 max-w-6xl text-xs leading-relaxed text-neutral-400">
          Coverage answers are advisory. DealerTech does not adjudicate claims — the administrator
          or manufacturer does. Warranty terms are reference data and vary by model and model year.
          Recall data comes from NHTSA by make, model and year, not by VIN.
        </p>
      </footer>
    </>
  )
}
