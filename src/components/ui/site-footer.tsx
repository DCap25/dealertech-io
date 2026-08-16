import type { ReactNode } from 'react'
import { AccountBanner } from './account-banner'

/**
 * The line at the bottom of every page.
 *
 * ---------------------------------------------------------------------------
 * TWO LINES, BECAUSE THERE ARE TWO AUDIENCES
 * ---------------------------------------------------------------------------
 * The public site is ours and says so: "Copyright © DealerTech.io".
 *
 * Everything inside the product belongs to the dealership using it — their
 * drive, their customers, their conversation — so it says "Powered by
 * DealerTech.io" instead. That includes the menu a customer reads on a tablet
 * or their own phone, which is the screen this product is most seen on and the
 * only one a person outside the industry will ever look at.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE LAYOUTS RATHER THAN A COMPONENT PER PAGE
 * ---------------------------------------------------------------------------
 * "Every page" has to survive the next page somebody adds. A component pasted
 * into sixteen files is one that will be missing from the seventeenth, and
 * nobody notices a footer that is not there. A layout per section covers every
 * route beneath it, including ones that do not exist yet.
 *
 * The root layout is not the place for it: `/` and `/demo` are statically
 * prerendered, and choosing a footer there would mean reading the request path
 * and turning the marketing site dynamic to decide the wording of one line.
 */

function Line({ children, clearsActionBar = false }: {
  children: ReactNode
  /**
   * The customer surfaces pin an action bar to the bottom of the screen. A
   * footer at the end of the document sits underneath it once the page is
   * scrolled all the way down, so those two need the bar's height back.
   */
  clearsActionBar?: boolean
}) {
  return (
    <footer className={`mt-auto px-5 pt-6 text-center sm:px-6 ${clearsActionBar ? 'pb-32' : 'pb-6'}`}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{children}</p>
    </footer>
  )
}

export function PoweredBy({ clearsActionBar = false }: { clearsActionBar?: boolean }) {
  return (
    <Line clearsActionBar={clearsActionBar}>
      Powered by <span className="font-semibold">DealerTech.io</span>
    </Line>
  )
}

export function Copyright() {
  return <Line>Copyright © DealerTech.io</Line>
}

/**
 * Inside the product. Wraps a whole section of the workspace.
 *
 * Also where the account notice goes, for the same reason the footer does:
 * "every page in the workspace" has to survive the next page somebody adds,
 * and a banner pasted into sixteen files will be missing from the seventeenth.
 *
 * Note what this does NOT cover — `CustomerFrame` is a separate wrapper, so a
 * customer holding a tablet or opening a menu link can never be shown the
 * dealership's billing state. That separation is load-bearing, not incidental.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountBanner />
      {children}
      <PoweredBy />
    </>
  )
}

/**
 * The two screens a customer holds — the paired tablet and the link on their
 * own phone. Same line as the rest of the product, moved up clear of the
 * action bar those two pin to the bottom of the screen.
 */
export function CustomerFrame({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PoweredBy clearsActionBar />
    </>
  )
}

/** The public site, and the signed-out front door that leads into it. */
export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Copyright />
    </>
  )
}
