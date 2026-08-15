import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { knownMakes } from '@/lib/warranty'
import { SignUpForm } from './signup-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Start a trial' }

export default async function SignUpPage() {
  // Already signed in — creating a second dealership from here would be an
  // accident far more often than an intention.
  const user = await getCurrentUser()
  if (user) redirect('/drive')

  return (
    <main className="mx-auto flex flex-1 max-w-lg flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 transition hover:text-neutral-900 dark:hover:text-white"
      >
        DealerTech.io
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Start a trial</h1>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        Set up your store, then invite your advisors. No DMS connection needed to look around —
        that comes later, with your DMS vendor&rsquo;s authorisation.
      </p>

      <SignUpForm makes={knownMakes()} />

      <p className="mt-8 text-xs leading-relaxed text-neutral-500">
        You will be the administrator, which is the only account that can add staff. Already have an
        invitation? <Link href="/login" className="underline">Sign in</Link> once you have used it.
      </p>
    </main>
  )
}
