import Link from 'next/link'
import { UserBadge } from '@/components/auth/user-badge'
import { StoreSwitcher } from '@/components/auth/store-switcher'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'

/**
 * The links across the top of every workspace surface.
 *
 * Built from the signed-in role rather than shown to everyone: an advisor who
 * can see a "Department" tab will click it, and a page that then explains they
 * are not allowed reads as a broken promise. Managers get the extra link;
 * nobody else knows it exists.
 */
export async function WorkspaceNav({ current }: { current?: 'drive' | 'follow-up' | 'customers' | 'manager' | 'scorecard' | 'team' | 'billing' | 'import' | 'setup' }) {
  const user = await getCurrentUser()
  /*
    The same predicate the pages and the actions use.

    Hand-rolled as `SERVICE_MANAGER || ADMIN` until now, which quietly omitted
    FIXED_OPS_DIRECTOR — so the one account a dealer group often has at a
    rooftop could reach /team and /manager and saw no links to either. The nav
    and the page it links to must not disagree about who counts as a manager.
  */
  const isManager = user ? canManageStaff(user.role) : false

  const links: { key: NonNullable<typeof current>; href: string; label: string }[] = [
    { key: 'drive', href: '/drive', label: 'Today’s drive' },
    ...(isManager
      ? [{ key: 'manager' as const, href: '/manager', label: 'Department' }]
      : []),
    { key: 'follow-up', href: '/follow-up', label: 'Follow-ups' },
    { key: 'customers', href: '/customers', label: 'Customers' },
    { key: 'scorecard', href: '/advisor/scorecard', label: 'My scorecard' },
    // Last, and managers only. Adding staff is a rare, deliberate act — it
    // should not sit between two things an advisor uses every hour.
    ...(isManager
      ? [
          { key: 'team' as const, href: '/team', label: 'Team' },
          /*
            Import is listed permanently rather than only while a store is
            empty. Bringing history across is not a one-off setup step — a
            group adds a rooftop, or re-exports a longer date range, or fixes a
            column and runs the file again. Hiding it once the first import
            lands would mean the second one needs somebody to remember a URL.
          */
          { key: 'import' as const, href: '/import', label: 'Import' },
          /*
            Setup is listed permanently rather than disappearing once the
            checklist is green. Almost every step is derived from live data,
            so a store that deletes their op codes has an outstanding step
            again — and a page that had hidden itself would be the last place
            they would think to look.
          */
          { key: 'setup' as const, href: '/setup', label: 'Setup' },
          /*
            Billing sits at the very end, and only for the people who can act
            on it. An advisor has no business seeing what the dealership pays,
            and a link they can open only to be told they may not change
            anything reads as a broken promise — the same argument that keeps
            "Department" off their nav.
          */
          { key: 'billing' as const, href: '/billing', label: 'Billing' },
        ]
      : []),
  ]

  return (
    <nav className="flex flex-wrap items-center gap-3 text-sm text-neutral-500">
      {links
        .filter((l) => l.key !== current)
        .map((l) => (
          <Link key={l.key} href={l.href} className="hover:underline">
            {l.label}
          </Link>
        ))}
      {/* Only DealerTech staff, and only when they are also working a store —
          anyone without a dealership role lands on the console at sign-in. */}
      {user?.isPlatformAdmin && (
        <Link href="/admin" className="hover:underline">Platform</Link>
      )}
      <StoreSwitcher />
      <UserBadge />
    </nav>
  )
}
