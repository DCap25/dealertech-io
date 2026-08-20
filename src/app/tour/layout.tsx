import { MarketingFooter } from '@/components/marketing/site-footer'

/**
 * The tour door is part of the marketing site, so it gets the marketing footer.
 *
 * Same reasoning as `/demo`: somebody deciding whether to spend twenty minutes
 * inside the product is exactly the person who goes looking for the security
 * and privacy pages first, and a door with no route to them is a dead end.
 *
 * This wraps the code entry and the role picker only. The moment a role is
 * picked the visitor is signed in and lands in the real workspace, which has
 * its own frame — nothing about the tour follows them in there, deliberately.
 */
export default function TourLayout({ children }: LayoutProps<'/tour'>) {
  return (
    <div className="mkt flex min-h-full flex-col bg-[var(--paper)] text-[var(--ink)]">
      {children}
      <MarketingFooter />
    </div>
  )
}
