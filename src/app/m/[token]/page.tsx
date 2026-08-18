import { linkSessionFromToken } from '@/lib/presentation/link-store'
import { linkStatusMessage, linkStatusTitle } from '@/lib/presentation/link'
import { CustomerMenu } from './customer-menu'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Your service menu',
  // A customer's vehicle, mileage and prices. Never indexed, never followed.
  robots: { index: false, follow: false },
}

function Centre({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col justify-center px-6 py-12 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
        DealerTech
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">{children}</p>
    </main>
  )
}

/**
 * The menu on a customer's phone.
 *
 * Reached from a text after the technician has been under the car — the
 * conversation the tablet in the drive cannot have, because by then the
 * customer is at work.
 *
 * The token in the URL is the whole authority. There is no account here and
 * never will be: this is a customer, not a user.
 */
export default async function MenuLinkPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await linkSessionFromToken(token, new Date())

  /*
    An unknown token says so plainly rather than pretending.

    Enumeration is not a real risk — it is 32 random bytes — and a customer who
    truncated a link while copying it out of a text needs to know that is what
    happened, not be told something vague.
  */
  if (!session) {
    return (
      <Centre title="This link is not valid">
        Check you copied the whole thing — these links are long and easy to cut short. If it still
        does not work, call your service advisor and they will send a new one.
      </Centre>
    )
  }

  if (session.status !== 'OPEN' && session.status !== 'AUTHORIZED') {
    return (
      <Centre title={linkStatusTitle(session.status)}>
        {linkStatusMessage(session.status)}
      </Centre>
    )
  }

  return (
    <CustomerMenu
      token={token}
      snapshot={session.snapshot}
      initialDecisions={session.decisions}
      authorized={session.authorizedAt
        ? { at: session.authorizedAt.toISOString(), name: session.authorizedName ?? 'you' }
        : null}
    />
  )
}
