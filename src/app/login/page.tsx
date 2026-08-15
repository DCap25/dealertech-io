import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { safeRedirect } from '@/lib/auth/routes'
import { SignInForm } from './sign-in-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

/**
 * Demo accounts, shown only outside production.
 *
 * A one-tap login is the difference between a demo that lands and a demo that
 * stalls on "what's the password". Guarded by NODE_ENV so a deployed build
 * never advertises credentials.
 */
const DEMO_USERS = [
  // Appointments are dealt between the two advisors, so neither "owns" the
  // drive — saying otherwise would be a claim the seed does not keep.
  { email: 'marcus@lonestarford.test', name: 'Marcus Reyes', role: 'Advisor', note: 'Works today’s drive' },
  { email: 'dana@lonestarford.test', name: 'Dana Whitfield', role: 'Advisor', note: 'A second advisor’s numbers' },
  { email: 'priya@lonestarford.test', name: 'Priya Nair', role: 'BDC', note: 'Works the follow-up list' },
  { email: 'ray@lonestarford.test', name: 'Ray Delgado', role: 'Service manager', note: 'Sees the whole store' },
]

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeRedirect(next)

  /*
    The form carries the RAW request, not `target`.

    `safeRedirect` collapses "nowhere in particular" into /drive, so passing
    `target` to the form made every sign-in look like it had explicitly asked
    for the drive — and the action, which only picks a destination by account
    type when nothing was asked for, never got the chance. DealerTech staff
    went to /drive and were turned straight back here.

    The action sanitises this before redirecting, so passing it through
    unresolved is not an open redirect.
  */
  const requested = next ?? ''

  /*
    Already signed in — no reason to show a form.

    Resolved from the session rather than from `getCurrentUser`, which requires
    a dealership. DealerTech staff hold no store role, so that check said "not
    signed in" and showed them a login form they had just used.
  */
  const session = await getSession()
  if (session?.active) redirect(target)
  if (session?.isPlatformAdmin) redirect('/admin')

  const showDemo = process.env.NODE_ENV !== 'production'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div>
        {/* A way back out. Someone who lands here by mistake, or who wanted
            the demo rather than the workspace, should not be stuck. */}
        <Link
          href="/"
          className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 transition hover:text-neutral-900 dark:hover:text-white"
        >
          DealerTech.io
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          Your drive, your follow-ups, your numbers.
        </p>
      </div>

      <SignInForm next={requested} demoUsers={showDemo ? DEMO_USERS : []} />

      <p className="mt-8 text-xs leading-relaxed text-neutral-500">
        Accounts are created by your service manager. If you cannot get in, ask them to check your
        store role — an account without one can sign in but has no dealership to show.
      </p>
    </main>
  )
}
