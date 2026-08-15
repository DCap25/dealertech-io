import Link from 'next/link'
import { UserBadge } from '@/components/auth/user-badge'
import { StoreSwitcher } from '@/components/auth/store-switcher'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * The links across the top of every workspace surface.
 *
 * Built from the signed-in role rather than shown to everyone: an advisor who
 * can see a "Department" tab will click it, and a page that then explains they
 * are not allowed reads as a broken promise. Managers get the extra link;
 * nobody else knows it exists.
 */
export async function WorkspaceNav({ current }: { current?: 'drive' | 'follow-up' | 'customers' | 'manager' | 'scorecard' | 'team' }) {
  const user = await getCurrentUser()
  const isManager = user?.role === 'SERVICE_MANAGER' || user?.role === 'ADMIN'

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
      ? [{ key: 'team' as const, href: '/team', label: 'Team' }]
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
      <StoreSwitcher />
      <UserBadge />
    </nav>
  )
}
