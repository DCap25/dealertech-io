import { getCurrentUser } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'

/**
 * Who is signed in, and the way out.
 *
 * Small and always in the same corner. An advisor who cannot tell at a glance
 * whose session they are in will eventually record a visit against a colleague
 * — the shared tablet at the drive makes that a when, not an if.
 */
export async function UserBadge() {
  const user = await getCurrentUser()
  if (!user) return null

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span className="hidden sm:inline">
        {user.name}
        <span className="ml-1.5 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {user.role.replace('_', ' ').toLowerCase()}
        </span>
      </span>
      <form action={signOut}>
        <button
          type="submit"
          className="touch-target rounded-lg px-2 py-1 hover:underline"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
