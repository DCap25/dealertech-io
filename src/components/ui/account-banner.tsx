import { getSession } from '@/lib/auth/session'
import type { AccessBanner } from '@/lib/billing/access'

/**
 * The notice at the top of the workspace when something is wrong with billing.
 *
 * ---------------------------------------------------------------------------
 * WHO IS TOLD, AND WHO IS DELIBERATELY NOT
 * ---------------------------------------------------------------------------
 * A failed card is a message for the people who can fix it. An advisor
 * standing at the podium with a customer watching them read the screen is not
 * one of those people, and putting "your payment failed" in front of them
 * costs the dealership credibility in the exact moment this product exists to
 * protect.
 *
 * So `audience` is honoured strictly: MANAGERS means the three roles that can
 * actually reach an accounts-payable department, and EVERYONE is reserved for
 * states where the product has genuinely stopped working and pretending
 * otherwise would be worse.
 *
 * A server component, so nothing about the dealership's commercial state
 * reaches the browser for a user who was not supposed to see it — filtering
 * this on the client would ship the message and merely hide it.
 */

const MANAGER_ROLES = ['SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN']

const TONE: Record<AccessBanner['tone'], string> = {
  INFO: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
  WARNING: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  CRITICAL: 'border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100',
}

export async function AccountBanner() {
  const session = await getSession()
  const banner = session?.access?.banner
  if (!banner || !session?.active) return null

  if (banner.audience === 'MANAGERS' && !MANAGER_ROLES.includes(session.active.role)) {
    return null
  }

  return (
    <div className={`border-b px-4 py-2.5 sm:px-6 ${TONE[banner.tone]}`}>
      <p className="mx-auto max-w-5xl text-sm font-medium">{banner.message}</p>
    </div>
  )
}
