import { MarketingFooter } from '@/components/marketing/site-footer'

/**
 * The demo is part of the marketing site, so it gets the marketing footer.
 *
 * It used to re-export `SiteFrame`, which is the one-line "Copyright ©
 * DealerTech.io" the signed-out doors carry. That was right when there was
 * nothing else to link to. Now a visitor who gets far enough to run a VIN is
 * exactly the person who goes looking for the security and privacy pages next,
 * and this was the surface with no route to them.
 *
 * `/login`, `/signup` and `/invite` deliberately keep `SiteFrame`. Someone
 * holding an invitation is not shopping, and a wall of trust links under a
 * two-field form reads as a site that has lost its nerve.
 *
 * The wrapper carries `.mkt` because the footer is styled from that palette
 * and the demo page applies the class to its own `<main>`, one level below.
 */
export default function DemoLayout({ children }: LayoutProps<'/demo'>) {
  return (
    <div className="mkt flex min-h-full flex-col bg-[var(--paper)] text-[var(--ink)]">
      {children}
      <MarketingFooter />
    </div>
  )
}
