import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { landingPath, safeRedirect } from '@/lib/auth/routes'
import { SignInForm } from './sign-in-form'
import { signOut } from './actions'

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
    Already signed in.

    ---------------------------------------------------------------------------
    WHY THIS RENDERS INSTEAD OF REDIRECTING
    ---------------------------------------------------------------------------
    This page used to send a signed-in visitor straight on — platform staff to
    /admin, everyone else to wherever they were headed. Meanwhile
    `requirePlatformAdmin` sends a visitor it cannot see a session for back to
    /login. Two pages pointing at each other with nothing in between: the
    moment they disagreed about whether a session exists — a token refreshing,
    a cookie written a beat late — the browser flipped between /login and
    /admin until it gave up. It is not a rare state either; it happens on the
    hop straight after signing in, which is exactly when the token is newest.

    So the destination is offered rather than taken. One click instead of
    zero, and a disagreement becomes a page somebody can read and act on
    rather than a URL bar strobing between two routes.
  */
  const session = await getSession()
  const showDemo = process.env.NODE_ENV !== 'production'

  if (session) {
    const destination = session.active ? target : landingPath({
      hasStore: false,
      isPlatformAdmin: session.isPlatformAdmin,
    })

    return (
      <main className="mx-auto flex flex-1 max-w-md flex-col justify-center px-6 py-12">
        <div>
          <Link
            href="/"
            className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 transition hover:text-neutral-900 dark:hover:text-white"
          >
            DealerTech.io
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">You are signed in</h1>
          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            {session.email}
            {session.active
              ? ` · ${session.active.storeName}`
              : session.isPlatformAdmin
                ? ' · DealerTech staff'
                : ''}
          </p>
        </div>

        <Link
          href={destination}
          className="mt-8 rounded-xl bg-neutral-900 px-5 py-3.5 text-center text-sm font-bold text-white transition active:scale-[0.99] dark:bg-white dark:text-neutral-900"
        >
          {session.active ? 'Go to your drive' : 'Open the console'}
        </Link>

        {/* Says what it does. "Sign in as someone else" described the intent
            and hid the mechanism, so somebody looking for the way out did not
            recognise it as the way out. */}
        <form action={signOut} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-semibold transition hover:border-neutral-900 dark:hover:border-neutral-300"
          >
            Sign out
          </button>
        </form>

        {!session.active && !session.isPlatformAdmin && (
          <p className="mt-8 text-xs leading-relaxed text-neutral-500">
            This account has no dealership attached yet, so there is nothing to show you. Ask your
            service manager to add your store role.
          </p>
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col justify-center px-6 py-12">
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
