import Link from 'next/link'
import { H2, P, TrustPage, UL } from '@/components/marketing/trust-page'
import { CONTACT_EMAIL, LEGAL_ENTITY, PRODUCT_NAME, SIBLING_PRODUCT } from '@/lib/site/legal'

export const metadata = {
  title: 'Press',
  description:
    'What DealerTech.io is, in two paragraphs, and who to contact about it.',
}

/**
 * No news section.
 *
 * An empty "In the news" heading ages a product faster than having no press
 * page at all — it is a public record of nothing having happened. What a
 * journalist or an analyst actually needs from a company this size is a
 * description they can quote without paraphrasing a sales page, and a person to
 * email. That is the whole page. News gets folded in when there is news.
 */

export default function PressPage() {
  return (
    <TrustPage
      eyebrow="Press"
      title={`About ${PRODUCT_NAME}`}
      lede="Two paragraphs you are welcome to quote, and one address."
    >
      <H2>What it is</H2>
      <P>
        {PRODUCT_NAME} is service drive intelligence for franchise dealerships. A dealership&rsquo;s
        sales floor runs on process — every up is logged, every deal desked, a full menu presented,
        the customer chased for years. Its service drive runs on memory: an advisor writing fifteen
        repair orders before ten in the morning, with four tabs open, trying to hold in their head
        which customer already owns the coverage that would pay for the repair they are about to
        quote. {PRODUCT_NAME} brings the sales floor&rsquo;s discipline to the drive, so the advisor
        knows who pays before they write the repair order and nothing goes quiet after the customer
        leaves.
      </P>
      <P>
        Concretely, it does three things. It reads the coverage a customer already owns — open
        recalls, prepaid maintenance, tire and wheel, every factory warranty term including the
        emissions and hybrid ones that outlast bumper-to-bumper, then the service contract — and
        tells the advisor who pays. It turns the measurements technicians already write down at every
        inspection into a date a part will need replacing, using that customer&rsquo;s own driving
        rate rather than an average. And it makes every declined job a dated task with a dollar
        figure, which is the largest untapped pool in the department and the one most stores cannot
        even report on. It is a layer beside the DMS, not a replacement for it: the repair order, the
        parts and the accounting stay where they are.
      </P>
      <P>
        The bet underneath all of it is that the transparent dealership wins. Every customer-facing
        screen is built so it can be physically handed to the customer mid-conversation without a
        single thing on it needing to be explained away — which is also why the product refuses to
        quote a price the DMS will not charge, shows recalls as candidates rather than certainties,
        and never tells an advisor something is covered as though it were settled.
      </P>

      <H2>The company</H2>
      <P>
        {PRODUCT_NAME} is a product of {LEGAL_ENTITY}, which also builds {SIBLING_PRODUCT.name} —{' '}
        {SIBLING_PRODUCT.description} for the same dealerships, at{' '}
        <a
          href={SIBLING_PRODUCT.url}
          className="font-semibold text-[var(--ink)] underline underline-offset-4"
        >
          thedasboard.com
        </a>
        . One company, two halves of a store: variable operations on one side, fixed operations on
        the other.
      </P>
      <P>
        The product is in early access with a small number of franchise dealerships. We are not
        claiming a customer count, a funding round or a headcount, because we have not got numbers
        worth a press release and inflating them is a habit that gets expensive.
      </P>

      <H2>Contact</H2>
      <P>
        Founder and press enquiries:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        .
      </P>
      <P>
        Useful if you are writing about us: the{' '}
        <Link href="/demo" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          coverage demo
        </Link>{' '}
        is open with no signup — paste any VIN and a concern and you will see exactly what an advisor
        sees. The{' '}
        <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          security
        </Link>{' '}
        and{' '}
        <Link href="/responsible-ai" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          responsible AI
        </Link>{' '}
        pages describe the architecture in specifics rather than adjectives, including what we do not
        hold.
      </P>

      <H2>Naming</H2>
      <UL>
        <li>
          The product is <strong className="text-[var(--ink)]">{PRODUCT_NAME}</strong> — one word,
          capital D, capital T, with the .io. Not &ldquo;Dealer Tech&rdquo;.
        </li>
        <li>
          The company is <strong className="text-[var(--ink)]">{LEGAL_ENTITY}</strong>.
        </li>
        <li>
          The sibling product is <strong className="text-[var(--ink)]">{SIBLING_PRODUCT.name}</strong>.
        </li>
      </UL>
    </TrustPage>
  )
}
