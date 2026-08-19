import Link from 'next/link'
import { CONTACT_EMAIL, LEGAL_ENTITY, PRODUCT_NAME, SIBLING_PRODUCT } from '@/lib/site/legal'

/**
 * The bottom of every public page.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A COMPONENT AND NOT A LAYOUT
 * ---------------------------------------------------------------------------
 * The rest of the site does footers as layouts (see
 * `src/components/ui/site-footer.tsx`, which explains why) — one file covers
 * every route beneath it, including ones nobody has written yet.
 *
 * The marketing footer cannot be one, because there is no single subtree to
 * hang it under. `/` sits directly on the root layout, which the workspace and
 * the customer screens also share, and the trust pages are scattered across
 * `/legal/*`, `/security`, `/compliance`, `/responsible-ai`, `/status` and
 * `/press`. A layout at the root would put a marketing footer on the drive; a
 * layout per section would be six copies of the same import.
 *
 * The cost is the usual one — a page added later can forget it. `TrustPage` in
 * ./trust-page.tsx renders this for every trust page, so the only surfaces that
 * mount it by hand are `/` and `/demo`, both of which have their own layout
 * anyway.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LINKS SAY WHAT THEY SAY
 * ---------------------------------------------------------------------------
 * The trust row is the shape a dealer's IT contact expects to find — it is
 * roughly the column a DMS vendor's site carries, minus the badges we do not
 * hold. Where a vendor with a consent manager puts "Update Privacy
 * Preferences", we put the sentence about setting no cookies at all, which is
 * the same slot and a better answer.
 *
 * The section links are absolute (`/#how`, not `#how`) on purpose: as bare
 * fragments they scroll to nothing on every page except the homepage, and a
 * dead link in a footer is the kind of thing nobody reports and everybody
 * notices.
 */

function Row({ children }: { children: React.ReactNode }) {
  return <nav className="flex flex-wrap gap-x-5 gap-y-2">{children}</nav>
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="transition hover:text-[var(--ink)]">
      {children}
    </Link>
  )
}

export function MarketingFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--rule)] px-5 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-8 text-sm text-[var(--ink-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-2">
            <p>
              <span className="font-bold text-[var(--ink)]">{PRODUCT_NAME}</span> · Service drive
              intelligence
            </p>
            {/*
              Dealers expect an address in the footer of anything they are about
              to sign. One address, because there is one person reading it —
              see the note on CONTACT_EMAIL.
            */}
            <p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium transition hover:text-[var(--ink)]"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          <div className="space-y-3">
            <Row>
              <FooterLink href="/demo">Live demo</FooterLink>
              <FooterLink href="/#how">How it works</FooterLink>
              <FooterLink href="/#managers">For managers</FooterLink>
              <FooterLink href="/#demo">Book a walkthrough</FooterLink>
              <Link href="/login" className="font-semibold transition hover:text-[var(--ink)]">
                Sign in
              </Link>
            </Row>
            <Row>
              <FooterLink href="/legal/privacy">Privacy</FooterLink>
              <FooterLink href="/legal/terms">Terms</FooterLink>
              <FooterLink href="/legal/cookies">Cookies</FooterLink>
              <FooterLink href="/security">Security</FooterLink>
              <FooterLink href="/compliance">Compliance</FooterLink>
              <FooterLink href="/responsible-ai">Responsible AI</FooterLink>
              <FooterLink href="/status">Status</FooterLink>
              <FooterLink href="/press">Press</FooterLink>
            </Row>
          </div>
        </div>

        {/*
          Verbatim from the page this footer was extracted out of. Every clause
          is a claim the product makes elsewhere and has to keep making.
        */}
        <p className="text-xs leading-relaxed opacity-80">
          Coverage answers are advisory. DealerTech does not adjudicate claims — the administrator
          or manufacturer does. Warranty terms are reference data and vary by model and model year.
          Recall data comes from NHTSA by make, model and year, not by VIN. Figures shown in product
          previews on this page are illustrative.
        </p>

        <div className="space-y-1.5 border-t border-[var(--rule)] pt-6 text-xs">
          <p>
            No tracking, no analytics, no cookies until you sign in.{' '}
            <Link
              href="/legal/cookies"
              className="underline underline-offset-4 transition hover:text-[var(--ink)]"
            >
              What we do set, and when
            </Link>
            .
          </p>
          <p>
            Copyright © {PRODUCT_NAME} · {PRODUCT_NAME} is a product of {LEGAL_ENTITY}.
          </p>
          <p>
            Also from {LEGAL_ENTITY}: {SIBLING_PRODUCT.description} at{' '}
            <a
              href={SIBLING_PRODUCT.url}
              className="underline underline-offset-4 transition hover:text-[var(--ink)]"
            >
              thedasboard.com
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  )
}
