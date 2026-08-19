import Link from 'next/link'
import { TrustPage } from '@/components/marketing/trust-page'
import { CONTACT_EMAIL, LEGAL_ENTITY, PRODUCT_NAME } from '@/lib/site/legal'

export const metadata = {
  title: 'Legal',
  description:
    'The documents DealerTech.io operates under: privacy, terms of service, and cookies.',
}

/**
 * The index, not a document.
 *
 * A dealer's IT contact arrives here from a footer link with a checklist, and
 * the useful thing is a one-line answer to "what is this and do I need to read
 * it" against each item — not a wall of equally-weighted links.
 */

const DOCUMENTS = [
  {
    href: '/legal/privacy',
    title: 'Privacy Policy',
    body:
      'What we collect about you when you ask for a demo, and what we do — and do not do — with your dealership’s customer records. Those are two different things and the document keeps them apart.',
  },
  {
    href: '/legal/terms',
    title: 'Terms of Service',
    body:
      'The agreement between your dealership and us. Billing, what the product does and does not claim, who owns the data, and what happens when a subscription ends.',
  },
  {
    href: '/legal/cookies',
    title: 'Cookie Policy',
    body:
      'At most two cookies, both strictly functional, none before you sign in. This is the whole page and it does not take long to read.',
  },
]

const ADJACENT = [
  { href: '/security', title: 'Security', body: 'How tenancy isolation, credentials and documents actually work.' },
  { href: '/compliance', title: 'Compliance', body: 'Safeguards Rule posture, subprocessors, and what we do not hold.' },
  { href: '/responsible-ai', title: 'Responsible AI', body: 'Where a model is used and what is never trusted without a person.' },
]

function Item({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[var(--rule)] bg-[var(--paper)] p-5 transition hover:border-[var(--ink)] sm:p-6"
    >
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
    </Link>
  )
}

export default function LegalIndexPage() {
  return (
    <TrustPage
      eyebrow="Legal"
      title="The paperwork, in plain English."
      lede={
        <>
          {PRODUCT_NAME} is a product of {LEGAL_ENTITY}. These are the documents that govern using
          it. They were written from the code they describe, which is why they are shorter and more
          specific than you are probably expecting.
        </>
      }
    >
      <div className="mt-10 grid gap-4">
        {DOCUMENTS.map((d) => (
          <Item key={d.href} {...d} />
        ))}
      </div>

      <h2 className="mt-12 border-t border-[var(--rule)] pt-8 text-xl font-bold tracking-tight">
        Also worth reading
      </h2>
      <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">
        Not legal documents, but the pages a procurement questionnaire is actually asking about.
      </p>
      <div className="mt-6 grid gap-4">
        {ADJACENT.map((d) => (
          <Item key={d.href} {...d} />
        ))}
      </div>

      <p className="mt-12 border-t border-[var(--rule)] pt-6 text-sm leading-relaxed text-[var(--ink-soft)]">
        A question about any of it, or a change your dealership needs before signing:{' '}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="font-semibold text-[var(--ink)] underline underline-offset-4"
        >
          {CONTACT_EMAIL}
        </a>
        . A real person reads it.
      </p>
    </TrustPage>
  )
}
