import { H2, P, TrustPage } from '@/components/marketing/trust-page'
import { CONTACT_EMAIL, DEPENDENCY_STATUS_PAGES, PRODUCT_NAME } from '@/lib/site/legal'

export const metadata = {
  title: 'Status',
  description:
    'Where to look when DealerTech.io is not working, and how to tell us. No incident history yet.',
}

/**
 * A static page, on purpose.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A LIVE HEALTH CHECK
 * ---------------------------------------------------------------------------
 * The obvious build is a page that pings the app and the database and shows
 * green ticks. It is also theatre precisely when it matters: a status page
 * hosted on the thing it reports on is down at the exact moment somebody needs
 * it, and it would be a public route touching the database, which is a
 * rate-limiting problem in exchange for information nobody can read during an
 * outage.
 *
 * So this links to the four providers' own status pages — each independently
 * hosted, each already the real answer for the layer it covers — and says
 * plainly that we are early enough not to have an incident history. A hosted
 * status provider on a free tier is the upgrade, and it becomes worth doing
 * when there are dealerships to notify rather than when the page looks thin.
 *
 * No database access here, no live checks, nothing dynamic. It renders the same
 * whether or not the rest of the product is up, which is the only property a
 * status page genuinely needs.
 */

export default function StatusPage() {
  return (
    <TrustPage
      eyebrow="Trust"
      title="Status"
      lede="No live dashboard yet — here is the honest version of one."
    >
      <H2>Where we are</H2>
      <P>
        {PRODUCT_NAME} is in early access with a small number of franchise dealerships. There is no
        incident history on this page because there is not yet enough history to be worth reading,
        and a page showing 100% uptime for a product this new tells you nothing about how it behaves
        under a year of load.
      </P>
      <P>
        As incidents happen, they will be written up here — what broke, for how long, and what
        changed so it does not happen again. That is the version of this page worth having, and it
        has to be earned rather than launched.
      </P>

      <H2>Check these first</H2>
      <P>
        Most of what could stop the product is one of four services, and each publishes its own
        status independently of us — which is the point, because ours would be down too.
      </P>
      <div className="mt-6 grid gap-3">
        {DEPENDENCY_STATUS_PAGES.map((s) => (
          <a
            key={s.name}
            href={s.url}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4 transition hover:border-[var(--ink)]"
          >
            <span className="font-bold">{s.name}</span>
            <span className="text-sm text-[var(--ink-soft)]">{s.covers}</span>
          </a>
        ))}
      </div>

      <H2>Tell us something is wrong</H2>
      <P>
        Email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>{' '}
        — what you were doing, which store, and roughly when. If you are a dealership under contract
        you have a direct number, and it reaches the person who wrote the code rather than a support
        queue. That is the genuine advantage of being early, and it is worth more right now than a
        dashboard.
      </P>
    </TrustPage>
  )
}
